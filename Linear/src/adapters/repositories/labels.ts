import "server-only";

/**
 * Labels.
 *
 * The smallest repository here, and the only one whose scoping rule is worth
 * stating: a label is either workspace-wide (`team_id is null`) or scoped to
 * one team, and the set usable *by* a team is the union of the two. That is why
 * {@link SqlLabelRepository.listForWorkspace} takes an optional team rather than
 * two methods — the picker in an issue's label menu always wants the union, and
 * a caller that had to remember to concatenate two lists would eventually
 * forget in one of the four places it renders.
 *
 * Ordering is alphabetical, not manual: Linear has no order key on labels, and
 * a set that is picked by typing wants to be findable rather than arranged.
 */

import type { SqlExecutor } from "@/adapters/db/driver";
import type { Label, LabelId, TeamId, WorkspaceId } from "@/domain/entities";
import { newId } from "@/lib/ids";
import {
  ConflictError,
  type CreateLabelInput,
  type LabelRepository,
  NotFoundError,
  type Patch,
  type Tx,
} from "@/ports/repositories";

import { appendChangeEvent } from "./changefeed";
import { BaseRepository, mapLabelRow, Params } from "./shared";

const LABEL_COLUMNS = `id, workspace_id, team_id, name, color, description,
  parent_id, created_at`;

export class SqlLabelRepository extends BaseRepository implements LabelRepository {
  async create(input: CreateLabelInput, tx?: Tx): Promise<Label> {
    const id = input.id ?? newId("lbl");
    if (input.parentId === id) {
      throw new ConflictError("A label cannot be its own group");
    }
    return this.atomically(tx, async (t) => {
      await t.execute(
        `insert into labels (id, workspace_id, team_id, name, color, description,
                             parent_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          input.workspaceId,
          input.teamId ?? null,
          input.name,
          input.color,
          input.description ?? null,
          input.parentId ?? null,
          this.now(),
        ],
      );
      await appendChangeEvent(t, {
        workspaceId: input.workspaceId,
        entity: "label",
        entityId: id,
        action: "create",
        payload: { name: input.name, teamId: input.teamId ?? null },
      });
      return this.#require(t, id);
    });
  }

  async byId(id: LabelId, tx?: Tx): Promise<Label | null> {
    const rows = await this.reader(tx).query(
      `select ${LABEL_COLUMNS} from labels where id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapLabelRow(row);
  }

  async listForWorkspace(
    workspaceId: WorkspaceId,
    teamId?: TeamId | null,
    tx?: Tx,
  ): Promise<Label[]> {
    const params = new Params();
    const workspace = params.bind(workspaceId);
    const scope =
      teamId === undefined || teamId === null
        ? "team_id is null"
        : `(team_id is null or team_id = ${params.bind(teamId)})`;
    const rows = await this.reader(tx).query(
      `select ${LABEL_COLUMNS} from labels
        where workspace_id = ${workspace} and ${scope}
        order by name asc`,
      params.values,
    );
    return rows.map(mapLabelRow);
  }

  async update(
    id: LabelId,
    patch: Patch<Pick<Label, "name" | "color" | "description" | "parentId">>,
    tx?: Tx,
  ): Promise<Label> {
    return this.atomically(tx, async (t) => {
      const before = await this.#require(t, id);
      const params = new Params();
      const sets: string[] = [];
      if (patch.name !== undefined) sets.push(`name = ${params.bind(patch.name)}`);
      if (patch.color !== undefined) sets.push(`color = ${params.bind(patch.color)}`);
      if (patch.description !== undefined) {
        sets.push(`description = ${params.bind(patch.description)}`);
      }
      if (patch.parentId !== undefined) {
        if (patch.parentId === id) {
          throw new ConflictError("A label cannot be its own group");
        }
        sets.push(`parent_id = ${params.bind(patch.parentId)}`);
      }
      if (sets.length === 0) return before;

      await t.execute(
        `update labels set ${sets.join(", ")} where id = ${params.bind(id)}`,
        params.values,
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "label",
        entityId: id,
        action: "update",
        payload: { name: patch.name ?? before.name },
      });
      return this.#require(t, id);
    });
  }

  async delete(id: LabelId, tx?: Tx): Promise<void> {
    await this.atomically(tx, async (t) => {
      const before = await this.byId(id, t);
      if (before === null) return;
      // `issue_labels` cascades and `labels.parent_id` is `on delete set null`,
      // so deleting a group promotes its children rather than deleting them.
      await t.execute(`delete from labels where id = $1`, [id]);
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "label",
        entityId: id,
        action: "delete",
        payload: { name: before.name },
      });
    });
  }

  async #require(t: SqlExecutor, id: LabelId): Promise<Label> {
    const label = await this.byId(id, t);
    if (label === null) throw new NotFoundError("Label", id);
    return label;
  }
}
