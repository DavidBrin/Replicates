// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { PgliteDatabase } from "@/adapters/db/pglite";
import { SCHEMA_SQL } from "@/adapters/db/schema";
import {
  type Issue,
  type OrderBy,
  PRIORITY_HIGH,
  PRIORITY_LOW,
  PRIORITY_MEDIUM,
  PRIORITY_NONE,
  PRIORITY_URGENT,
  type StateType,
} from "@/domain/entities";
import {
  compareIssues,
  compareWorkflowStates,
  issueOrderBySql,
  priorityRank,
  priorityRankSql,
  type SortableIssue,
  type SortDirection,
  STATE_TYPE_RANK,
  workflowStateOrderBySql,
} from "@/domain/sorting";

/**
 * The two implementations of "sorted", checked against each other.
 *
 * The comparators and the `order by` fragments have to agree — one runs when a
 * view loads and the other when an optimistic edit re-slots a row without a
 * round trip, and a disagreement shows up as a row that jumps when the server's
 * answer arrives. So most of these tests sort the same fixture both ways and
 * assert the two results are identical, rather than asserting each against a
 * hand-written expectation that could be wrong in the same direction twice.
 */

let db: SqlDatabase;

interface Row extends SortableIssue {
  readonly id: string;
}

const ISSUES: readonly Row[] = [
  {
    id: "iss_1",
    title: "Zebra",
    priority: PRIORITY_NONE,
    sortOrder: "a1",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
    dueDate: "2026-04-10",
  },
  {
    id: "iss_2",
    title: "apple",
    priority: PRIORITY_URGENT,
    sortOrder: "a3",
    createdAt: "2026-03-02T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    dueDate: null,
  },
  {
    id: "iss_3",
    title: "Mango",
    priority: PRIORITY_MEDIUM,
    sortOrder: "Zz",
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z",
    dueDate: "2026-04-01",
  },
  {
    id: "iss_4",
    title: "banana",
    priority: PRIORITY_HIGH,
    sortOrder: "a2",
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-03T00:00:00.000Z",
    dueDate: null,
  },
  {
    id: "iss_5",
    title: "cherry",
    priority: PRIORITY_LOW,
    sortOrder: "a0",
    createdAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-02T00:00:00.000Z",
    dueDate: "2026-03-20",
  },
];

async function sortInSql(
  orderBy: OrderBy,
  direction: SortDirection,
): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `select i.id from issues i order by ${issueOrderBySql(orderBy, direction, "i")}`,
  );
  return rows.map((row) => row.id);
}

function sortInJs(orderBy: OrderBy, direction: SortDirection): string[] {
  return [...ISSUES].sort(compareIssues(orderBy, direction)).map((issue) => issue.id);
}

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
  await db.execute(
    `insert into users (id, email, password_hash, name, display_name, avatar_color)
     values ('usr_a','a@x.test','h','Ann','ann','#5e6ad2')`,
  );
  await db.execute(
    `insert into workspaces (id, name, url_key) values ('wsp_1','W','w')`,
  );
  await db.execute(
    `insert into teams (id, workspace_id, name, key) values ('tem_1','wsp_1','Eng','ENG')`,
  );
  await db.execute(
    `insert into workflow_states (id, team_id, name, type, color, position)
     values ('sta_1','tem_1','Todo','unstarted','#e2e2e2',0)`,
  );
  for (const [index, issue] of ISSUES.entries()) {
    await db.execute(
      `insert into issues (id, team_id, number, title, state_id, priority,
                           creator_id, sort_order, due_date, created_at, updated_at)
       values ($1,'tem_1',$2,$3,'sta_1',$4,'usr_a',$5,$6,$7,$8)`,
      [
        issue.id,
        index + 1,
        issue.title,
        issue.priority,
        issue.sortOrder,
        issue.dueDate,
        issue.createdAt,
        issue.updatedAt,
      ],
    );
  }
});

afterAll(async () => {
  await db.close();
});

describe("priority", () => {
  it("sorts No priority last, not first", () => {
    // The trap: `priority` is 0 for "No priority", so `order by priority asc`
    // puts every unprioritised issue at the top of the list.
    expect(priorityRank(PRIORITY_URGENT)).toBeLessThan(priorityRank(PRIORITY_LOW));
    expect(priorityRank(PRIORITY_NONE)).toBeGreaterThan(priorityRank(PRIORITY_LOW));
  });

  it("says the same thing in SQL", async () => {
    const rows = await db.query<{ id: string }>(
      `select id from issues order by ${priorityRankSql("issues")} asc, id asc`,
    );
    expect(rows.map((row) => row.id)).toEqual([
      "iss_2", // urgent
      "iss_4", // high
      "iss_3", // medium
      "iss_5", // low
      "iss_1", // none — last
    ]);
  });

  it("rejects an alias that is not an identifier", () => {
    expect(() => priorityRankSql("i; drop table issues; --")).toThrow(
      /Unsafe SQL alias/,
    );
  });
});

