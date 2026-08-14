import "server-only";

/**
 * Saved views and sidebar favourites.
 *
 * ## A saved view stores a filter, not a result
 *
 * `filter` and `display` are the same JSON the client already holds — an
 * {@link IssueFilter} and a {@link DisplayOptions}, serialised verbatim. Storing
 * the *query* rather than a materialised list is what makes a saved view stay
 * correct as issues change, and it is why there is no invalidation anywhere in
 * this file.
 *
 * The two columns are `jsonb` and are never queried into. That is deliberate:
 * the moment something filters views by what is inside their filter, the shape
 * of `IssueFilter` becomes a schema, and changing it becomes a migration.
 *
 * ## Favourites are polymorphic and lose referential integrity
 *
 * `(kind, target_id)` rather than one nullable foreign key per kind. Linear's
 * own `Favorite` has ~25 nullable target columns; `research/03-data-model.md` §6
 * takes the other option and states the cost — a favourite can outlive its
 * target, and the worst case is a sidebar entry that 404s. That is acceptable
 * for a per-user bookmark and would not be for an issue, which keeps real keys.
 */

import type { SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type {
  DisplayOptions,
  IssueFilter,
  SavedView,
  UserId,
  ViewId,
  WorkspaceId,
} from "@/domain/entities";
import { keyBetween } from "@/domain/ordering";
import { newId, randomToken } from "@/lib/ids";
import {
  type CreateSavedViewInput,
  type Favorite,
  type FavoriteKind,
  NotFoundError,
  type Patch,
  type Tx,
  type ViewRepository,
} from "@/ports/repositories";

import { appendChangeEvent } from "./changefeed";
import {
  BaseRepository,
  bool,
  json,
  nullableText,
  Params,
  text,
  timestamp,
} from "./shared";

const VIEW_COLUMNS = `id, workspace_id, team_id, owner_id, name, description,
  icon, color, filter, display, shared, created_at`;

/**
 * The display options a view falls back to.
 *
 * A view saved before an option existed has no value for it, and `undefined`
 * reaching a component that renders `groupBy` produces an empty list rather
 * than an error. Merging over a complete default is one line here and removes
 * that class of bug from every consumer.
 */
const DISPLAY_DEFAULTS: DisplayOptions = {
  layout: "list",
  groupBy: "status",
  orderBy: "manual",
  orderDirection: "asc",
  showSubIssues: false,
  showEmptyGroups: false,
  showCompletedIssues: true,
  properties: ["priority", "identifier", "status", "labels", "assignee"],
};

export function mapViewRow(row: SqlRow): SavedView {
  return {
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    teamId: nullableText(row, "team_id"),
    ownerId: text(row, "owner_id"),
    name: text(row, "name"),
    description: nullableText(row, "description"),
    icon: text(row, "icon"),
    color: text(row, "color"),
    filter: json<IssueFilter>(row["filter"], {}),
    display: { ...DISPLAY_DEFAULTS, ...json<Partial<DisplayOptions>>(row["display"], {}) },
    shared: bool(row, "shared"),
    createdAt: timestamp(row["created_at"]),
  };
}

function mapFavoriteRow(row: SqlRow): Favorite {
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    kind: text(row, "kind") as FavoriteKind,
    targetId: text(row, "target_id"),
    sortOrder: text(row, "sort_order"),
    createdAt: timestamp(row["created_at"]),
  };
}

export class SqlViewRepository extends BaseRepository implements ViewRepository {
  async create(input: CreateSavedViewInput, tx?: Tx): Promise<SavedView> {
    return this.atomically(tx, async (t) => {
      const id = input.id ?? newId("viw");
      await t.execute(
        `insert into saved_views (id, workspace_id, team_id, owner_id, name,
                                  description, icon, color, filter, display,
                                  shared, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)`,
        [
          id,
          input.workspaceId,
          input.teamId ?? null,
          input.ownerId,
          input.name,
          input.description ?? null,
          input.icon ?? "Layers",
          input.color ?? "#5e6ad2",
          JSON.stringify(input.filter),
          JSON.stringify(input.display),
          input.shared ?? false,
          this.now(),
        ],
      );
      await appendChangeEvent(t, {
        workspaceId: input.workspaceId,
        entity: "view",
        entityId: id,
        action: "create",
        actorId: input.ownerId,
        payload: { name: input.name, shared: input.shared ?? false },
      });
      return this.#require(t, id);
    });
  }

