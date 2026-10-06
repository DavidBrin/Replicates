/**
 * The route tests' harness: one embedded Postgres per suite, the fake engine
 * injected, and the handlers called as plain functions with plain `Request`s.
 *
 * No HTTP server and no mocked repository — the SQL under test is the SQL
 * Neon will run, which is the whole reason the scaffold chose PGlite over
 * SQLite (`src/adapters/db/driver.ts`).
 */
import { setDbForTests } from "@/adapters/db";
import { PgliteDatabase } from "@/adapters/db/pglite";
import { SCHEMA_SQL } from "@/adapters/db/schema";
import type { Rules } from "@/engine/types";
import { DEFAULT_RULES } from "@/engine/types";

import { resetServerCaches, setServerEngineForTests, type ServerEngine } from "../engine";
import { resetSweepClockForTests } from "../reaper";
import { GET as pollLobby } from "@/app/api/lobby/route";
import { POST as createLobbyRoute } from "@/app/api/lobbies/route";
import { GET as pollRoom, PATCH as patchRoom } from "@/app/api/lobbies/[code]/route";
import { POST as joinRoute } from "@/app/api/lobbies/[code]/join/route";
import { POST as leaveRoute } from "@/app/api/lobbies/[code]/leave/route";
import { POST as readyRoute } from "@/app/api/lobbies/[code]/ready/route";
import { POST as startRoute } from "@/app/api/lobbies/[code]/start/route";
import {
  DELETE as deleteSession,
  PATCH as patchSession,
  POST as postSession,
} from "@/app/api/session/route";
import { GET as pollGameRoute } from "@/app/api/games/[id]/route";
import {
  GET as debugActions,
  POST as postAction,
} from "@/app/api/games/[id]/actions/route";
import { POST as resignRoute } from "@/app/api/games/[id]/resign/route";
import { POST as postChat } from "@/app/api/chat/route";

import { fakeEngine } from "./fakeEngine";

export interface Harness {
  readonly db: PgliteDatabase;
  dispose(): Promise<void>;
}

export async function startHarness(engine?: Partial<ServerEngine>): Promise<Harness> {
  const db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  const disposeDb = setDbForTests(db);
  await db.migrate();
  const restoreEngine = setServerEngineForTests(engine ?? fakeEngine());
  resetSweepClockForTests();
  return {
    db,
    async dispose() {
      restoreEngine();
      resetServerCaches();
      resetSweepClockForTests();
      await disposeDb();
    },
  };
}

/* --------------------------------------------------------------- requests -- */

export interface Session {
  readonly playerId: string;
  readonly displayName: string;
  readonly cookie: string;
}

export function req(
  url: string,
  init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers["cookie"] = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://test${url}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined
      ? {}
      : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
  });
}

const params = <T extends Record<string, string>>(value: T) => ({
  params: Promise.resolve(value),
});