describe("the two implementations agree", () => {
  const cases: readonly [OrderBy, SortDirection][] = [
    ["manual", "asc"],
    ["manual", "desc"],
    ["priority", "asc"],
    ["priority", "desc"],
    ["created", "asc"],
    ["created", "desc"],
    ["updated", "asc"],
    ["updated", "desc"],
    ["dueDate", "asc"],
    ["dueDate", "desc"],
    ["title", "asc"],
    ["title", "desc"],
  ];

  for (const [orderBy, direction] of cases) {
    it(`${orderBy} ${direction}`, async () => {
      expect(sortInJs(orderBy, direction)).toEqual(
        await sortInSql(orderBy, direction),
      );
    });
  }
});

describe("manual order", () => {
  it("is byte-wise, so a drag-to-top key sorts first", async () => {
    // `Zz` is what `keyBetween(null, "a0")` produces. Under Postgres' default
    // ICU collation it sorts *last*; the column is declared `collate "C"` for
    // exactly this reason.
    expect((await sortInSql("manual", "asc"))[0]).toBe("iss_3");
    expect(sortInJs("manual", "asc")[0]).toBe("iss_3");
  });
});

describe("due dates", () => {
  it("keeps issues without one at the end in both directions", async () => {
    const ascending = await sortInSql("dueDate", "asc");
    const descending = await sortInSql("dueDate", "desc");
    expect(ascending.slice(-2).sort()).toEqual(["iss_2", "iss_4"]);
    expect(descending.slice(-2).sort()).toEqual(["iss_2", "iss_4"]);
  });
});

describe("determinism", () => {
  it("breaks every tie on id", () => {
    for (const orderBy of ["manual", "priority", "created", "updated", "dueDate", "title"] as const) {
      expect(issueOrderBySql(orderBy, "asc", "i")).toContain("i.id asc");
    }
  });

  it("orders two issues that share a sort key by id", () => {
    const tied: SortableIssue[] = [
      { ...ISSUES[0]!, id: "iss_b", sortOrder: "a0" },
      { ...ISSUES[0]!, id: "iss_a", sortOrder: "a0" },
    ];
    expect(tied.sort(compareIssues("manual", "asc")).map((i) => i.id)).toEqual([
      "iss_a",
      "iss_b",
    ]);
  });

  it("keeps the id tiebreak ascending even when the sort is descending", () => {
    const tied: SortableIssue[] = [
      { ...ISSUES[0]!, id: "iss_b", sortOrder: "a0" },
      { ...ISSUES[0]!, id: "iss_a", sortOrder: "a0" },
    ];
    expect(tied.sort(compareIssues("manual", "desc")).map((i) => i.id)).toEqual([
      "iss_a",
      "iss_b",
    ]);
  });
});

describe("workflow states", () => {
  const state = (
    id: string,
    name: string,
    type: StateType,
    position: number,
  ) => ({ id, name, type, position });

  it("groups by type in the order the domain declares", () => {
    expect(STATE_TYPE_RANK.triage).toBeLessThan(STATE_TYPE_RANK.backlog);
    expect(STATE_TYPE_RANK.started).toBeLessThan(STATE_TYPE_RANK.completed);
    expect(STATE_TYPE_RANK.completed).toBeLessThan(STATE_TYPE_RANK.canceled);
  });

  it("orders by type, then position, then name", () => {
    const states = [
      state("sta_4", "Done", "completed", 0),
      state("sta_2", "In Review", "started", 1),
      state("sta_1", "In Progress", "started", 0),
      state("sta_3", "Backlog", "backlog", 0),
      state("sta_5", "Alpha", "started", 1),
    ];
    expect(states.sort(compareWorkflowStates).map((s) => s.name)).toEqual([
      "Backlog",
      "In Progress",
      // Same type, same position — the name breaks the tie so the order does
      // not change between page loads.
      "Alpha",
      "In Review",
      "Done",
    ]);
  });

  it("says the same thing in SQL", async () => {
    await db.execute(
      `insert into workflow_states (id, team_id, name, type, color, position) values
        ('sta_bk','tem_1','Backlog','backlog','#bec2c8',0),
        ('sta_ip','tem_1','In Progress','started','#f2c94c',0),
        ('sta_dn','tem_1','Done','completed','#5e6ad2',0)`,
    );
    const rows = await db.query<{ name: string }>(
      `select s.name from workflow_states s where s.team_id = 'tem_1'
        order by ${workflowStateOrderBySql("s")}`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
    ]);
  });
});

describe("timestamps sort as strings", () => {
  it("only because the mappers normalise them to UTC", () => {
    // The comparators compare ISO strings rather than parsing to `Date`. That
    // is safe for `…Z` and wrong for a local-offset string, which is why the
    // repository mappers convert rather than pass through.
    const utc: Issue["createdAt"][] = [
      "2026-03-01T23:00:00.000Z",
      "2026-03-02T01:00:00.000Z",
    ];
    expect([...utc].sort()).toEqual(utc);

    const localOffset = ["2026-03-01T23:00:00.000-08:00", "2026-03-02T01:00:00.000Z"];
    const byInstant = [...localOffset].sort(
      (a, b) => Date.parse(a) - Date.parse(b),
    );
    expect([...localOffset].sort()).not.toEqual(byInstant);
  });
});