  async byId(id: ViewId, tx?: Tx): Promise<SavedView | null> {
    const rows = await this.reader(tx).query(
      `select ${VIEW_COLUMNS} from saved_views where id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapViewRow(row);
  }

  async listForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    tx?: Tx,
  ): Promise<SavedView[]> {
    const rows = await this.reader(tx).query(
      `select ${VIEW_COLUMNS} from saved_views
        where workspace_id = $1 and (owner_id = $2 or shared = true)
        order by lower(name) asc, id asc`,
      [workspaceId, userId],
    );
    return rows.map(mapViewRow);
  }

  async update(
    id: ViewId,
    patch: Patch<
      Pick<
        SavedView,
        "name" | "description" | "icon" | "color" | "filter" | "display" | "shared"
      >
    >,
    actorId: UserId,
    tx?: Tx,
  ): Promise<SavedView> {
    return this.atomically(tx, async (t) => {
      const before = await this.#require(t, id);
      const params = new Params();
      const sets: string[] = [];

      if (patch.name !== undefined) sets.push(`name = ${params.bind(patch.name)}`);
      if (patch.description !== undefined) {
        sets.push(`description = ${params.bind(patch.description)}`);
      }
      if (patch.icon !== undefined) sets.push(`icon = ${params.bind(patch.icon)}`);
      if (patch.color !== undefined) sets.push(`color = ${params.bind(patch.color)}`);
      if (patch.filter !== undefined) {
        sets.push(`filter = ${params.bind(JSON.stringify(patch.filter))}::jsonb`);
      }
      if (patch.display !== undefined) {
        sets.push(`display = ${params.bind(JSON.stringify(patch.display))}::jsonb`);
      }
      if (patch.shared !== undefined) {
        sets.push(`shared = ${params.bind(patch.shared)}`);
      }
      if (sets.length === 0) return before;

      await t.execute(
        `update saved_views set ${sets.join(", ")} where id = ${params.bind(id)}`,
        params.values,
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "view",
        entityId: id,
        action: "update",
        actorId,
        payload: { name: patch.name ?? before.name },
      });
      return this.#require(t, id);
    });
  }

  async delete(id: ViewId, actorId: UserId, tx?: Tx): Promise<void> {
    await this.atomically(tx, async (t) => {
      const before = await this.byId(id, t);
      if (before === null) return;
      await t.execute(`delete from saved_views where id = $1`, [id]);
      // The favourite pointing at it goes too; nothing else does, because a
      // favourite has no foreign key to cascade from.
      await t.execute(
        `delete from favorites where kind = 'view' and target_id = $1`,
        [id],
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "view",
        entityId: id,
        action: "delete",
        actorId,
        payload: { name: before.name },
      });
    });
  }

  /* -------------------------------------------------------- favourites -- */

  async listFavorites(userId: UserId, tx?: Tx): Promise<Favorite[]> {
    const rows = await this.reader(tx).query(
      `select id, user_id, kind, target_id, sort_order, created_at
         from favorites where user_id = $1
        order by sort_order asc, id asc`,
      [userId],
    );
    return rows.map(mapFavoriteRow);
  }

  async addFavorite(
    userId: UserId,
    kind: FavoriteKind,
    targetId: string,
    tx?: Tx,
  ): Promise<Favorite> {
    return this.atomically(tx, async (t) => {
      const existing = await t.query(
        `select id, user_id, kind, target_id, sort_order, created_at
           from favorites where user_id = $1 and kind = $2 and target_id = $3`,
        [userId, kind, targetId],
      );
      const found = existing[0];
      if (found !== undefined) return mapFavoriteRow(found);

      const bottom = await t.query(
        `select max(sort_order) as bottom from favorites where user_id = $1`,
        [userId],
      );
      const bottomRow = bottom[0];
      const sortOrder = keyBetween(
        bottomRow === undefined ? null : nullableText(bottomRow, "bottom"),
        null,
      );
      // A favourite is not one of the prefixed domain entities, so it takes a
      // bare token rather than a prefix that would claim it is.
      const id = `fav_${randomToken(16)}`;
      const createdAt = this.now();
      await t.execute(
        `insert into favorites (id, user_id, kind, target_id, sort_order, created_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [id, userId, kind, targetId, sortOrder, createdAt],
      );
      return { id, userId, kind, targetId, sortOrder, createdAt: timestamp(createdAt) };
    });
  }

  async removeFavorite(
    userId: UserId,
    kind: FavoriteKind,
    targetId: string,
    tx?: Tx,
  ): Promise<void> {
    await this.reader(tx).execute(
      `delete from favorites where user_id = $1 and kind = $2 and target_id = $3`,
      [userId, kind, targetId],
    );
  }

  async #require(t: SqlExecutor, id: ViewId): Promise<SavedView> {
    const view = await this.byId(id, t);
    if (view === null) throw new NotFoundError("SavedView", id);
    return view;
  }
}