/** Pull the `risk_sid=…` pair out of a `Set-Cookie` header. */
export function cookieOf(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

/* ---------------------------------------------------------------- session -- */

export async function claim(
  displayName: string,
  colour?: string,
): Promise<Session | { conflict: Response }> {
  const response = await postSession(
    req("/api/session", {
      method: "POST",
      body: colour === undefined ? { displayName } : { displayName, colour },
    }),
  );
  if (response.status !== 200) return { conflict: response };
  const body = (await response.json()) as { playerId: string; displayName: string };
  return { playerId: body.playerId, displayName: body.displayName, cookie: cookieOf(response) };
}

export async function mustClaim(displayName: string, colour?: string): Promise<Session> {
  const result = await claim(displayName, colour);
  if ("conflict" in result) throw new Error(`could not claim ${displayName}`);
  return result;
}

export const routes = {
  postSession,
  patchSession,
  deleteSession,
  pollLobby,
  createLobby: createLobbyRoute,
  pollRoom: (code: string, request: Request) => pollRoom(request, params({ code })),
  patchRoom: (code: string, request: Request) => patchRoom(request, params({ code })),
  join: (code: string, request: Request) => joinRoute(request, params({ code })),
  leave: (code: string, request: Request) => leaveRoute(request, params({ code })),
  ready: (code: string, request: Request) => readyRoute(request, params({ code })),
  start: (code: string, request: Request) => startRoute(request, params({ code })),
  pollGame: (id: string, request: Request) => pollGameRoute(request, params({ id })),
  postAction: (id: string, request: Request) => postAction(request, params({ id })),
  debugActions: (id: string, request: Request) => debugActions(request, params({ id })),
  resign: (id: string, request: Request) => resignRoute(request, params({ id })),
  postChat,
};

/* ------------------------------------------------------------------ flows -- */

export const TEST_RULES: Rules = { ...DEFAULT_RULES, turnSeconds: 90 };

export async function createLobby(
  session: Session,
  overrides: Partial<{ title: string; mapSlug: string; rules: Rules; maxSeats: number }> = {},
): Promise<string> {
  const response = await routes.createLobby(
    req("/api/lobbies", {
      method: "POST",
      cookie: session.cookie,
      body: {
        title: overrides.title ?? "Test lobby",
        mapSlug: overrides.mapSlug ?? "ring",
        rules: overrides.rules ?? TEST_RULES,
        maxSeats: overrides.maxSeats ?? 6,
      },
    }),
  );
  if (response.status !== 201) {
    throw new Error(`createLobby: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { code: string }).code;
}

export async function joinLobby(session: Session, code: string, seat?: number): Promise<Response> {
  return routes.join(
    code,
    req(`/api/lobbies/${code}/join`, {
      method: "POST",
      cookie: session.cookie,
      body: seat === undefined ? {} : { seat },
    }),
  );
}

export async function readyUp(session: Session, code: string, ready = true): Promise<Response> {
  return routes.ready(
    code,
    req(`/api/lobbies/${code}/ready`, {
      method: "POST",
      cookie: session.cookie,
      body: { ready },
    }),
  );
}

export async function startGame(session: Session, code: string): Promise<Response> {
  return routes.start(code, req(`/api/lobbies/${code}/start`, { method: "POST", cookie: session.cookie }));
}

export interface TwoPlayerGame {
  readonly gameId: string;
  readonly code: string;
  readonly a: Session;
  readonly b: Session;
}

/**
 * The common fixture: two humans in one lobby, both ready, game started.
 *
 * Seat 0 is the host (`a`) and seat 1 is `b`, because `startLobby` compacts
 * the occupied seats in seat order.
 */
export async function twoPlayerGame(
  rules: Rules = TEST_RULES,
  names: [string, string] = ["Alpha", "Bravo"],
): Promise<TwoPlayerGame> {
  const a = await mustClaim(names[0]);
  const b = await mustClaim(names[1]);
  const code = await createLobby(a, { rules, maxSeats: 2 });
  await joinLobby(b, code);
  await readyUp(a, code);
  await readyUp(b, code);
  const started = await startGame(a, code);
  if (started.status !== 201) {
    throw new Error(`startGame: ${started.status} ${await started.text()}`);
  }
  const { gameId } = (await started.json()) as { gameId: string };
  return { gameId, code, a, b };
}

/** One human and one bot, so the lazy tick has a bot seat to run. */
export async function humanVsBotGame(rules: Rules = TEST_RULES): Promise<{
  gameId: string;
  code: string;
  a: Session;
}> {
  const a = await mustClaim("Alpha");
  const code = await createLobby(a, { rules, maxSeats: 2 });
  await routes.patchRoom(
    code,
    req(`/api/lobbies/${code}`, {
      method: "PATCH",
      cookie: a.cookie,
      body: { seats: [{ seat: 1, kind: "bot", tier: "medium" }] },
    }),
  );
  await readyUp(a, code);
  const started = await startGame(a, code);
  if (started.status !== 201) {
    throw new Error(`startGame: ${started.status} ${await started.text()}`);
  }
  const { gameId } = (await started.json()) as { gameId: string };
  return { gameId, code, a };
}

/* ------------------------------------------------------------------ polls -- */

export async function poll(
  session: Session,
  gameId: string,
  since = 0,
  chatSince = 0,
  headers: Record<string, string> = {},
): Promise<Response> {
  return routes.pollGame(
    gameId,
    req(`/api/games/${gameId}?since=${since}&chatSince=${chatSince}`, {
      cookie: session.cookie,
      headers,
    }),
  );
}

export async function submit(
  session: Session,
  gameId: string,
  body: unknown,
): Promise<Response> {
  return routes.postAction(
    gameId,
    req(`/api/games/${gameId}/actions`, { method: "POST", cookie: session.cookie, body }),
  );
}

/** A `clientActionId` long enough for the schema's 8-character floor. */
export function actionId(label: string): string {
  return `cid-${label}-0000`;
}
