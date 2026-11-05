# Plan 7: a relay through the room, and online play for up to four

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: approved by David (2026-11-04: "go A then B, defaults and recommendations work"); executing.** Written against `main` at `b53ebdd` (Plan 6 deployed, `ENGINE_RULES_VERSION` 6). Unlike Plan 6 it was not replayed in a scratch copy, so every red-step message is (predicted). A test that fails for the stated reason proceeds even if its wording differs (note it). A test that passes before the change, or fails for another reason, stops the task. Line numbers were read at `b53ebdd`. Earlier tasks move them, so the implementer finds each edit by the symbol named beside it.

**Goal:** Players whose networks block a direct WebRTC link play anyway, through the room's Durable Object (Phase A, shipped and deployed first). Then rooms hold up to four players online, all of them through that relay (Phase B).

**Architecture:**
- **The room relays game data.** The room Durable Object gets a second, binary path beside its JSON signalling. It forwards a binary frame from one socket to every other socket, prefixed with the sender's id, and never parses the frame.
- **The transport switches route.** `adapters/doSignal.ts` gets a relay mode. It sends the rollback session's packets through the room socket, two frames' packets per WebSocket message, and receives them the same way. The rollback session still sees only `Transport`.
- **Both sides agree on the fallback.** Where Task 40b's "no direct link" ended the session, `OnlineSession` now tells the other side to use the relay (`use-relay`, through the room) and switches. The relay is sticky for the room.
- **Phase B.** Rooms hold up to four players, and the room assigns each one a port. A room that has seated three players uses the relay. The rollback session's two-peer assumptions become per-peer. A waiting room lets the host start once everyone is in and on the same build.

**Tech Stack:** TypeScript 5 (strict), Next.js 16.3 static export, React 19, zustand, vitest 4.1 (jsdom, @testing-library/react), Playwright 1.62 (Chromium), wrangler 4.146 (`unstable_startWorker` via `scripts/e2e/wrangler-e2e.mjs`), Cloudflare Workers Free plan with one SQLite-backed Durable Object class (`RoomDO`), pnpm 11. Nothing new is installed.

**Spec:** the Spec section below: David's decisions of 2026-11-04. There is no separate document, so the Spec travels inside this plan.

## Spec

There is no separate spec document. These are David's decisions of 2026-11-04, and they bind every task.

- **Problem.** The live site has no TURN relay: David has no payment card, which rules out Cloudflare TURN, Metered and the like. Players whose networks block a direct WebRTC link wait about 15 s and are told "Couldn't connect directly…" (Plan 6, Task 40b). Online play is exactly 2 players.
- **Phase A: a relay fallback for 2 players, shipped and deployed on its own first.**
  - **Agreement.** When the direct link can't open, both sides agree through the room, as 40b's notify pattern does. They then carry game data through the room Durable Object, over the existing room WebSocket, instead of failing.
  - **The Durable Object forwards game data payload-blind.** It never parses it, stamps the sender, never echoes to the sender, and does not count it toward the 2000-message signalling cap. It keeps peers in memory on the hot path (no storage or attachment write per message), and it keeps the hibernation API (no timers in the Durable Object).
  - **Abuse guard.** Game data gets its own size cap and rate cap, with pinned values, because it costs the shared daily budget.
  - **Coalescing.** In relay mode the client puts two frames' packets in each WebSocket message, which doubles the free plan's allowance at about one frame of extra delay. The batching rule and the wire framing are pinned.
  - **Room socket.** In relay mode, losing the room socket is losing the link.
  - **UI.** The lobby status reads "Connecting through the relay…", and the in-match net HUD shows the route (relay or direct).
  - **E2E.** The online e2e that expects the no-direct-link sentence (`e2e-online/online.spec.ts` ~:235) becomes "falls back to the relay and plays to a result".
  - **Unchanged.** The direct path is unchanged when it works. `?ice=relay` keeps its meaning: force TURN.
- **Phase B: 3 to 4 players online.**
  - **Rooms and seats.** Rooms hold up to 4 (`MAX_PLAYERS` is 4 locally). The room assigns seats and ports: the host is port 0, and each guest takes the lowest free port.
  - **Topology.** 3-4 player matches always use the relay, a star through the Durable Object, from the start, with no WebRTC mesh. 2-player matches keep direct-first with the relay fallback.
  - **Waiting room.** The host sees who has joined and presses Start once at least 2 are seated and every peer has passed the build check (the hello). Guests see their seat.
  - **Picks.** Each seat picks its own fighter, and the host picks the stage. Match settings accept 2-4 fighters, with the 1v1 rules only when there are 2.
  - **Rollback for N peers.** Desync hashes are compared per sending port and peer. Frame advantage is tracked per peer. Input-delay tuning follows the slowest peer's RTT.
  - **Leaving.** Any player leaving or going silent mid-match ends the match for everyone, which is today's connection-lost behaviour, generalized.
  - **HUD.** The net HUD shows the worst ping.
  - **E2E.** A 4-browser online e2e must be proven early in Phase B. Four WebGL pages at once on one machine is a real risk, so a spike task first proves that 4 pages can run a match frame loop, before anything builds on it.
- **Budget facts** (quoted in D60). The Durable Objects free plan allows 100,000 requests a day. Incoming WebSocket messages are billed 20:1, and outgoing ones are free. The budget resets at 00:00 UTC, and exceeding it fails every room until the reset. A relayed 8-minute match costs about 1,442 requests for 2 players at 30 messages/s, and about 2,884 for 4 players at 30 messages/s.

**Records.**
- **D60.** This plan's decision is D60 in `DECISIONS.md`. Task 7 writes its Phase A part, and Task 18 adds Phase B.
- **SPEC changes.** These go in the tasks whose behaviour they describe:
  - §5 in Tasks 4, 10, 12 and 16;
  - §9 in Tasks 5 and 14;
  - §12 in Tasks 7 and 18;
  - §2 in Task 18.

**Research this plan is built on** (session notes, not in the repo):
- the codebase scoping: every two-player hardcode, the transport port, the room server, the 40b hook;
- the platform scoping: Cloudflare free-plan limits and budget arithmetic, and N-player rollback practice.

The hardcode table's 15 rows map to tasks in "Coverage of the two-player hardcodes" near the end.

**Conventions for every task** (carried from Plans 1-6, adapted)

*Where things run.*
- `pnpm …` commands run in `super-smash/`, and paths in steps are relative to it.
- `git …` commands run from the repository root, with paths prefixed `super-smash/`.
- `$SCRATCH` is the session scratchpad that the executing session's system prompt names, outside the repo. It holds logs only, and nothing written there is copied into the repo. Shell state does not persist between commands, so every step that uses it sets it and checks it with `test -d "$SCRATCH"` in the same command.

*Git.*
- Commit straight to `main`. Never `git add -A`, `git add .` or `git commit -a`: stage the exact files listed, by name.
- Every commit body ends with the `Co-Authored-By:` trailer that the session's attribution names.
- **Implementers never push.** The controller pushes `main`: after Task 7's review and gate (the Deploy checkpoint), and again after Task 18's.
- **Never force-push. Never `--no-verify`, nor bypass a hook in any other form. Never `pkill -f`:** stop a process by its PID or its port.

*How steps are written.*
- Steps give the file, the exact signature, the pinned values, and the test names and assertions. The implementer writes the bodies. A code block appears only for an algorithm the signature leaves open, or for copy the spec fixes.
- Edits name the symbol they change. The line numbers in **Files** are `b53ebdd`'s.

*Every task's gate*, in this order, all from `super-smash/`:
1. **Static checks and the suite.** `pnpm typecheck && pnpm lint && pnpm test > "$SCRATCH/suite-<task>.log" 2>&1`: exit 0. Lint's two pre-existing `research/` warnings are not errors. Then `grep -c "not wrapped in act\|Not implemented" "$SCRATCH/suite-<task>.log"` prints at most 1: the carried canvas `getContext` line. A new line is this task's to fix.
2. **The golden does not move.** No task changes `step()`, `ENGINE_RULES_VERSION` (stays 6) or `PROTOCOL_VERSION` (stays 2): the packet layouts are unchanged, and the relay framing wraps them. `src/game/golden.test.ts` and `src/game/rulesVersion.test.ts` pass untouched inside `pnpm test`. A task that moves either stops.
3. **Worker tasks (1 and 9): the live-room test.**
   - Start the e2e server in the background: `node scripts/e2e/wrangler-e2e.mjs 8787 > "$SCRATCH/worker-<task>.log" 2>&1 &`. Note its PID, and wait for `E2E-READY` in the log.
   - Run `WORKER_URL=http://localhost:8787 pnpm vitest run src/net/roomWorker.integration.test.ts`, which must pass with nothing skipped.
   - Stop the server by its PID.
4. **UI or online behaviour.** Where the task changes either, run `PORT=3107 pnpm test:e2e --trace off`. Where it changes online behaviour, also run `pnpm test:e2e:online --trace off`.
   - With local models present, no real-model frame may land in `test-results/`, so every Playwright run passes `--trace off`.
   - Plan 1's single-rerun rule covers a cold-start timeout.
   - A run at a machine load over 6 is not a pass.
5. **Mutants.** Each new test has a named mutant.
   - Apply it by hand, run the test's file to a log, and see it fail as named.
   - Restore it, and check `git diff --exit-code -- <file>` before committing.
   - Never pipe a mutant run to `head`: a SIGPIPE leaves the mutant in the tree.

## Global Constraints

- **Determinism and layering (SPEC §3):**
  - `src/engine/**` is untouched.
  - `src/net/rollback.ts` imports `Transport` and never an adapter.
  - `worker/tsconfig.json` keeps compiling only `src/net/signalProtocol.ts`, `iceConfig.ts` and `roomCode.ts` from the app. The Durable Object never imports `packet.ts`.
- **The room is payload-blind:**
  - A binary frame is game data, and the Durable Object never parses it.
  - It prefixes the sender's id, which it stamps and never reads from the client.
  - It never echoes a frame to its sender, and never counts game data toward `MAX_MESSAGES_PER_PEER` (2000).
  - It never writes storage or an attachment per game message, and never sets a timer or alarm.
- **Relay limits (pinned in `src/net/signalProtocol.ts`):**
  - `RELAY_ID_BYTES = 8`: the room's peer ids are `crypto.randomUUID().slice(0, 8)`, which is 8 ASCII bytes.
  - `RELAY_MAX_FRAME_BYTES = 2048`, the client's payload. A larger frame closes the socket with `bad-message` (4004).
  - `RELAY_RATE_PER_SECOND = 40` and `RELAY_BURST = 80`: a per-socket token bucket. A frame over the rate is dropped silently. The client sends 30 a second.
- **Client relay (pinned in `src/net/relayFrame.ts`):**
  - `RELAY_INPUTS_PER_MESSAGE = 2`.
  - `RELAY_MAX_BUFFERED_BYTES = 16 * 1024`: a send while the socket's `bufferedAmount` is above this is dropped.
  - The wire framing is in Task 2.
- **Copy, verbatim:**
  - The lobby's relay status: "Connecting through the relay…".
  - The HUD's route tag: `RELAY` / `DIRECT`, after the rollback count (Task 6).
  - Phase B's waiting-room copy is in Task 14.
  - The full room: "Room ABCD already has four players." (Task 14).
- **Behaviour:**
  - The direct path is unchanged when it opens.
  - `?ice=relay` still means "force TURN", not "use the room relay".
  - Losing the room socket in relay mode is losing the link.
  - Relay is sticky for the room.
  - 3-4 player rooms are relay-only. 2-player rooms try direct first.
  - Any player leaving or going silent mid-match ends it for everyone.
- **Public repo:**
  - Never commit a Nintendo-ripped file or a screenshot of a real model.
  - The multi-page e2e routes `/models/` to 404 (stand-ins) on every context it opens.
- **Browser:** Playwright only.
- **Outward actions:**
  - Deploying, and anything on Cloudflare (dashboards included), is the controller's, and only on David's go.
  - No task makes a web request.

## Review Focus

These are five conditions that no feature test would meet on its own and that are most likely to hurt a player. Each has its pinning test in the task named.

1. **One side's deadline fires while the other side's channel opened.** The host's 15 s deadline starts before the guest's, so the host can give up at the moment the guest's channel opens. Both must end up on the relay, with the peer announced once and no error.
   - Test: `src/net/online/session.test.ts`, "Review Focus: a use-relay that lands while this side's direct channel is open moves it to the relay, and announces the peer once".
   - Owner: Task 4.
2. **The room socket drops mid-relay**: a Worker deploy (1006), the daily budget running out (any code), or a proxy timeout. The match must end as Connection Lost at once, never freeze.
   - Test: `src/net/adapters/doSignal.test.ts`, "Review Focus: a room socket that closes mid-relay, with any close code, is every relayed peer leaving".
   - Owner: Task 3.
3. **A fourth player arrives as the host presses Start.** A seated peer whose hello is still pending holds the Start. A peer seated after the begin, with no seat free, is told the room began, and leaves.
   - Test: `src/lib/onlineStore.test.ts`, "Review Focus: a joiner whose hello is pending holds the Start, and one seated after the begin with no seat free is told and leaves".
   - Owner: Task 14.
4. **A guest leaves after the begin, and the seat is reused.** The next joiner must take that match port with an empty panel, and the host repeats its stage.
   - Test: `src/lib/onlineStore.test.ts`, "Review Focus: a seat emptied after the begin goes to the next joiner, on the same port, with an empty panel".
   - Owner: Task 14.
5. **A third player joins while the first two negotiate directly.** All three must go to the relay. The half-open connection closes, no offer goes to the newcomer, and a late answer or ICE from the old negotiation is ignored.
   - Test: `src/net/online/session.test.ts`, "Review Focus: a third player joining mid-negotiation moves all three to the relay and leaves the old negotiation unanswered".
   - Owner: Task 12.

---

# Phase A: the relay fallback (two players)

## Task 1: The room relays game frames it never reads

**Files:**
- Modify: `src/net/signalProtocol.ts` (constants beside `MAX_MESSAGES_PER_PEER`, :45)
- Modify: `worker/src/room.ts` (new exports after `relay`, :67-79)
- Modify: `worker/src/roomDO.ts` (`webSocketMessage` :62-86, `fetch` :54-58, `depart` :101-110)
- Test: `worker/src/room.test.ts`, `src/net/roomWorker.integration.test.ts`

**Interfaces:**
- Produces, in `src/net/signalProtocol.ts`:
  - `RELAY_ID_BYTES = 8`
  - `RELAY_MAX_FRAME_BYTES = 2048`
  - `RELAY_RATE_PER_SECOND = 40`
  - `RELAY_BURST = 80`
- Produces, in `worker/src/room.ts`:
  - `interface RelayBucket { tokens: number; atMs: number }` (mutable; it lives in memory only)
  - `newRelayBucket(nowMs: number): RelayBucket` (full: `tokens = RELAY_BURST`)
  - `peerIdBytes(id: string): Uint8Array` (UTF-8 bytes; throws unless `RELAY_ID_BYTES` long)
  - `type GameFrameOutcome = { type: "forward"; frame: Uint8Array } | { type: "drop" } | { type: "kick"; reason: RoomError; closeCode: number; message: ServerMessage }`
  - `relayGameFrame(sender: Uint8Array, payload: ArrayBuffer, bucket: RelayBucket, nowMs: number): GameFrameOutcome`
  - `interface LivePeer { readonly id: string; readonly idBytes: Uint8Array; readonly bucket: RelayBucket }`
  - `livePeerFor(attachment: PeerAttachment | null, nowMs: number): LivePeer | null`: null for a null attachment or an id that is not `RELAY_ID_BYTES` long. It never throws.
- Wire, from the room to a client: one binary frame, `[RELAY_ID_BYTES sender id][payload as sent]`.

- [ ] **Step 1: Write the failing tests** in `worker/src/room.test.ts`, as a new `describe("relaying game frames")`.
  - `it("stamps a game frame with its sender and passes the bytes on unread")`: the payload is `new Uint8Array([0xff, 0x7b, 0x6e, 0x00, 0x01]).buffer` (not JSON). `relayGameFrame(peerIdBytes("h1abcd12"), payload, newRelayBucket(0), 0)` is `{ type: "forward" }`. The frame's first 8 bytes decode to `"h1abcd12"`, and its rest equals the payload byte for byte.
  - `it("lets RELAY_BURST frames through at once, drops the next, and refills at RELAY_RATE_PER_SECOND")`:
    - one bucket at `nowMs = 0`;
    - 80 calls forward, and the 81st is `{ type: "drop" }`;
    - at `nowMs = 1000`, 40 forward and the 41st drops;
    - at `nowMs = 100_000` the tokens cap at 80 (80 forward, the 81st drops).
  - `it("closes a socket whose game frame is over RELAY_MAX_FRAME_BYTES, and forwards one exactly at it")`:
    - 2049 bytes gives `{ type: "kick", reason: "bad-message", closeCode: ROOM_CLOSE_CODES["bad-message"], message: { t: "error", reason: "bad-message" } }`;
    - 2048 bytes forwards;
    - a 0-byte frame is `{ type: "drop" }`.
  - `it("refuses a peer id that is not RELAY_ID_BYTES long")`: `expect(() => peerIdBytes("abc")).toThrow()`.
  - `it("builds a relay entry only for an admitted peer with a well-formed id, and never throws")`: `livePeerFor(null, 0)` is null, `livePeerFor(attach({ ...host, id: "abc" }), 0)` is null (no throw), and `livePeerFor(attach({ ...host, id: "h1abcd12" }), 0)` has `id` "h1abcd12", 8 `idBytes` and a full bucket.
  - Keep `it("answers garbage with bad-message instead of passing it on")` (:86-90) as is: `relay()` stays the text path, and binary frames never reach it.
- [ ] **Step 2: Run** `pnpm vitest run worker/src/room.test.ts`. Expected: FAIL, "relayGameFrame is not a function" (predicted).
- [ ] **Step 3: Implement** the constants and the four functions.
  - `relayGameFrame` checks in this order: an empty payload drops; one over `RELAY_MAX_FRAME_BYTES` kicks; then the token bucket.
  - The token bucket refills `tokens = min(RELAY_BURST, tokens + (nowMs - atMs) * RELAY_RATE_PER_SECOND / 1000)`, then sets `atMs = nowMs`, then spends 1 token or drops.
  - It copies the payload into a new `Uint8Array(RELAY_ID_BYTES + n)` after the sender bytes, and reads none of it.
- [ ] **Step 4: Wire the Durable Object** (`worker/src/roomDO.ts`).
  - `private readonly live = new Map<WebSocket, LivePeer>()` and `private liveBuilt = false`.
  - **`private ensureLive(): void`.** The first call after construction (a hibernation wake re-runs the constructor) rebuilds `live` once from `ctx.getWebSockets()`. It keeps only OPEN sockets for which `livePeerFor(attachmentOf(ws), Date.now())` is not null, so departed sockets (attachment null) and malformed ids are skipped. It never throws.
  - `ensureLive()` is the first call in `relayGame`, `fetch` and `depart`. `fetch` then adds the admitted socket to `live`, and `depart` deletes it.
  - **`webSocketMessage`'s first line is the binary branch**: `if (typeof message !== "string") { this.relayGame(ws, message); return; }`. It comes before `attachmentOf` (:63) and the attachment counter (:66-69), so game data never touches `received` and never calls `serializeAttachment`.
  - **`relayGame`** looks up the sender in `live`, and drops the frame if it is absent. It uses `Date.now()` for `nowMs`. On `forward`, it sends `frame` to every other OPEN socket in `live`, never to `ws`. On `kick`, it does exactly what the text path's kick does.
- [ ] **Step 5: Extend the live-room test** (`src/net/roomWorker.integration.test.ts`).
  - `connect()` sets `ws.binaryType = "arraybuffer"` and files binary messages in a `games: Uint8Array[]` list instead of `JSON.parse`-ing them.
  - Add `sendBinary(bytes: Uint8Array)` to `Client`.
  - New `it("relays a binary frame to the other peer stamped with its sender, never back to it, and outside the signalling cap")`:
    - the host sends 2100 binary frames of 6 bytes in a loop;
    - within 5 s the guest has at least 1 frame, and at most `RELAY_BURST + RELAY_RATE_PER_SECOND * 5` frames (what 5 s could refill), so the rate cap dropped most of the 2100;
    - every frame's first 8 bytes are the host's welcome id, and its rest is the 6 bytes;
    - the host has 0 game frames;
    - the host then sends an offer, and the guest still receives it: neither the cap (`too-many-messages`) nor a kick closed the socket.
- [ ] **Step 6: Run** the unit tests, then gate 1 and gate 3 (the live-room test). Expected: PASS.
- [ ] **Step 7: Mutants.**
  - **Stamp.** In `relayGameFrame`, write the payload at offset 0 instead of `RELAY_ID_BYTES`: "stamps a game frame…" fails on the id bytes.
  - **Burst.** Initialise `tokens` to `RELAY_BURST + 1`: "lets RELAY_BURST frames…" fails at the 81st.
  - **Size cap.** Compare with `>=` instead of `>`: "…forwards one exactly at it" fails.
  - **Id length.** Remove the length check: "refuses a peer id…" fails.
  - **Live entry.** Return an entry for a null attachment: "builds a relay entry only…" fails.
  - **Echo** (live test). In `relayGame`, include `ws` in the targets: "…never back to it" fails on the host's game count.
- [ ] **Step 8: Commit**
```bash
git add super-smash/src/net/signalProtocol.ts super-smash/worker/src/room.ts super-smash/worker/src/roomDO.ts super-smash/worker/src/room.test.ts super-smash/src/net/roomWorker.integration.test.ts
git commit -m "super-smash: the room relays binary game frames to the other player, stamped with the sender and never read"
```

## Task 2: Relay framing, and binary frames on the room socket

**Files:**
- Create: `src/net/relayFrame.ts`, `src/net/relayFrame.test.ts`
- Modify: `src/net/signalling.ts` (`WebSocketLike` :15-23, `SignallingEvent` :25, `SignallingClient` :27-33, `onmessage` :64-74)
- Modify: `src/net/testing/fakeSignalling.ts`
- Test: `src/net/signalling.test.ts`

**Interfaces:**
- Consumes: `RELAY_ID_BYTES` and `RELAY_MAX_FRAME_BYTES` (Task 1), and `PacketType` (`packet.ts`).
- Produces, in `src/net/relayFrame.ts`:
  - `RELAY_INPUTS_PER_MESSAGE = 2`
  - `RELAY_MAX_BUFFERED_BYTES = 16 * 1024`
  - `encodeRelayBatch(packets: readonly Uint8Array[]): Uint8Array`: the concatenation of `[u16 little-endian length][packet bytes]` per packet, with no header.
  - `decodeRelayBatch(batch: Uint8Array): Uint8Array[] | null`: each packet is a fresh copy. A truncated entry or a zero-length entry gives null for the whole batch.
  - `splitRelayFrame(frame: Uint8Array): { from: string; batch: Uint8Array } | null`: null when the frame is not longer than `RELAY_ID_BYTES`.
  - `interface RelayBatcher { push(packet: Uint8Array): void; clear(): void }`, made by `createRelayBatcher(flush: (batch: Uint8Array) => void): RelayBatcher`.
- Produces, in `src/net/signalling.ts`:
  - `SignallingEvent` gains `{ readonly t: "game"; readonly from: string; readonly bytes: Uint8Array }`.
  - `SignallingClient` gains `sendGame(batch: Uint8Array): void`.
  - `WebSocketLike` gains `binaryType: string` and `readonly bufferedAmount: number`. Its `send` takes `string | Uint8Array<ArrayBuffer>`.
- Produces, in `FakeSignalling`: `readonly sentGame: Uint8Array[]`, and `sendGame` pushes to it.

**The batching rule** (it decides the extra delay, so it is pinned):
- `push` appends the packet to the queue.
- If appending would make the encoded batch longer than `RELAY_MAX_FRAME_BYTES`, the queue flushes first.
- Every packet whose byte 1 is `PacketType.Input` counts one. When the count reaches `RELAY_INPUTS_PER_MESSAGE`, the queue flushes as one batch and the count resets.
- Every flush resets the count, a size flush included.
- Ping, Pong and Hash packets ride with the next flush.
- Nothing else flushes: no timer, no microtask.
- `clear()` drops the queue.

The rollback session sends one Input packet per local port on every tick, stalled or not (`rollback.ts` `heartbeat`), and online always has one local port. So a flush happens every 2 frames.

- [ ] **Step 1: Write the failing tests** in `src/net/relayFrame.test.ts`.
  - `it("round-trips a batch of packets of every type")`: decode(encode(p)) deep-equals p for an Input of 272 bytes, a Ping of 6, a Pong of 6 and a Hash of 12.
  - `it("refuses a truncated or empty entry, whole")`: dropping the last byte, or appending `[0,0]`, gives null.
  - `it("splits the room's stamp from the batch, and refuses a frame with nothing after it")`.
  - `it("flushes on every second input packet, with the pings and hashes queued between")`: push Input, Ping, Input, Hash, Input, Input. Exactly 2 flushes; the first decodes to [Input, Ping, Input], the second to [Hash, Input, Input].
  - `it("flushes early rather than build a batch over RELAY_MAX_FRAME_BYTES, and starts the input count again")`:
    - push one Input, then eight 300-byte non-Input packets: every batch is at most 2048 bytes;
    - then push two Inputs: the next flush comes after exactly those two, and nothing pushed is lost.
  - `it("drops its queue on clear")`.
- [ ] **Step 2: Write the failing tests** in `src/net/signalling.test.ts`.
  - `it("emits a binary frame from the room as game data from its stamped sender")`: the fake socket's `onmessage` gets an `ArrayBuffer` of 8 id bytes plus 3 bytes. The event is `{ t: "game", from: "<id>", bytes: <the 3 bytes> }`.
  - `it("sends game data only on an open socket with room in its buffer, and never queues it")`:
    - nothing is sent before `onopen`, and nothing is sent after it either (not queued);
    - with the socket open and `bufferedAmount = RELAY_MAX_BUFFERED_BYTES + 1`, nothing is sent;
    - at 0 it is sent once.
  - `it("asks for binary frames as ArrayBuffers")`: `binaryType === "arraybuffer"` after `createSignallingClient`.
- [ ] **Step 3: Run** `pnpm vitest run src/net/relayFrame.test.ts src/net/signalling.test.ts`. Expected: FAIL, missing module and missing `sendGame` (predicted).
- [ ] **Step 4: Implement** `relayFrame.ts` and the signalling changes. `onmessage` routes `event.data instanceof ArrayBuffer` through `splitRelayFrame`; strings keep the JSON path. Add `sendGame` to `FakeSignalling`.
- [ ] **Step 5: Run** both files, then gate 1. Expected: PASS.
- [ ] **Step 6: Mutants.**
  - **Round trip.** Encode the length big-endian: "round-trips…" fails.
  - **Truncation.** Accept a short final entry: "refuses a truncated…" fails.
  - **Split.** Use `<` for `<=` in `splitRelayFrame`: "…refuses a frame with nothing after it" fails.
  - **Every second Input.** Flush on every Input: "flushes on every second input packet…" fails (3 flushes).
  - **Size flush.** Remove the size check: "flushes early…" fails on a batch over 2048 bytes.
  - **Count reset.** Keep the count across a size flush: "…starts the input count again" fails (a flush after one Input).
  - **Clear.** Make `clear` a no-op: "drops its queue on clear" fails.
  - **Sender.** Use `from: ""`: "emits a binary frame…" fails.
  - **Buffer check.** Drop the `bufferedAmount` check: "sends game data only…" fails.
  - **Binary type.** Remove the `binaryType` set: "asks for binary frames…" fails.
- [ ] **Step 7: Commit**
```bash
git add super-smash/src/net/relayFrame.ts super-smash/src/net/relayFrame.test.ts super-smash/src/net/signalling.ts super-smash/src/net/signalling.test.ts super-smash/src/net/testing/fakeSignalling.ts
git commit -m "super-smash: the room socket carries binary game frames, two frames' packets to a message"
```

## Task 3: The transport's relay mode

**Files:**
- Modify: `src/net/adapters/doSignal.ts` (`DoSignalTransport` :118-131, state :145-170, the signalling switch :379-432, `send` :444-453, `close` :467-478)
- Test: `src/net/adapters/doSignal.test.ts`

**Interfaces:**
- Consumes: `createRelayBatcher` and `decodeRelayBatch` (Task 2), and `SignallingClient.sendGame` with its `{ t: "game" }` event (Task 2).
- Produces:
  - `export type Route = "direct" | "relay"`.
  - `DoSignalTransport` gains `readonly route: Route` and `useRelay(): void`.
  - The transport tracks the room's seated peers itself: `welcome.peer`, `peer-joined` and `peer-left`.

**Relay mode, pinned:**
- **`useRelay()`** does nothing once closed or already relaying. Otherwise it:
  1. clears the deadline;
  2. tears down the peer connection, but keeps `announced` for the peer the direct channel had already announced, so no leave goes out for it;
  3. sets `route = "relay"`;
  4. announces (`joins.emit`) every seated peer not yet announced;
  5. sets the status to `"open"` with at least one seated peer, and `"waiting"` with none.
- **`send`** in relay mode pushes into the batcher, whose flush calls `signalling.sendGame`.
- **A `game` event** is decoded and emitted packet by packet with `from`, only in relay mode and only from a seated peer. Anything else is ignored.
- **`peer-joined`** in relay mode seats the peer, announces it and sets the status to `"open"`. No offer is made.
- **`peer-left`** in relay mode emits a leave for an announced peer even while `held`, then sets `"waiting"` when nobody is left.
- **A `closed` event** in relay mode emits a leave for every announced peer and sets the status to `"waiting"`.
- **Offers, answers and ICE** are ignored in relay mode, and `offerAgain` is a no-op.
- **`close()`** clears the batcher.
- **The direct path** is byte-for-byte today's while `route === "direct"`.

- [ ] **Step 1: Write the failing tests** (a new `describe("relay mode (Plan 7)")`).
  - `it("switches a negotiating host to the relay: the peer connection closes, the guest is announced, and the status is open")`.
  - `it("keeps a peer the direct channel had announced: no leave, no second join")`.
  - `it("sends packets as one game message per two input packets, through the room")`: `FakeSignalling.sentGame` holds 1 batch after 2 Input packets. Nothing goes on the (closed) channel.
  - `it("emits relayed packets with the room's sender, and ignores game data from anyone the room does not seat, or while direct")`.
  - `it("hears a seated peer leave, even while the match holds the channel")`: with `holdChannel()` then `peer-left`, `onPeerLeave` fires once.
  - `it("announces a newcomer on the relay without offering it a peer connection")`.
  - `it("answers no offer once relaying")`.
  - **Review Focus 2:** `it("Review Focus: a room socket that closes mid-relay, with any close code, is every relayed peer leaving")`:
    - loop the codes `[1006, 1011, 1000, 4008]`, each on a fresh transport with `holdChannel()` called;
    - the `closed` event makes `onPeerLeave` fire once for the peer, and the status becomes `"waiting"`.
- [ ] **Step 2: Run** `pnpm vitest run src/net/adapters/doSignal.test.ts`. Expected: FAIL, "transport.useRelay is not a function" (predicted).
- [ ] **Step 3: Implement** relay mode as pinned above. `route` is a getter. Keep a `seated: Set<string>`. Rewrite the header comments that relay mode makes untrue: game traffic "never touches" the room (:6-8), the room socket is never the link (:17-28), and the deadline's "no direct link" (:50-54).
- [ ] **Step 4: Run** the file, then gate 1. Expected: PASS, with the existing tests unchanged.
- [ ] **Step 5: Mutants.**
  - **Switch.** Skip the `teardown()` in `useRelay`: "switches a negotiating host…" fails on the peer's close count.
  - **Keep the announced peer.** Reset `announced` in `useRelay`: "keeps a peer…" fails with a second join.
  - **Batching.** Call `sendGame` per packet: "sends packets as one game message…" fails.
  - **Seated filter.** Drop the seated check on `game`: "emits relayed packets…" fails.
  - **Held leave.** Keep the `held` guard on `peer-left`: "hears a seated peer leave…" fails.
  - **Newcomer.** Call `offerTo` on `peer-joined` in relay mode: "announces a newcomer…" fails.
  - **Late offer.** Answer offers in relay mode: "answers no offer…" fails.
  - **Socket drop.** Ignore `closed` in relay mode: the Review Focus test fails (no leave).
- [ ] **Step 6: Commit**
```bash
git add super-smash/src/net/adapters/doSignal.ts super-smash/src/net/adapters/doSignal.test.ts
git commit -m "super-smash: the room transport can carry the match through the room when the direct channel cannot"
```

## Task 4: Both sides agree on the relay instead of failing

**Files:**
- Modify: `src/net/online/session.ts`:
  - `SessionError` :30
  - `NO_DIRECT_LINK` :58-65
  - `SessionEvent` :67-72
  - the `peer-joined` case :167-173
  - the `lobby` case :188-193
  - `linkChanged` :295-311
  - `reconnectAfter` :331-366
  - `noDirectLink` :395-404
- Modify: `src/lib/onlineStore.ts` (`playerSentence`: delete the `no-direct-link` case, :140-141)
- Modify: `src/net/online/testing.ts` (the fake session gains `route`, `"direct"` unless a test sets it)
- Modify: `SPEC.md` §5
- Test: `src/net/online/session.test.ts` (the block "a negotiation that never finishes", :581-771), `src/lib/onlineStore.test.ts` (:1060-1078)

**Interfaces:**
- Consumes: `Route`, `useRelay()` and `route` (Task 3).
- Produces:
  - `SessionEvent` gains `{ readonly type: "route"; readonly route: Route }`.
  - `SessionError` loses `"no-direct-link"`.
  - The lobby payload kind `"use-relay"` is intercepted by the session and never reaches the store.
  - `OnlineSessionLike` gains `readonly route: Route` (it reads `transport.route`).

**The agreement, pinned:**
- **`private goRelay(tell: boolean): void`.** It returns if the session is closed, the room is gone, or the route is already relay. Otherwise it:
  1. sends `{ t: "lobby", payload: { kind: "use-relay" } }` if `tell`;
  2. cancels the reconnect timer and ends the grace;
  3. emits `{ type: "route", route: "relay" }`;
  4. calls `transport.useRelay()`, whose `link: open` therefore comes after the route event. The store never sees a direct route on the way to the relay.
- **Who calls it:**
  - `linkChanged("failed")` with `!linked && !roomGone` calls `goRelay(true)` *instead of* emitting that `link: failed` event, so the store never shows `link-failed` for a first link.
  - `reconnectAfter`'s microtask (a first link that never opened) calls `goRelay(true)` where it called `noDirectLink()`.
  - A received `use-relay` calls `goRelay(false)` unless the match has `started`.
- **On `peer-joined`** while the route is relay, the session sends `use-relay` to the room (the newcomer).
- **`reconnectAfter`** returns at once in relay mode: no re-offer, no `renegotiate`.
- **In relay mode `roomDropped()`** is `loseRoom()` in the lobby. Mid-match the transport's leave has already reached the link monitor (Task 3).
- **Delete** `noDirectLink`, `NO_DIRECT_LINK` and the store's sentence.
- **`link-failed`'s sentence** (onlineStore.ts :139) loses its TURN advice, now untrue (D60). It becomes, verbatim: "The connection to the other player failed. Leave the room and try again."
- **Comments.** Rewrite the session.ts comments that describe no direct link (:24-28, :43-47, :321-329).

- [ ] **Step 1: Rewrite the 40b tests** as `describe("a direct link that cannot open falls back to the relay")`.
  - `it("moves the host's first connect, unopened after the deadline, to the relay: tells the guest, makes no re-offer, raises no error")`:
    - at `NEGOTIATION_TIMEOUT_MS` the sent lobby payloads include `{ kind: "use-relay" }`;
    - the events include `{ type: "route", route: "relay" }` and, after it, `{ type: "link", status: "open" }`;
    - `errors(events)` is empty, `offers()` stays 1, and `session.route === "relay"`.
  - `it("moves a guest's first answer, unopened after the deadline, to the relay without asking for another offer")`: no `renegotiate` is sent.
  - `it("moves a first connect whose link fails to the relay at once, and never reports the failed link")`: no `{ type: "link", status: "failed" }` event.
  - `it("follows the other side's use-relay, and does not say it back")`: no `use-relay` is sent.
  - `it("calls a player who leaves during the first negotiation gone, not the relay")`: adapted from :654.
  - `it("lets a use-relay that arrives after the start change nothing: the direct channel and the room stay")`: adapted from :669.
  - `it("tells a newcomer to a relayed seat to use the relay, and never offers it a direct connection")`.
  - `it("calls a room drop in the relayed lobby the room lost, with no re-offer and no renegotiate")`.
  - **Review Focus 1:** `it("Review Focus: a use-relay that lands while this side's direct channel is open moves it to the relay, and announces the peer once")`:
    - a guest whose channel opened (joins: 1);
    - then `use-relay` arrives from the host;
    - the transport's route is relay, joins stay 1 and leaves stay 0, no error event, and one `route` event.
  - `it("moves a newcomer's first link that fails to the relay too")`: adapted from :696.
  - The tests at :597, :610, :623 and :669 are replaced by the new ones above. :638 is deleted (the relay has no "says it first" sentence). Keep the rest.
- [ ] **Step 2: Update the store test.** In `src/lib/onlineStore.test.ts`, the `roomErrorMessage` table drops `no-direct-link` (:1064, :1076-1078), and `link-failed`'s row reads the new sentence.
- [ ] **Step 3: Run** `pnpm vitest run src/net/online/session.test.ts src/lib/onlineStore.test.ts`. Expected: FAIL, the new tests' relay assertions (predicted).
- [ ] **Step 4: Implement** the agreement as pinned.
- [ ] **Step 5: Amend `SPEC.md` §5.**
  - After the transport bullet, add:
    > **No direct link, then the room relays.** When a first direct channel cannot open (`NEGOTIATION_TIMEOUT_MS`, 15 s, or a failed connection), the side that finds out tells the other through the room (`use-relay`) and both carry the same packets over the room socket instead, two frames to a message; the room stamps the sender and reads nothing (D60). A room that has relayed keeps relaying. In relay mode the room socket is the link: losing it ends the match.
  - End the "LAN comes free" bullet with: "The relay is the fallback, never the first try."
- [ ] **Step 6: Run** both files, then gates 1 and 4 (online e2e). The 40b e2e (`online.spec.ts` :235) now fails on its sentence. That is expected and Task 7's, so note it and do not fix it here. Every other online e2e passes.
- [ ] **Step 7: Mutants.**
  - **Host tells.** Pass `tell = false` from the deadline path: "moves the host's first connect…" fails (no `use-relay` sent).
  - **Guest deadline.** Keep the guest's `renegotiate` on the first link: the guest test fails.
  - **Hidden failure.** Emit `link: failed` before `goRelay`: "…never reports the failed link" fails.
  - **No echo.** `goRelay(true)` on a received `use-relay`: "follows… does not say it back" fails.
  - **Leaver first.** Drop the microtask's `seatedPeer === peer` check: "calls a player who leaves… gone" fails.
  - **After the start.** Remove the `started` guard: "lets a use-relay that arrives after the start…" fails.
  - **Newcomer.** Skip the newcomer's `use-relay`: "tells a newcomer…" fails.
  - **Relay room drop.** Remove `reconnectAfter`'s relay early return: "calls a room drop in the relayed lobby…" fails (a `renegotiate` is sent).
  - **Review Focus 1.** In `useRelay`, reset `announced` (Task 3's keep-the-announced-peer mutant): the Review Focus test fails with joins 2.
  - **Route order.** Emit the `route` event after `useRelay()`: the first test fails on the event order.
  - **Newcomer's link.** Keep the newcomer's failed first link as `link: failed`: "moves a newcomer's first link…" fails.
- [ ] **Step 8: Commit**
```bash
git add super-smash/src/net/online/session.ts super-smash/src/net/online/session.test.ts super-smash/src/net/online/testing.ts super-smash/src/lib/onlineStore.ts super-smash/src/lib/onlineStore.test.ts super-smash/SPEC.md
git commit -m "super-smash: a direct link that cannot open moves both players to the room relay instead of ending the room"
```

## Task 5: The lobby says it is connecting through the relay

**Files:**
- Modify: `src/lib/onlineStore.ts` (`OnlineFields` :63-85, `INITIAL` :92-102, `LINKING_STATUS` :41, `bindSession`'s switch :357-407)
- Modify: `src/components/online/OnlineLobby.tsx` (`statusText` :307-322)
- Modify: `SPEC.md` §9 (the table, after `/fighters`)
- Test: `src/lib/onlineStore.test.ts`, `src/components/online/OnlineLobby.test.tsx`

**Interfaces:**
- Consumes: the session's `route` event (Task 4).
- Produces:
  - `OnlineFields.route: Route | null`: null until a link opens; `"direct"` on the first `link: open` while no `route` event has come; `"relay"` from the `route` event.
  - `export const RELAY_LINKING_STATUS = "Connecting through the relay…"`.

- [ ] **Step 1: Write the failing tests.**
  - In `src/lib/onlineStore.test.ts`, `it("mirrors the route: null before a link, direct on a direct open, relay once the session moves")`. `reset()` sets it back to null.
  - In `src/components/online/OnlineLobby.test.tsx`, `it("says it is connecting through the relay while a relayed link waits for the hello, on either side")`:
    - with status `linking` and route `relay`, the status region reads exactly `RELAY_LINKING_STATUS` for the host and for the guest;
    - with route `direct` it still reads "They are in. Opening a direct connection…" (host).
- [ ] **Step 2: Run** both files. Expected: FAIL, `route` undefined (predicted).
- [ ] **Step 3: Implement** the field and its handling in `bindSession`. In `statusText(status, role, roomCode, route)`, `linking` with route `relay` returns `RELAY_LINKING_STATUS`.
- [ ] **Step 4: Amend `SPEC.md` §9.** Add a row after `/fighters`:
  > | `/online` | Create a room (a four-letter code to read out) or join one by its code. The status line says each step: loading the game data, the room, the direct connection, or "Connecting through the relay…" when no direct one could open (D60) |
- [ ] **Step 5: Run** both files, then gates 1 and 4 (`test:e2e`, and `test:e2e:online` with only the 40b test red, as in Task 4).
- [ ] **Step 6: Mutants.**
  - **Route.** Set `route: "direct"` on the `route` event: "mirrors the route…" fails.
  - **Copy.** In `statusText`, test `role === "host"` before the route: "says it is connecting through the relay…" fails for the host.
- [ ] **Step 7: Commit**
```bash
git add super-smash/src/lib/onlineStore.ts super-smash/src/lib/onlineStore.test.ts super-smash/src/components/online/OnlineLobby.tsx super-smash/src/components/online/OnlineLobby.test.tsx super-smash/SPEC.md
git commit -m "super-smash: the online lobby says when it is connecting through the relay"
```

## Task 6: The match HUD shows the route

**Files:**
- Modify: `src/components/match/NetHud.tsx` (`NetHudProps` :14-20, the numbers line :56-60)
- Modify: `src/app/play/page.tsx` (`<NetHud` :816, `__smashNet` :753-757)
- Test: `src/components/match/NetHud.test.tsx`, `src/app/play/page.test.tsx`

**Interfaces:**
- Consumes: `OnlineFields.route` (Task 5) and `OnlineSessionLike.route` (Task 4).
- Produces:
  - `NetHudProps.route: Route`.
  - The numbers line reads exactly `` `PING ${ms} ms · DELAY ${d}f · ROLLBACKS ${r} · ${route === "relay" ? "RELAY" : "DIRECT"}` ``.
  - `window.__smashNet.route` is a getter returning `session.route` (Task 4; the fake session has it).

- [ ] **Step 1: Write the failing tests.**
  - In `NetHud.test.tsx`, `it("names the route after the numbers")`: rtt 41.6, delay 3 and rollbacks 2 give `"PING 42 ms · DELAY 3f · ROLLBACKS 2 · RELAY"` with `route="relay"`, and the same line ending `· DIRECT` with `route="direct"`. Existing tests pass `route="direct"`.
  - In `page.test.tsx`, beside :631, `it("publishes the session's route on __smashNet")`, with the fake session's `route` set to `"relay"`.
- [ ] **Step 2: Run** both files. Expected: FAIL (predicted).
- [ ] **Step 3: Implement.** The page reads `useOnlineStore((s) => s.route) ?? "direct"` for the prop.
- [ ] **Step 4: Update the online e2e's HUD assertion** (`e2e-online/online.spec.ts` :119) to `/^PING \d+ ms · DELAY \d+f · ROLLBACKS \d+ · (DIRECT|RELAY)$/`.
- [ ] **Step 5: Run** gates 1 and 4 (only the 40b test red).
- [ ] **Step 6: Mutants.**
  - **Route tag.** Hard-code `DIRECT`: "names the route…" fails.
  - **Published route.** Publish `route: "direct"`: the page test fails.
- [ ] **Step 7: Commit**
```bash
git add super-smash/src/components/match/NetHud.tsx super-smash/src/components/match/NetHud.test.tsx super-smash/src/app/play/page.tsx super-smash/src/app/play/page.test.tsx super-smash/e2e-online/online.spec.ts
git commit -m "super-smash: the match HUD says whether the match runs direct or through the relay"
```

## Task 7: The online e2e falls back to the relay and plays to a result; D60

**Files:**
- Modify: `e2e-online/online.spec.ts` (the header :6-13, the first test :106-138, the 40b block :223-267)
- Modify: `DECISIONS.md` (append D60 after D59's end)
- Modify: `SPEC.md` §12
- Modify: `README.md` (the `e2e-online` row :51, the online paragraph :76-77)
- Modify: `docs/superpowers/plans/README.md` (the status line, a Plan 7 row, the "Steps that stop for David" table)

**Interfaces:**
- Consumes: `__smashNet.route` (Task 6), the relay fallback (Tasks 1-4) and `RELAY_LINKING_STATUS` (Task 5).

- [ ] **Step 1: Replace the 40b e2e.**
  - Rename it `test("a direct connection that cannot open falls back to the relay, and the match plays to a result on both screens", …)`.
  - Keep its `test.skip` when `/api/ice` says `turn: true`, and keep `?ice=relay` with the host's offer held 3 s.
  - Then:
    - drive the host and guest through the stage and fighters as `startOnlineMatch` does, from that lobby;
    - assert `__smashNet.route === "relay"` on both pages, and the HUD line ending `· RELAY`;
    - play to a result as the "play a match to its result" test does (:159-179): both see "Game Set" and the same winner;
    - assert "Lost the room" has count 0 on both.
  - Delete the `NO_DIRECT_LINK` constant.
- [ ] **Step 2: Make the forced-TURN run prove TURN.** In the first test, when `FORCE_RELAY`, assert `__smashNet.route === "direct"`: a TURN path is the direct route, so a pass through the room relay does not count. Say so in the header comment.
- [ ] **Step 3: Run** gate 4: `pnpm test:e2e:online --trace off`. Expected: every test passes, the relay one included (the fallback takes up to 15 s plus the match).
- [ ] **Step 4: Write D60** ("D60 — No TURN: the room relays the match, and rooms hold four"). Its Phase A part says, in prose, with these facts and numbers:
  - **Decision.** The room Durable Object relays game data when no direct link opens, payload-blind, over the room socket. The relay is a fallback, never the first try.
  - **Why.** David has no payment card, so Cloudflare TURN, Metered and similar are out. D54's "STUN only without a key" interim is now permanent. D9's rejection of a relayed WebSocket (TCP head-of-line blocking) stands for the primary path.
  - **Budget.** Quote the Spec's budget facts verbatim: 100,000 Durable Object requests a day; incoming WebSocket messages billed 20:1, outgoing free; reset at 00:00 UTC; exceeding it fails every room until the reset; ≈1,442 requests for a relayed 8-minute 2-player match at 30 messages/s, and ≈2,884 for 4 players.
  - **Limits and framing.**
    - The limits: `RELAY_MAX_FRAME_BYTES` 2048, kicked with `bad-message`; `RELAY_RATE_PER_SECOND` 40 with `RELAY_BURST` 80, over-rate dropped; outside `MAX_MESSAGES_PER_PEER`.
    - The two-input batching (one extra frame of delay), and the wire framing.
  - **Settled while building it.**
    - The agreement (`use-relay`), and that the relay is sticky for the room.
    - The newcomer is told.
    - In relay mode a room-socket drop, and so every Worker deploy, ends a relayed match: D54's "a deploy never ends a match" holds only for direct matches.
  - **Behaviour worth knowing.**
    - A hidden tab ticks nothing, so it sends no Input, and its Pongs and Hashes wait in the batch until it returns. The size flush bounds the wait, and this matches the `away` rules.
    - After a match, the linger re-sends every 50 ms, which flushes on every second call: about 20 messages a second, under the 40 cap. Steady play is 30 a second. Catch-up after a stall is clamped by the runner's accumulator, so there is no overrun.
  - **Residual risks.**
    - A hostile client can spend the daily budget (as D54 says for signalling).
    - Whether Free-plan enforcement applies the 20:1 ratio is unverified. The Deploy checkpoint measures it.
    - The exact failure when the budget runs out is undocumented: the client sees a closed socket, which reads as Connection Lost mid-match and "Could not reach the online service" in the lobby.
  - **Rejected.**
    - Opening the relay alongside the direct attempt from the start, which costs budget on the 90% that connect.
    - Paid TURN.
- [ ] **Step 5: Amend `SPEC.md` §12.** Add "a TURN server of our own (D60: the room relays instead)" to the list.
- [ ] **Step 6: Update `README.md` and `docs/superpowers/plans/README.md`.**
  - In `README.md`, the `e2e-online` row and the online paragraph mention the relay fallback.
  - In the plans README, add a Plan 7 row (decision D60), set the status line to "Plan 7 Phase A executed", and add "7 / Deploy checkpoint: deploy the relay fallback" under "Steps that stop for David".
  - Remove "Set the TURN secrets" from Plan 6's open items: TURN is out (D60).
- [ ] **Step 7: Run** gate 1. Documents only, so no mutant.
- [ ] **Step 8: Commit**
```bash
git add super-smash/e2e-online/online.spec.ts super-smash/DECISIONS.md super-smash/SPEC.md super-smash/README.md super-smash/docs/superpowers/plans/README.md
git commit -m "super-smash: D60 records the room relay; the online e2e falls back to it and plays to a result"
```

---

## Deploy checkpoint (the controller's, after Task 7; not an implementer task)

1. **Review and push.** Review Phase A as a whole, run the full gate, and push `main`.
2. **Deploy.** On David's go: `pnpm deploy`.
3. **Live fallback.** Run `SMASH_URL=https://david-smash.leaders-game.workers.dev pnpm test:e2e:online --trace off`. The relay test must pass against the live Worker. The others must pass too.
4. **Measure the added delay.** Open two Playwright contexts on the live site in one room twice: once direct, and once relayed (`?ice=relay`, offer held as in the e2e). After 20 s of play, record `__smashNet.stats().rttMs` and `inputDelay` on both, for each route.
5. **Measure the bill.** Read the Durable Objects request count in the Cloudflare dashboard before and after one relayed match of known length. Compare it with 30 messages/s × 2 ÷ 20, which tests whether the 20:1 ratio applies on Free.
6. **Record.** Add both measurements to D60 in a documents-only commit: `super-smash: D60 has the relay's measured delay and cost`.

Phase B starts only after this checkpoint. A relay that fails live stops the plan for David.

---

# Phase B: three and four players online

## Task 8: Spike: four pages run matches at once on one machine

**Files:**
- Create: `e2e-online/fourPages.spec.ts`
- Possibly modify: `playwright.online.config.ts` (`launchOptions.args` :36), only under the rule below

**Interfaces:**
- Consumes: `startMatch` and `ROUTES` (`e2e/helpers.ts` :197).
- Produces: a standing check that this machine can carry four match pages. It is the precondition for Task 17.

- [ ] **Step 1: Write the spike test.**
  - `test("four pages each run a local match at 30 frames a second or better, all at once")`:
    - open 4 contexts with `browser.newContext()`;
    - on each, route `**/models/**` to a 404 (stand-ins), then `startMatch(page)` one after another;
    - then, with all four running, read `__smashDebug.frame` on each, wait 20 s (`expect.poll` against a deadline, not a sleep), and read again;
    - each page must have advanced at least 600 frames;
    - log the four deltas with `console.log`, so the run records them.
  - Close every context after the test, as `online.spec.ts` does (:102-104).
- [ ] **Step 2: Run** `pnpm test:e2e:online --trace off -g "four pages"`. Record the four deltas and the machine load.
- [ ] **Step 3: The decision rule.**
  - A run counts only at a machine load of 6 or under. Otherwise re-run it before applying the rule.
  - If every delta is at least 600, keep the config as it is.
  - If not, add `"--disable-renderer-backgrounding"`, `"--disable-background-timer-throttling"` and `"--disable-backgrounding-occluded-windows"` to `launchOptions.args` in `playwright.online.config.ts`, then re-run.
  - If any delta is still under 600, **stop and report** the numbers to the controller. Task 17's four-browser e2e is then the controller's ruling (fewer pages, or a lower bar), and Tasks 9-16 may go on.
- [ ] **Step 4: Run** gate 4, the online suite in full, which must stay green with the flags if they were added.
- [ ] **Step 5: Mutant.** Raise the bar to 6000 frames: the test fails and prints the deltas. This proves the assertion reads real numbers.
- [ ] **Step 6: Commit**
```bash
git add super-smash/e2e-online/fourPages.spec.ts super-smash/playwright.online.config.ts
git commit -m "super-smash: the online suite checks that four match pages run at once before any four-player test relies on it"
```
Stage `playwright.online.config.ts` only if Step 3 changed it.

## Task 9: The room seats players by port and can address a message

**Files:**
- Modify: `src/net/signalProtocol.ts`:
  - `ROLE_PORT` :17 (kept until Task 15)
  - `PeerInfo` :47-50
  - `ClientMessage` :72-74
  - `ServerMessage.welcome` :77
  - `parseClientMessage` :98-117
  - `parsePeer` :197-203
- Modify: `worker/src/room.ts` (`JoinDecision` :33-35, `RelayOutcome` :37-41, `decideJoin` :46-65, `relay` :67-79)
- Modify: `worker/src/roomDO.ts` (`fetch` :58, `webSocketMessage` :71-73)
- Modify, mechanically: `src/net/adapters/doSignal.ts` (welcome :382-388), `src/net/online/session.ts` (welcome :161-166)
- Test: `worker/src/room.test.ts`, `src/net/signalProtocol.test.ts`, `src/net/roomWorker.integration.test.ts`, and every `welcome` fixture and `PeerInfo` in `doSignal.test.ts`, `session.test.ts`, `signalling.test.ts`, `src/lib/onlineStore.test.ts` (:473, :475, :533, :883) and `src/components/menu/CharacterSelect.online.test.tsx` (:311, :430, :467). The last two are mechanical edits.

**Interfaces:**
- Produces:
  - `PeerInfo { id: string; role: Role; port: number }`, where `port` is an integer 0-3, and `role === "host"` exactly when `port === 0`.
  - `welcome: { t: "welcome"; self: PeerInfo; peers: readonly PeerInfo[] }`: the others, sorted by port.
  - `ClientMessage` signal and lobby take an optional `to?: string` of 1-16 characters. Any other `to` is `bad-message`.
  - `JoinDecision.admit.notify: readonly Delivery[]`: one `peer-joined` per existing peer.
  - `RelayOutcome.forward: { type: "forward"; deliveries: readonly Delivery[] }`: to `to` alone when that peer is seated and is not the sender (otherwise `drop`), else to every other peer.
- `ROOM_CAPACITY` stays 2 in this task (Task 14 raises it), so nothing a player sees changes yet.

**Port rule:** a newcomer takes the lowest port in `0..ROOM_CAPACITY-1` no seated peer holds. Its role is `port === 0 ? "host" : "guest"`.

- [ ] **Step 1: Write the failing tests** in `worker/src/room.test.ts`.
  - Fixtures gain ports: host 0, guest 1.
  - `it("gives each newcomer the lowest free port, and the host seat to whoever takes port 0")`: with `ROOM_CAPACITY` forced to 4 through a parameter `decideJoin(existing, intent, newId, capacity = ROOM_CAPACITY)`, the arrivals take 0, 1, 2, 3. With port 1 freed, the next takes 1. With port 0 freed, the next is the host.
  - `it("tells every peer already seated that somebody joined")`: with capacity 4 and 3 seated, `notify` has 3 deliveries.
  - `it("delivers an addressed message to that peer alone, and drops one addressed to nobody seated or to the sender itself")`.
  - `it("delivers an unaddressed message to every other peer")`.
  - The existing tests keep their meaning with the new shapes. "hands the host seat to a newcomer if the host left first" now also asserts port 0.
- [ ] **Step 2: Write the failing test** in `signalProtocol.test.ts`: `it("reads a welcome's seated peers with their ports, and refuses a port outside 0-3 or a non-string to")`.
- [ ] **Step 3: Update the live-room test.** In `roomWorker.integration.test.ts`, the welcome assertions read `peers` and ports (`self.port` 0 for the host, 1 for the guest).
- [ ] **Step 4: Run** `pnpm vitest run worker/src/room.test.ts src/net/signalProtocol.test.ts`. Expected: FAIL (predicted).
- [ ] **Step 5: Implement.**
  - The Durable Object delivers each `Delivery` in `notify` and `deliveries`.
  - Mechanically, in the clients:
    - `doSignal`'s `hostId = role === "guest" ? (event.peers.find((p) => p.role === "host")?.id ?? null) : null`;
    - the host offers when `event.peers.length === 1`;
    - every signal it sends carries `to: remoteId`;
    - `session`'s `seatedPeer = event.peers[0]?.id ?? null`;
    - fixtures `peer: X` become `peers: X ? [X] : []` with ports.
- [ ] **Step 6: Run** gates 1, 3 and 4. There is no behaviour change at capacity 2, so the whole online suite passes.
- [ ] **Step 7: Mutants.**
  - **Port.** Take `existing.length` as the port: "gives each newcomer the lowest free port…" fails at the freed port 1.
  - **Notify.** Notify `existing[0]` only: "tells every peer…" fails.
  - **Addressed.** Ignore `to`: "delivers an addressed message…" fails.
  - **To the sender.** Deliver a message addressed to its own sender: the same test fails on its last case.
  - **Unaddressed.** Deliver to the first other peer only: "delivers an unaddressed message…" fails.
  - **Port range.** Accept port 4 in `parsePeer`: the `signalProtocol` test fails.
- [ ] **Step 8: Commit**
```bash
git add super-smash/src/net/signalProtocol.ts super-smash/src/net/signalProtocol.test.ts super-smash/worker/src/room.ts super-smash/worker/src/room.test.ts super-smash/worker/src/roomDO.ts super-smash/src/net/roomWorker.integration.test.ts super-smash/src/net/adapters/doSignal.ts super-smash/src/net/adapters/doSignal.test.ts super-smash/src/net/online/session.ts super-smash/src/net/online/session.test.ts super-smash/src/net/signalling.test.ts super-smash/src/lib/onlineStore.test.ts super-smash/src/components/menu/CharacterSelect.online.test.tsx
git commit -m "super-smash: the room gives each player a port and can address a message to one of them"
```

## Task 10: Rollback for three and four peers

**Files:**
- Modify: `src/net/rollback.ts`:
  - fields :385-413
  - `onMessage`'s `Ping`, `Pong` and `Hash` cases :986-1010
  - the time-sync read :820-824
  - `applyInputPacket`'s advantage :1058-1062
  - `compareHashes` :1116-1132
  - `pruneHashes` :1134-1140
  - `maybeRetuneDelay` :1157-1166
  - `NetStats.rttMs`'s doc :210
- Modify: `SPEC.md` §5 (the "Input delay" and "Desync detection" bullets)
- Test: `src/net/rollback.test.ts`

**Interfaces:**
- Produces:
  - `NetStats.rttMs` is the **highest** of the peers' round trips (the worst ping, which the HUD shows unchanged).
  - `DesyncReport.peerId` and `.port` name the peer whose hash differs.
  - No new public method.

**Pinned:**
- **Ping tokens carry the pinger's port.** `token = (((this.localPorts[0] ?? 0) << 24) | (counter & 0xffffff)) >>> 0`. A Pong whose `token >>> 24` is not this machine's port is dropped before it is looked up. In a star every Pong reaches every machine, and every session counts tokens from 1, so without the port a Pong answering A's token k would count as B's own token k. Port 0's tokens are today's numbers, so a two-player match behaves as it does now. The wire is unchanged (`token` is a u32).
- **Round trip.** `pings: Map<token, { sentAt: number; frame: number; answered: Set<string> }>`. A Pong counts once per peer per token, and the first Pong no longer deletes the token. A token is pruned once `currentFrame - frame > 4 * PING_INTERVAL_FRAMES`. Each peer keeps its own EMA, with today's formula: first sample as is, then 0.8/0.2. The delay is retuned from the peer with the highest EMA, once that peer has 2 samples.
- **Frame advantage.** `Map<peerId, number>`, with the 0.7/0.3 EMA per peer. Each peer's advantage adds back half of **that peer's own** RTT EMA (0 before its first sample), not the worst. Time sync stalls on the **highest** peer's advantage.
- **Hashes.** `remoteHashes: Map<frame, Map<peerId, { hash; port }>>` and `comparedHashes: Set<string>` keyed `` `${frame}:${peerId}` ``. `compareHashes(frame)` compares the local hash with every pending peer's, and reports each mismatch once.
- **Ruled out, kept as they are:**
  - `ack` stays the minimum over all remote ports (:921): safe, and the relay's TCP makes the window short.
  - Pongs stay broadcast: in a star every peer gets every Pong. The receiver keys each sample by `peerId`, which the room stamps, and the port in the token (above) keeps other machines' Pongs out.

- [ ] **Step 1: Write the failing tests** in a new `describe("three and four machines (Plan 7)")`.
  - Add a `ring(n, options)` helper beside the two-machine harness (:200-275). It builds n sessions on one `LoopbackNetwork`, with ports `0..n-1` and `autoInputDelay: false`. Each iteration advances the sessions in port order, A, B, C….
  - Generalize `referenceState` (:135-150) to `referenceState(…, playerCount = 2)`. It maps ports `0..playerCount-1`, and frame 0's previous inputs are `playerCount` zeros, where today it hard-codes `[0, 1]` and `[0, 0]`. Two-player callers are unchanged.
  - `it("plays a four-machine match to the state a lone machine reaches, on every machine, through 50 ms and 10% loss")`: every session `matchesReference`, with `desyncs` 0, `lateInputs` 0 and `inputConflicts` 0.
  - `it("catches a third machine's desync after the second agreed on the same frame")`:
    - three machines with `latencyMs: 0`, where C's deps diverge as in :740;
    - B advances before C each iteration, so B's hash for each frame reaches A first (that order is what makes the old code compare B's alone and fail);
    - A's `onDesync` fires with `peerId` C's, and never B's.
  - `it("takes the slowest peer's round trip for the delay and the HUD")`:
    - one session on a hand-driven transport (an emitter-backed fake);
    - after its first Ping (decode what it sent), inject a Pong from "B" at now = 20 ms and one from "C" at now = 120 ms;
    - `netStats.rttMs` is 120.
  - `it("ignores a Pong to another machine's ping, so each peer's round trip is its own")`:
    - one session with local port 1 on the hand-driven transport;
    - after its first Ping (token `(1 << 24) | 1`), inject from "C" a Pong with token `(0 << 24) | 1` (A's token) at now = 5 ms: `rttMs` stays 0;
    - then a Pong from "C" with its own token at now = 80 ms gives `rttMs` 80.
  - `it("holds a machine back for the peer it is furthest ahead of, not the average")`:
    - one session of three ports (local port 0), advancing one frame per round;
    - each round, inject five Input packets from "B" (port 1) with `senderFrame` equal to the session's frame, and one from "C" (port 2) with `senderFrame` 4 behind it (past `TIME_SYNC_THRESHOLD_FRAMES`, inside the prediction cap);
    - over 30 rounds, `netStats.stalls.timesync` is above 0. The old shared average sits near 0.2 frames and never stalls.
- [ ] **Step 2: Run** `pnpm vitest run src/net/rollback.test.ts`. Expected: the desync, the two round-trip and the time-sync tests fail (predicted: no desync reported; rttMs 20; rttMs 5 from A's token; no timesync stall). The four-machine convergence may already pass; that is fine.
- [ ] **Step 3: Implement** as pinned.
- [ ] **Step 4: Amend `SPEC.md` §5.**
  - The input-delay bullet ends: "With more than one remote peer, the slowest one's round trip sets the delay, and the HUD shows that ping."
  - The desync bullet ends: "With more than two machines each peer's hash is compared, and one that differs is reported by peer."
- [ ] **Step 5: Run** gate 1 (the existing rollback tests unchanged).
- [ ] **Step 6: Mutants.**
  - **Four-machine.** In `ring`, give two sessions the same local port: "plays a four-machine match…" fails with `inputConflicts`.
  - **Per-peer compare.** Key `comparedHashes` by frame alone: "catches a third machine's desync…" fails.
  - **Slowest RTT.** Take the minimum: "takes the slowest peer's…" fails with 20.
  - **Token port.** Skip the token's port check: "ignores a Pong to another machine's ping…" fails with 5.
  - **Advantage.** Use one shared EMA: "holds a machine back…" fails.
- [ ] **Step 7: Commit**
```bash
git add super-smash/src/net/rollback.ts super-smash/src/net/rollback.test.ts super-smash/SPEC.md
git commit -m "super-smash: rollback compares every peer's hash, holds back for the furthest peer, and sets its delay from the slowest"
```

## Task 11: Match settings for two to four players

**Files:**
- Modify: `src/net/online/lobby.ts` (`OnlineMatchConfig` :76-85, `parseConfig` :191-219)
- Modify: `src/game/onlineConfig.ts` (`buildStartConfig` :26-42)
- Modify: `src/lib/matchConfig.ts` (`configureOnline` :1097-1102 and its type :843)
- Test: `src/net/online/lobby.test.ts` (:343), `src/game/onlineConfig.test.ts` (:51-60), `src/lib/matchConfig.test.ts`

**Interfaces:**
- Produces:
  - `export const ONLINE_MIN_PLAYERS = 2` and `export const ONLINE_MAX_PLAYERS = 4`, in `src/net/online/lobby.ts`. They are local, so the parser takes no new import from the `matchConfig` store.
  - `OnlineMatchConfig.fighters`, `.costumes` and `.controls` are `readonly string[]`, `readonly number[]` and `readonly number[]`, each of length `ONLINE_MIN_PLAYERS..ONLINE_MAX_PLAYERS` (2-4) and all three the same length.
  - `buildStartConfig` accepts 2-4 players and sets `rules.oneOnOne = players.length === 2`.
  - `configureOnline(playerCount?: number): void` seats `onlinePlayer(0..playerCount-1)`. The default is 2, and the count is clamped to `MIN_PLAYERS..MAX_PLAYERS`.
  - `runnerSlotsFor` is unchanged: it already maps any length.

- [ ] **Step 1: Write the failing tests.**
  - `lobby.test.ts` :343 is renamed `it("reads the config's arrays as two to four entries of one length, not by prototype or length tricks")`. A sparse array, 5 entries, 1 entry, or mismatched lengths are unplayable. 3 and 4 entries parse.
  - `onlineConfig.test.ts` :51-60:
    - `it("plays the 1v1 rules online only with two players")`: 2 gives true, and 3 and 4 give false;
    - `it("refuses fewer than two players or more than four")` throws `/two to four players/`.
  - `matchConfig.test.ts`: `it("seats as many online players as the room begins with, 1v1 rules only for two")`, for `configureOnline(4)` and `configureOnline()`.
  - `onlineConfig.test.ts`: `it("keeps the online player bounds equal to the local ones")`: `ONLINE_MIN_PLAYERS === MIN_PLAYERS` and `ONLINE_MAX_PLAYERS === MAX_PLAYERS`.
- [ ] **Step 2: Run** the three files. Expected: FAIL (predicted).
- [ ] **Step 3: Implement.** Test fixtures typed `[string, string]` widen as the compiler asks.
- [ ] **Step 4: Run** gate 1.
- [ ] **Step 5: Mutants.**
  - **Lengths.** Drop the equal-lengths check: the lobby test fails.
  - **1v1 rules.** Keep `oneOnOne: true`: the onlineConfig test fails.
  - **Seating.** Ignore `playerCount`: the matchConfig test fails.
  - **Bounds.** Set `ONLINE_MAX_PLAYERS = 3`: "keeps the online player bounds…" fails.
- [ ] **Step 6: Commit**
```bash
git add super-smash/src/net/online/lobby.ts super-smash/src/net/online/lobby.test.ts super-smash/src/game/onlineConfig.ts super-smash/src/game/onlineConfig.test.ts super-smash/src/lib/matchConfig.ts super-smash/src/lib/matchConfig.test.ts
git commit -m "super-smash: an online match can be two to four players, with the 1v1 rules only for two"
```

## Task 12: Sessions with up to three others; a room of three goes to the relay

**Files:**
- Modify: `src/net/adapters/doSignal.ts` (seated set, `peer-joined` :389-395, `game` handling, new `lockRoster`)
- Modify: `src/net/online/session.ts`:
  - `OnlineSessionLike` :74-89
  - `seatedPeer` :128
  - the switch :159-217
  - `localPort` :224-227
  - `sendLobby` :233-264
- Modify: `src/net/online/testing.ts` (`localPort` :54-56)
- Modify, mechanically: `src/lib/onlineStore.ts` (`remotePort` :420-423, :482, :498), `src/app/play/page.tsx` (:111), which read `seatPort`
- Modify: `SPEC.md` §5
- Test: `src/net/adapters/doSignal.test.ts`, `src/net/online/session.test.ts`
- Modify, mechanically (the `peer` event gains `peer`, the `lobby` event gains `from`): `src/lib/onlineStore.test.ts`, `src/components/menu/CharacterSelect.online.test.tsx`, `src/components/online/OnlineLobby.test.tsx`, `src/game/linkMonitor.test.ts`, `src/app/play/page.test.tsx`, `src/components/menu/StageSelect.test.tsx`, `src/components/ControlPrefsSync.test.tsx`

**Interfaces:**
- Consumes: `PeerInfo.port`, `welcome.peers` and `to` (Task 9), and `goRelay` (Task 4).
- Produces, on `OnlineSessionLike`:
  - `readonly seatPort: number | null` replaces `localPort`. It is the room's port for this machine (`welcome.self.port`).
  - `readonly peers: ReadonlyMap<string, PeerInfo>` is the others the room seats.
  - `sendLobby(message: LobbyMessage, to?: string): boolean`.
  - `lockRoster(ids: readonly string[]): void`: the other players of a begun room (Task 14 calls it, again on every re-sent begin). It forwards to the transport.
- Produces, on `DoSignalTransport`: `lockRoster(ids: readonly string[]): void`.
- Produces, on `SessionEvent`:
  - `{ type: "peer"; present: boolean; peer: PeerInfo }`
  - `{ type: "lobby"; message: ReceivedLobbyMessage; from: string }`
- Produces: `export const RELAY_FROM_PLAYERS = 3`.

**Pinned:**
- **Going to the relay.** When the room seats `RELAY_FROM_PLAYERS` or more (this machine plus `peers.size`), on a welcome or a `peer-joined`, the session calls `goRelay(false)`. Every member sees the same joins, so no message is needed.
  - The count is taken only before the start (`!started`).
  - Once a roster is locked, it counts only seated roster members, so a stranger typing the code into a begun two-player room moves nobody.
  - Only the host (seat port 0) tells a newcomer to a relayed room (`use-relay`, `to` the newcomer); the other members stay quiet.
- **The roster lock, in the relay transport.** After `lockRoster(ids)`, and also while `held` if no roster is locked yet, the transport neither announces a peer outside the roster (or outside those already announced) nor emits its game data. So their `peer-left` emits no leave either.
  - `lockRoster` announces any seated, unannounced peer now on the roster: the newcomer a re-sent begin puts on a vacated port.
  - In direct mode `lockRoster` only records the roster.
- **The transport offers only when exactly one other peer is seated.** On a `peer-joined` that makes two others it offers nobody. It keeps its single direct peer connection only while the room seats two.
- **Ids.** The 2-player re-offer and grace logic keeps working on the single other peer, as today: `seatedPeer` becomes the other peer's id when `peers.size === 1`, else null.
- **The start guard replaces :257-260.** `sendLobby` refuses a `start`, calling `loseRoom()` and returning false, when `peers.size + 1 < message.config.fighters.length`: a player the start names is no longer in the room. `seatedPeer` no longer decides it.
- **The fake session** (`testing.ts`) exposes `seatPort`, `peers`, `lockRoster: vi.fn()`, and the `to` argument (readable from `sendLobby.mock.calls`; `sent` stays a `LobbyMessage[]`). Its `emit` keeps setting the role on `joined`.

- [ ] **Step 1: Write the failing tests** in `session.test.ts`, as `describe("rooms of three and four (Plan 7)")`.
  - `it("puts a room that seats three on the relay at once, without a message")`: a welcome with 2 peers gives route relay, and no `use-relay` is sent.
  - `it("moves a two-player room to the relay when a third joins, and keeps it there when the third leaves")`.
  - `it("reports each lobby message with its sender, and each arrival or departure with its seat")`.
  - `it("addresses a lobby message to one peer when asked")`: `signalling.sent` holds `{ t: "lobby", to: "g2", payload }`.
  - `it("knows its own seat port from the welcome")`: `seatPort` 2 for `self.port` 2.
  - `it("sends a four-player start with three others seated, and calls the room lost when one of them is missing")`: with 3 peers seated the start is sent and returns true. On a fresh session with 2 seated, the same start returns false with a `room-lost` error.
  - `it("lets only the host tell a newcomer to a relayed room to use the relay")`: on a guest's session no `use-relay` is sent.
  - `it("keeps a begun room's route and players when a stranger joins and leaves")`:
    - a direct two-player room, `lockRoster(["g1"])`, then `holdChannel` through a start;
    - a stranger's `peer-joined` and `peer-left` give no route change, no join and no leave on the transport;
    - in a relayed begun room, the stranger's game data emits no message.
  - **Review Focus 5:** `it("Review Focus: a third player joining mid-negotiation moves all three to the relay and leaves the old negotiation unanswered")`:
    - a host negotiating with g1 (offer sent, channel not open);
    - `peer-joined` for g2 gives route relay;
    - the old peer connection is closed, `offers()` stays 1 (none to g2), and a late `answer` and `ice` from g1 cause no error and no new peer connection;
    - g1 and g2 are both announced as joins on the transport.
- [ ] **Step 2: Write the failing tests** in `doSignal.test.ts`:
  - `it("offers nobody when a peer joins a room that already seats two others")`;
  - `it("announces a roster peer on lockRoster, and never one outside it")`.
- [ ] **Step 3: Run** both files. Expected: FAIL (predicted).
- [ ] **Step 4: Implement** as pinned. Rename `localPort` to `seatPort` at its readers (`onlineStore.ts` `remotePort`, `setOwnStickJump`, `setOwnPad`; `play/page.tsx` :111). Give every `peer` and `lobby` event in the seven mechanically edited test files its `peer` (with a port) or `from`.
- [ ] **Step 5: Amend `SPEC.md` §5.** After Task 4's bullet, add:
  > **Rooms of three or four always relay.** A room that seats a third player moves everyone to the room relay, a star through the Durable Object, and stays there; only a two-player room tries a direct channel first. There is no WebRTC mesh.
- [ ] **Step 6: Run** gates 1 and 4. ROOM_CAPACITY is still 2, so the online suite is unchanged.
- [ ] **Step 7: Mutants.**
  - **Three seated.** Use `RELAY_FROM_PLAYERS = 4`: "puts a room that seats three on the relay…" fails.
  - **Sticky.** Leave the relay on `peer-left`: "…keeps it there when the third leaves" fails.
  - **Sender.** Omit `from`: "reports each lobby message with its sender…" fails.
  - **Addressed.** Drop `to` in `sendLobby`: "addresses a lobby message…" fails.
  - **Seat port.** Use `ROLE_PORT[role]` for `seatPort`: "knows its own seat port…" fails.
  - **No offer to the newcomer.** Remove the transport's two-others guard: Review Focus 5 fails (`offers()` is 2), and so does the doSignal test.
  - **Start guard.** Keep the `seatedPeer === null` check: "sends a four-player start…" fails on its first half.
  - **Host tells.** Let every member tell: "lets only the host tell…" fails.
  - **Roster lock.** Count every seat after the lock: "keeps a begun room's route…" fails (route relay).
  - **Announce lock.** Announce every seated peer on `lockRoster`: "announces a roster peer…" fails.
- [ ] **Step 8: Commit**
```bash
git add super-smash/src/net/adapters/doSignal.ts super-smash/src/net/adapters/doSignal.test.ts super-smash/src/net/online/session.ts super-smash/src/net/online/session.test.ts super-smash/src/net/online/testing.ts super-smash/src/lib/onlineStore.ts super-smash/src/app/play/page.tsx super-smash/SPEC.md super-smash/src/lib/onlineStore.test.ts super-smash/src/components/menu/CharacterSelect.online.test.tsx super-smash/src/components/online/OnlineLobby.test.tsx super-smash/src/game/linkMonitor.test.ts super-smash/src/app/play/page.test.tsx super-smash/src/components/menu/StageSelect.test.tsx super-smash/src/components/ControlPrefsSync.test.tsx
git commit -m "super-smash: a session knows every seated player, and a room of three or more plays through the relay"
```

## Task 13: The store tracks every seat

**Files:**
- Modify: `src/lib/onlineStore.ts`:
  - `PEER_LEFT_NOTICE` :38
  - `OnlineErrorReason` :35
  - `playerSentence` :124-150
  - `OnlineFields` :63-85
  - in `bindSession`: `peerBuildMatches` :169, `heardHello` :259-272, `onLobby` :278-320, `seatEmptied` :328-338, `peerSeated` :341, the `peer` case :362-379
  - `remotePort` :419-423
  - `applyLobby` :426-453
- Modify: `src/components/online/OnlineLobby.tsx` (render `notice` under the status line, :291-300)
- Modify: `e2e-online/online.spec.ts` (the hello-refusal test :197-221)
- Test: `src/lib/onlineStore.test.ts`, `src/components/online/OnlineLobby.test.tsx`
- Modify, mechanically (`PEER_LEFT_NOTICE` becomes `seatLeftNotice(1)`): `src/components/menu/StageSelect.test.tsx`, `src/components/online/OnlineLobby.test.tsx`, `src/components/menu/CharacterSelect.online.test.tsx`, `src/components/online/useRejoinResend.test.ts`

**Interfaces:**
- Consumes: the session's `peer` and `lobby` events with `peer` and `from`, `seatPort`, and `sendLobby(…, to)` (Task 12).
- Produces:
  - `interface SeatView { readonly peerId: string; readonly port: number; readonly build: "pending" | "ok" | "mismatch" }`.
  - `OnlineFields.seats: readonly SeatView[]`: the others, by port.
  - `OnlineFields.localPort: number | null`: this machine's port, the seat port until Task 14's begin.
  - `seatLeftNotice(port: number): string` returns `` `P${port + 1} left the room.` ``, replacing `PEER_LEFT_NOTICE`.
  - `seatMismatchNotice(port: number): string` returns `` `P${port + 1} is running a different version, so they can't play in this room.` ``.
  - `OnlineErrorReason` gains `"host-left"`, whose sentence is "The host left, so the room has closed. Create or join another."

**Pinned:**
- **`connected`.**
  - For the host: at least one seat, every seat `build === "ok"`, and the link open.
  - For a guest: the host's seat (port 0) `"ok"` and the link open.
- **A seat's hello** sets its `build`.
- **A newcomer hears this side's hello.** On a `peer` arrival while the link is open (relay, or a direct link already open), this side sends its hello addressed `to` the newcomer. Without it nobody greets a newcomer to an open relayed room: the link status does not change, so `channelOpened()` never runs.
- **Per-seat hello timer, on the host.** Each seat gets `HELLO_TIMEOUT_MS` (5 s) from the moment it is seated with the link open. If its build is still `"pending"` when that runs out, the host refuses that seat alone, as below. The guest keeps today's single timer, waiting on the host's hello.
- **A host refusing a guest's build** (a mismatching hello, or its timer) does not leave. It:
  - logs `console.warn("David-Smash: not playing the other player's build:", why)`, as `refuseBuild` does today (`describeMismatch`, or the timer's reason);
  - sends `{ kind: "refuse", reason: "engine-mismatch" }` `to` that guest;
  - marks the seat `"mismatch"`;
  - sets the notice `seatMismatchNotice(port)`;
  - leaves `status` short of `connected` while that seat stays.
- **The mismatch notice outlives the refused seat.** When a `"mismatch"` seat empties, the notice stays `seatMismatchNotice(port)`; `seatLeftNotice` does not overwrite it.
- **A guest** that hears a mismatching host hello, or receives a `refuse` from the host with no start out, does `leaveRefused("engine-mismatch")`.
- **Ports for picks and stages.** A `pick` goes to the sender's seat port, and is dropped from a peer with no seat. A `stage` counts only from the port-0 peer.
- **A seat emptying**, only while `config === null` (the lobby), clears that port's fighter and costume, sets `seatLeftNotice(port)`, and removes the seat. Mid-match the link monitor decides, as today (onlineStore.ts :371-378).
- **The host leaving.** Only while `config === null`: a guest whose port-0 peer leaves fails with `"host-left"` and leaves the room. Mid-match a direct link outlives the host's room socket, as D54 says.
- **`OnlineLobby` shows the notice** in a paragraph under the status line, when there is one.
- **`localPort`** is `session.seatPort` from the `joined` event until Task 14's begin replaces it.
- **Navigation** still happens on `connected` until Task 14. With capacity 2 the two-player flow is unchanged, apart from the copy of the left notice and the hello refusal.

- [ ] **Step 1: Write the failing tests.**
  - `it("lists each seated player by port, with their build pending until their hello")`.
  - `it("is connected for the host only when every seated player's build matches")`: three seats, two ok and one pending, give `linking`. When the third is ok, the status is `connected`.
  - `it("keeps the host in the room when one guest runs another build: refuses that guest alone and says so")`:
    - `sent` includes the addressed refuse;
    - the notice is `seatMismatchNotice(2)`;
    - `errorReason` is null and the session is not closed.
  - `it("files each pick under its sender's port, and drops one from a peer with no seat")`.
  - `it("takes the stage only from the host's seat")`.
  - `it("clears only the leaving player's panel, and names their port")`: the notice is `"P3 left the room."`.
  - `it("closes a guest's room when the host leaves, with its own sentence")`.
  - `it("leaves a running match alone when the host's room socket drops: no host-left, no panel cleared")`: with `config` set, the host's `peer` departure changes nothing.
  - `it("says hello to a newcomer joining an open room, addressed to them")`: the link is open, then a `peer` arrival; `sendLobby.mock.calls` holds `[hello, "<newcomer id>"]`.
  - `it("reaches connected as a newcomer to an open relayed room, from the host's addressed hello")`: a guest store with the link open and route relay, then the host's hello arriving `from` the port-0 peer, gives status `connected`.
  - `it("refuses only the seat whose hello never comes, after HELLO_TIMEOUT_MS")`: with fake timers, one seat says hello and one does not. At 5 s the silent seat is `"mismatch"` and gets an addressed refuse; the room stays open.
  - `it("keeps the mismatch notice when the refused seat leaves, and says why in the console")`: `console.warn` is spied with the line above, and after the seat's departure the notice is still `seatMismatchNotice(1)`.
  - In `OnlineLobby.test.tsx`, `it("shows the room's notice under the status line")`.
  - Update the existing tests that assert `PEER_LEFT_NOTICE` to assert `seatLeftNotice(1)`, in this file and the four mechanically edited ones.
- [ ] **Step 2: Update the hello-refusal e2e** (`online.spec.ts` :197-221).
  - The **guest's** alert reads "The other player is running a different version. Both reload the page."
  - The host's page shows `seatMismatchNotice(1)` and does not move to `/stage`.
  - The console line check stays on the host.
- [ ] **Step 3: Run** `pnpm vitest run src/lib/onlineStore.test.ts src/components/online/OnlineLobby.test.tsx`. Expected: FAIL (predicted).
- [ ] **Step 4: Implement.** Replace `peerBuildMatches`, `peerSeated` and `remotePort` with the `seats` list and `portOf(peerId)`.
- [ ] **Step 5: Run** gates 1 and 4 (the online suite, with the updated refusal test).
- [ ] **Step 6: Mutants.**
  - **Pending.** Mark a new seat `"ok"`: "lists each seated player…" fails.
  - **Every seat.** Use `some` for `every`: "is connected for the host only when every…" fails.
  - **Host stays.** Keep `leaveRefused` on the host side: "keeps the host in the room…" fails.
  - **Pick port.** Use the first seat's port: "files each pick…" fails.
  - **Stage source.** Accept a stage from any seat: "takes the stage only…" fails.
  - **One panel.** Clear every remote port: "clears only the leaving player's panel…" fails.
  - **Host left.** Treat the host leaving as a seat emptying: "closes a guest's room…" fails.
  - **Lobby only.** Drop the `config === null` guard: "leaves a running match alone…" fails.
  - **Newcomer hello.** Skip the addressed hello: "says hello to a newcomer…" fails.
  - **Guest connected.** Take the host's hello only from a `link: open`: "reaches connected as a newcomer…" fails.
  - **Seat timer.** Refuse the whole room when the timer runs out: "refuses only the seat…" fails (room closed).
  - **Notice kept.** Let `seatLeftNotice` overwrite: "keeps the mismatch notice…" fails.
  - **Notice shown.** Render nothing for `notice`: the `OnlineLobby` test fails.
- [ ] **Step 7: Commit**
```bash
git add super-smash/src/lib/onlineStore.ts super-smash/src/lib/onlineStore.test.ts super-smash/src/components/online/OnlineLobby.tsx super-smash/src/components/online/OnlineLobby.test.tsx super-smash/e2e-online/online.spec.ts super-smash/src/components/menu/StageSelect.test.tsx super-smash/src/components/menu/CharacterSelect.online.test.tsx super-smash/src/components/online/useRejoinResend.test.ts
git commit -m "super-smash: the online store keeps every seat, its build check and its picks, and one guest on another build no longer closes the room"
```

## Task 14: The waiting room, and the host's Start

**Files:**
- Modify: `src/net/online/lobby.ts` (`LobbyMessage` :88-103, `parseLobbyMessage` :139-189)
- Modify: `src/lib/onlineStore.ts`: new `beginRoom`; `begun` and the roster in `OnlineFields`; the `peer` and `lobby` handling; `full`'s sentence :126-127
- Modify: `worker/src/room.ts` (`ROOM_CAPACITY` :43-44 becomes 4)
- Modify: `src/components/online/OnlineLobby.tsx` (navigation effect :181-186, `statusText` :307-322, the panel :217-248)
- Modify: `e2e-online/online.spec.ts` (`startOnlineMatch` :67-86, the phone test :140-157, the full-room test :269-284, Task 7's relay test)
- Modify: `src/app/play/page.tsx` (`online` :105-112 reads the store's `localPort`; moved here from Task 16 so the page is never on a stale port)
- Modify: `SPEC.md` §9 (the `/online` row)
- Test: `src/net/online/lobby.test.ts`, `src/lib/onlineStore.test.ts`, `src/components/online/OnlineLobby.test.tsx`, `worker/src/room.test.ts`, `src/net/roomWorker.integration.test.ts`, `src/app/play/page.test.tsx`

**Interfaces:**
- Consumes: `SeatView`, `seats` and `localPort` (Task 13); `configureOnline(count)` (Task 11); `sendLobby(…, to)` and `lockRoster(ids)` (Task 12).
- Produces:
  - `LobbyMessage` gains `{ kind: "begin"; seats: readonly { id: string; port: number }[] }`. It parses only with 2-4 entries, unique ids of 1-16 characters, and ports exactly `0..n-1` once each.
  - `OnlineFields.begun: boolean`.
  - `export function beginRoom(): boolean`. It is true when sent, and false (changing nothing) unless this side is the host, `status === "connected"` and at least one seat is held.
  - `OnlineErrorReason` gains `"room-begun"`, whose sentence is "That room has already started its match. Ask the host for a new room."
  - `full`'s sentence becomes `` `Room ${roomCode} already has four players.` ``.

**Pinned:**
- **The begin.** The host sends `begin` with itself at port 0 and the seats in seat-port order, compacted to `1..n-1`. It then sets every seat's `port` to its match port, `localPort` to 0, `begun` to true, calls `configureOnline(n)`, and calls `session.lockRoster` with the other players' ids. Every member, host or guest, calls `lockRoster` again on each begin it applies.
- **A guest receiving `begin`** from the port-0 peer:
  - if its id is listed: `localPort` becomes its entry's port, the seats are remapped, then `configureOnline(n)` and `begun`;
  - if not: it fails with `"room-begun"` and leaves.
- **After the begin, a newcomer** (a `peer` arrival not on the roster) meets the host:
  - if a roster port has no seated peer, the newcomer gets the lowest such port, and the host re-sends `begin` with the roster updated;
  - otherwise the host re-sends `begin` unchanged, and the newcomer, unlisted, leaves.
  - Listed members apply a re-sent `begin` by remapping only.
  - A `peer` arrival after the begin is not added to `seats` until a `begin` lists it, so a stranger never appears in the waiting list, the Start count or the link monitor's `peers`.
- **After the begin, `connected`** also needs every roster port seated.
- **Navigation.** `OnlineLobby` navigates on `begun` (the host to `/stage`, a guest to `/fighters`), no longer on `connected`.
- **Waiting-room copy, verbatim.**
  - Host status, nobody in yet: "Read the code to the other players. Waiting for them to join…".
  - Host status, someone in but not every seat ready: "Waiting for every player to be ready…".
  - Host status, every seat ready: "Everyone is ready. Press Start when all your players are in.".
  - Seat rows: `` `P${port + 1} · ${label}` ``, where the label is "Host (you)" or "You" for this machine. For another seat it is "Ready" (`ok`), "Checking the version…" (`pending`) or "Different version" (`mismatch`). The host's row is "P1 · Host" on a guest's screen.
  - The host's button is `` `Start (${seats.length + 1} players)` ``. It is disabled unless `connected`, and it calls `beginRoom()`.
  - Guest status: `` `You are P${localPort + 1}. Waiting for the host to start…` ``.

- [ ] **Step 1: Write the failing tests.**
  - In `lobby.test.ts`, `it("reads a begin's seats only as two to four unique ids on ports 0 to n-1")`.
  - In `room.test.ts`, `it("seats four and turns a fifth away with full")`.
  - In `onlineStore.test.ts`:
    - `it("begins a room the host can start: compacts the seats to match ports and seats that many players")`: seats on ports 0, 2 and 3 give match ports 0, 1 and 2, `players.length` 3, and `rules.oneOnOne` false.
    - `it("refuses to begin before everyone is connected, or with nobody in")`.
    - `it("follows the host's begin onto its own match port")`.
    - **Review Focus 3:** `it("Review Focus: a joiner whose hello is pending holds the Start, and one seated after the begin with no seat free is told and leaves")`:
      - a host with 2 ok seats and a third arriving `pending`: `beginRoom()` is false;
      - then, once that seat's hello is ok (3 ok seats), `beginRoom()` is true;
      - a later arrival with all ports filled gives a re-sent unchanged `begin`;
      - on the newcomer's own store, that begin gives `errorReason: "room-begun"` and `session.close` called.
    - **Review Focus 4:** `it("Review Focus: a seat emptied after the begin goes to the next joiner, on the same port, with an empty panel")`:
      - a begun room of 3, and port 2's peer leaves (panel cleared, notice "P3 left the room.");
      - a newcomer arrives, and the re-sent begin lists it on port 2;
      - `players[2].fighterId` is null;
      - once its hello is ok, `status` is `connected`;
      - on the newcomer's own store, the re-sent begin plus the host's addressed hello (Task 13) give `localPort` 2 and `connected`;
      - `session.lockRoster` was called with the newcomer's id on the host's side.
  - In `OnlineLobby.test.tsx`:
    - `it("shows the host the seats, and the Start once every seat is ready")`, with the exact row copy, both host status lines and the button label;
    - `it("shows a guest its seat while it waits")`;
    - `it("leaves the lobby on the begin, not on connecting")`.
  - In `page.test.tsx`, `it("plays this machine's port from the begin, not its room seat")`: store `localPort` 1 with `session.seatPort` 2 gives `net.localPorts` `[1]`.
- [ ] **Step 2: Run** the five files. Expected: FAIL (predicted).
- [ ] **Step 3: Implement** as pinned. Raise `ROOM_CAPACITY` to 4.
- [ ] **Step 4: Update the online e2e.**
  - `startOnlineMatch` clicks `Start (2 players)` on the host after the join, then waits for `/stage` and `/fighters` as before. Add a helper `startRoom(host: Page, players: number)` that clicks `Start (${players} players)` once it is enabled, and use it in the phone test and the relay test as well.
  - The full-room test becomes `test("a fifth browser is turned away from a full room")`: four join, and the fifth's alert reads `` `Room ${code} already has four players.` ``. These are lobby pages only, so there is no WebGL.
  - The live-room test (`roomWorker.integration.test.ts`): its first test admits four (`self.port` 0-3) and turns a fifth away with `full`.
- [ ] **Step 5: Update `SPEC.md` §9's `/online` row** to:
  > | `/online` | Create a room (a four-letter code to read out) or join one by its code; up to four players. A waiting room lists who is in, by port; the host starts once at least one other player is in and every one is on the same build (the hello), and everyone goes on to the select screens. The status line says each step, including "Connecting through the relay…" (D60) |
- [ ] **Step 6: Run** gates 1, 3 (capacity changed in the Worker), and 4 (both e2e suites).
- [ ] **Step 7: Mutants.**
  - **Begin parse.** Allow repeated ports: the `lobby` test fails.
  - **Capacity.** Leave `ROOM_CAPACITY` at 3: the `room` test fails.
  - **Compaction.** Send seat ports uncompacted: "begins a room… compacts" fails.
  - **Connected gate.** Drop the `connected` check: "refuses to begin…" fails, and so does Review Focus 3.
  - **Guest port.** Ignore its own entry's port: "follows the host's begin…" fails.
  - **Unlisted newcomer.** Admit an unlisted newcomer: Review Focus 3 fails.
  - **Seat reuse.** Give the newcomer `seats.length`: Review Focus 4 fails on port 2.
  - **Lobby copy.** Use the old host copy: the first `OnlineLobby` test fails.
  - **Guest copy.** Show `localPort` without +1: "shows a guest its seat…" fails.
  - **Navigation.** Navigate on `connected`: "leaves the lobby on the begin…" fails.
  - **Roster lock.** Skip `lockRoster` on a re-sent begin: Review Focus 4 fails on its last line.
  - **Page port.** Read `session.seatPort` on the page: "plays this machine's port from the begin…" fails.
- [ ] **Step 8: Commit**
```bash
git add super-smash/src/net/online/lobby.ts super-smash/src/net/online/lobby.test.ts super-smash/src/lib/onlineStore.ts super-smash/src/lib/onlineStore.test.ts super-smash/worker/src/room.ts super-smash/worker/src/room.test.ts super-smash/src/components/online/OnlineLobby.tsx super-smash/src/components/online/OnlineLobby.test.tsx super-smash/e2e-online/online.spec.ts super-smash/SPEC.md super-smash/src/net/roomWorker.integration.test.ts super-smash/src/app/play/page.tsx super-smash/src/app/play/page.test.tsx
git commit -m "super-smash: rooms hold four, and the host starts from a waiting room once everyone is in and on the same build"
```

## Task 15: The select screens serve every seat

**Files:**
- Modify: `src/components/menu/CharacterSelect.tsx` (:35, :81, the preload :228-237, `canStart` :240)
- Modify: `src/components/menu/PlayerOptions.tsx` (:6, :24), `src/components/menu/PadOptions.tsx` (:20, :120), `src/components/online/useRejoinResend.ts` (:4, :26-36)
- Modify: `src/net/signalProtocol.ts` (delete `ROLE_PORT` :16-17), `src/net/online/testing.ts` (:14)
- Modify, mechanically: `src/game/matchRunner.test.ts` (imports `ROLE_PORT` at :41 and uses it at :625 and :649; those become the ports 0 and 1 written out)
- Modify: `src/lib/onlineStore.ts` (`setOwnStickJump` :481-487 and `setOwnPad` :497-502 read the store's `localPort`)
- Test: `src/components/menu/CharacterSelect.online.test.tsx`, `PlayerOptions.test.tsx`, `PadOptions.test.tsx`, `src/components/online/useRejoinResend.test.ts`

**Interfaces:**
- Consumes: `OnlineFields.localPort`, `seats` and `begun` (Tasks 13-14).
- Produces: no component takes a port from the role. `ROLE_PORT` is gone, and `signalProtocol.test.ts`'s "puts the host on port 0 and the guest on port 1" (:146) is deleted with it, now pinned by Task 9's port test.

**Pinned:**
- Each machine owns the panel at `localPort`.
- The footer already maps every player (:442-465).
- The preload fetches every concrete pick in `players`.
- `canStart` is true when ready, and either offline or (host and `connected`).
- `useRejoinResend` sends the pick for `localPort`, and the host's stage on every move into `connected`.
- `StageSelect.tsx` needs no change: its `canContinue` (:44) and `sendHostStage` (:206) mean the same with N seats. This is ruled out, not missed.

- [ ] **Step 1: Write the failing tests.**
  - In `CharacterSelect.online.test.tsx`:
    - `it("gives a guest on port 3 its own panel among four, and the others' picks in theirs")`;
    - `it("preloads every player's pick, not only the first two")` (`preloadModels` is mocked and called with all three concrete ids of three picks);
    - `it("lets the host start four only when every seat is connected")`.
  - `PlayerOptions.test.tsx` and `PadOptions.test.tsx`: `it("shows only this machine's own seat, at its port from the room")` with `localPort` 2.
  - `useRejoinResend.test.ts`: `it("repeats the pick for this machine's own port")` with `localPort` 3.
- [ ] **Step 2: Run** the four files. Expected: FAIL (predicted).
- [ ] **Step 3: Implement.** Delete `ROLE_PORT`, and fix every reader the compiler names.
- [ ] **Step 4: Run** gates 1 and 4.
- [ ] **Step 5: Mutants.**
  - **Panel.** `onlinePort = onlineRole === "host" ? 0 : 1`: the port-3 panel test fails.
  - **Preload.** Preload `players.slice(0, 2)`: the preload test fails.
  - **Start gate.** `canStart` ignores `connected`: the start test fails.
  - **Own seat.** Use port 1 for a guest in `PlayerOptions`: its test fails.
  - **Resend port.** `useRejoinResend` sends port 1: its test fails.
- [ ] **Step 6: Commit**
```bash
git add super-smash/src/components/menu/CharacterSelect.tsx super-smash/src/components/menu/CharacterSelect.online.test.tsx super-smash/src/components/menu/PlayerOptions.tsx super-smash/src/components/menu/PlayerOptions.test.tsx super-smash/src/components/menu/PadOptions.tsx super-smash/src/components/menu/PadOptions.test.tsx super-smash/src/components/online/useRejoinResend.ts super-smash/src/components/online/useRejoinResend.test.ts super-smash/src/net/signalProtocol.ts super-smash/src/net/signalProtocol.test.ts super-smash/src/net/online/testing.ts super-smash/src/lib/onlineStore.ts super-smash/src/game/matchRunner.test.ts
git commit -m "super-smash: the select screens give each online player their own panel, up to four"
```

## Task 16: The match for N players; anyone leaving ends it for all

**Files:**
- Modify: `src/app/play/page.tsx` (`abandon`'s `fighters` :646, `ports` :701, `startLinkMonitor` :733-744)
- Modify: `src/game/linkMonitor.ts` (`LinkMonitorOptions` :42-57, the watchdog :75, the subscriptions :135-146)
- Modify: `src/components/menu/Results.tsx` (:42-43)
- Modify: `SPEC.md` §5
- Test: `src/game/linkMonitor.test.ts`, `src/app/play/page.test.tsx`, `src/components/menu/Results.test.tsx`

**Interfaces:**
- Consumes: the store's `seats` (Tasks 13-14; the page already reads `localPort` from Task 14); the session `lobby` event's `from` (Task 12); `NetStats.rttMs` as the worst ping (Task 10).
- Produces:
  - `LinkMonitorOptions.peers: readonly string[]`: the roster's other peer ids. It is required.
  - The monitor keeps one `ConnectionWatchdog` per listed peer, each fed only by that peer's messages.
  - `onHealth`'s health is the worst of the watchdogs, and `peerAway` is true if any peer is away.
  - Any peer's watchdog reaching `lost`, or an `onPeerLeave` for a peer in `peers`, declares the match lost. A leave from anyone else (a stranger who typed the code) changes nothing.

**Pinned:**
- **The play page.**
  - `ports` is `config.fighters.map((_, port) => port)`.
  - `abandon`'s `fighters` is `Object.fromEntries(config.fighters.map((id, port) => [port, id]))`.
  - It passes `peers: useOnlineStore.getState().seats.map((s) => s.peerId)`.
- **The NetHud is unchanged.** Its PING is `rttMs`, now the worst.
- **Results copy, verbatim:**
  - `connectionLost`: "The connection to another player was lost before the match finished. Nobody wins this one."
  - `desync`: "The games went out of sync, so this match can't count."

- [ ] **Step 1: Write the failing tests.**
  - In `linkMonitor.test.ts`:
    - `it("calls the match lost when one of three peers goes silent, though the others keep talking")`: B and C send every 100 ms, and D sends nothing. Lost at `SILENCE_LOST_MS` (D's).
    - `it("gives the minute only to the peer who said it is away")`: D says away and goes silent; B goes silent without saying. Lost at `SILENCE_LOST_MS` (B's), not `AWAY_LOST_MS`.
    - `it("reports the worst peer's health")`.
    - `it("ignores the leave of a peer who is not in the match")`: `onPeerLeave("stranger")` with `peers: ["b", "c"]` leaves `onLost` uncalled.
  - In `page.test.tsx`: `it("mounts an online match of four with ports 0-3")`. It asserts the `mountMatch` arguments (`ports`, and the monitor's `peers`) through the existing mock.
  - In `Results.test.tsx`, the two copy assertions.
- [ ] **Step 2: Run** the three files. Expected: FAIL (predicted).
- [ ] **Step 3: Implement** as pinned.
- [ ] **Step 4: Amend `SPEC.md` §5.** Add a bullet:
  > **One player gone ends the match.** In a room of three or four, a player who leaves (their room socket closes) or goes silent past `SILENCE_LOST_MS` (a minute when they said they switched tabs) ends the match for everyone, as Connection Lost; nobody plays on with a frozen port.
- [ ] **Step 5: Run** gates 1 and 4.
- [ ] **Step 6: Mutants.**
  - **Silent peer.** Feed one shared watchdog: "calls the match lost when one of three peers goes silent…" fails.
  - **Away.** Set away on every dog: "gives the minute only…" fails.
  - **Worst health.** Report the best health: "reports the worst…" fails.
  - **Stranger.** Declare lost on any leave: "ignores the leave of a peer who is not in the match" fails.
  - **Ports.** Keep `ports: [0, 1]`: the page test fails.
  - **Copy.** Keep the old Results copy: its test fails.
- [ ] **Step 7: Commit**
```bash
git add super-smash/src/app/play/page.tsx super-smash/src/app/play/page.test.tsx super-smash/src/game/linkMonitor.ts super-smash/src/game/linkMonitor.test.ts super-smash/src/components/menu/Results.tsx super-smash/src/components/menu/Results.test.tsx super-smash/SPEC.md
git commit -m "super-smash: an online match runs every port it was started with, and any player leaving or going silent ends it for all"
```

## Task 17: Four browsers play online

**Files:**
- Modify: `e2e-online/online.spec.ts`

**Interfaces:**
- Consumes: everything in Phase B, and Task 8's verdict. If Task 8 stopped and reported, this task runs as the controller ruled.

- [ ] **Step 1: Add a helper** `startFourPlayerMatch(pages: Page[])`:
  - route `**/models/**` to a 404 on every context;
  - the host creates the room and three join;
  - the host clicks `Start (4 players)`;
  - the host picks Battlefield and Choose Fighters;
  - each guest picks roster button `nth(i + 1)`;
  - the host clicks Ready to fight;
  - all four wait for `/play`.
- [ ] **Step 2: Write the tests.**
  - `test("four browsers play a match through the relay")`:
    - every page passes frame 180 within 60 s;
    - each page's `__smashNet.route === "relay"`;
    - `stats().peers === 3` and `stats().desyncs === 0` on each, and `hashesCompared > 0` on the host;
    - the HUD line ends `· RELAY`;
    - guest 3 brings its page to the front and holds ArrowRight: its fighter (`readFighters(host)[3].x`) moves on the host's screen within 10 s.
  - `test("one of four closing their tab ends the match for the other three")`: guest 2's context closes, and the other three reach `/results` with "Connection Lost" within `LINK_LOST_LIMIT_MS`.
- [ ] **Step 3: Run** gate 4: `pnpm test:e2e:online --trace off`, the whole suite, at a machine load of 6 or under.
- [ ] **Step 4: Mutants.**
  - **Lost match.** In `src/app/play/page.tsx`, make the link monitor's `onLost` a no-op: "one of four closing…" fails, with no page reaching `/results`.
  - **Relay route.** In `session.ts`, set `RELAY_FROM_PLAYERS = 5`: "four browsers play a match through the relay" fails on the route (or never reaches `/play`).
- [ ] **Step 5: Commit**
```bash
git add super-smash/e2e-online/online.spec.ts
git commit -m "super-smash: the online e2e plays a four-browser match through the relay, and one leaving ends it for the rest"
```

## Task 18: D60's Phase B, SPEC §2 and §12, the README

**Files:**
- Modify: `DECISIONS.md` (D60), `SPEC.md` §2 and §12, `README.md` (`src/net` :44, `e2e-online` :51, the online paragraph :76-77), `docs/superpowers/plans/README.md`

- [ ] **Step 1: D60 gains "Phase B: rooms of up to four"**, in prose, with these facts:
  - **Seats and topology.** The room assigns ports (host 0, the lowest free port next). A room that seats three plays through the relay, a star, with no mesh, and stays there.
  - **Begin and seats.** Begin compacts seats to match ports. A seat emptied before the match goes to the next joiner. A joiner with no seat free is told the room began. The begin locks the roster: a stranger who types the code moves nobody to the relay, is never heard, and their leaving ends nothing.
  - **Hello.** Each side greets a newcomer with an addressed hello. A seat that never says hello is refused alone after `HELLO_TIMEOUT_MS`.
  - **Leaving and the build check.** The host leaving closes the room. One guest on another build is refused alone, and the room stays.
  - **Rollback.** Per-peer hashes, frame advantage and RTT. The delay follows the slowest peer, and the HUD shows the worst ping. Ping tokens carry the pinger's port. `ack` and broadcast Pongs are kept (Task 10's reasons).
  - **Ending the match.** Any player leaving or going silent ends the match for all.
  - **Budget.** Quote ≈2,884 requests per 8-minute 4-player match at 30 messages/s, and that a four-player room always spends budget, where a two-player room spends it only when it falls back.
  - **Task 8's measured frame rates** (the four deltas, and whether the flags were needed).
  - **Rejected.**
    - A WebRTC mesh: 6 links for 4 players, and one blocked pair blocks the room.
    - A host-forwarded star: it breaks per-sender bookkeeping, and the host carries everyone's upload.
    - Continuing without a departed player: it needs consensus on the frame a port turns neutral.
- [ ] **Step 2: Amend `SPEC.md` §2.** "In:" gains "online, two to four players, one per machine, through a room code."
- [ ] **Step 3: Amend `SPEC.md` §12.** Add "CPU players and spectators in online rooms; more than four online."
- [ ] **Step 4: Update both READMEs.**
  - `README.md`: `src/net` and `e2e-online` describe four-player rooms and the relay. The online paragraph says up to four players, with the host starting from the waiting room.
  - Plans README: Plan 7's row (tasks 18, D60, what ships), the status line ("Plan 7 executed"), and "7 / after 18: deploy Phase B" under "Steps that stop for David".
- [ ] **Step 5: Run** gate 1. Documents only, so no mutant.
- [ ] **Step 6: Commit**
```bash
git add super-smash/DECISIONS.md super-smash/SPEC.md super-smash/README.md super-smash/docs/superpowers/plans/README.md
git commit -m "super-smash: D60 records four-player online rooms; the spec and READMEs follow"
```

After Task 18, the controller reviews Phase B whole, runs the full gate, and pushes. On David's go, it deploys and runs the online suite against the live Worker with `SMASH_URL`, the four-browser tests included.

---

## Coverage of the two-player hardcodes (the research table's 15 rows)

| # | Where | Task |
|---|---|---|
| 1 | Room capacity and roles, `welcome.peer`, one-peer forwarding, "already has two players" | 9 (ports, `peers[]`, `to`, fan-out), 14 (capacity 4, the sentence, the e2e) |
| 2 | `doSignal.ts`: one connection | 3 (relay mode), 9 (`to` on signals), 12 (relay peers as a set; a direct link only with two). The mesh is ruled out by the Spec |
| 3 | `session.ts`: single-peer state | 4 (fallback), 12 (N seats, three or more relay, `from` and `to`) |
| 4 | `onlineStore.ts`: one peer, one hello, `remotePort` | 5 (route), 13 (seats), 14 (begin, ports) |
| 5 | `lobby.ts`: two-tuple config | 11 |
| 6 | `onlineConfig.ts`: exactly 2, `oneOnOne` forced | 11 |
| 7 | `matchConfig` `configureOnline` seats 2 | 11 |
| 8 | Select screens and the lobby UI (`ROLE_PORT`, preload, `canStart`, lobby copy) | 14 (lobby), 15 (select screens; `StageSelect` ruled unchanged) |
| 9 | `rollback.ts` (a) hashes, (b) advantage, (c) RTT | 10. (d) `ack` minimum and (e) Pong broadcast are ruled out with reasons in Task 10 |
| 10 | Mid-match leave policy | 16 |
| 11 | Play page `ports`, results `fighters`, HUD, e2e `peers === 1` | 16, 17 (the two-player tests keep `peers === 1`) |
| 12 | Packet format | Ruled out: unchanged. The relay's sender stamp and batch framing sit outside `packet.ts` (Tasks 1-2) |
| 13 | Input delay | 10 (slowest peer) |
| 14 | Desync check | 10 |
| 15 | Engine, stats, render | Ruled out: already N-player (`createInitialState`, four spawns per stage, `oneOnOne` derived) |

## For David

Each item below is a decision the plan made that is David's to overrule.

1. **The relay is sticky for the room.** Once a room relays, a newcomer to that room relays too, even if their network could go direct, and a room that once seated three stays on the relay. This is simpler and costs budget only for that room.
2. **A host leaving closes the room for its guests** (`host-left`). Today a guest could wait for a new host to take the code, which only someone typing the same code could do.
3. **One guest on another build no longer closes a two-player room on the host's side.** The host stays, with a notice, and the guest leaves with today's sentence. The hello-refusal e2e changes with it (Task 13).
4. **Every Worker deploy ends relayed matches in progress** (the room socket is the link). Direct matches still survive a deploy.
5. **Two-player rooms now need the host's Start too.** Every room goes through the waiting room. The lobby moves on at the host's Start (`begin`), not as soon as the other player is connected.
6. **Seats are renumbered at the Start.** The room assigns seat ports (host 0, the lowest free next), as the Spec says. If a seat emptied before the Start, the Start compacts the seats to match ports `0..n-1`, so a player can play on a different port than their waiting-room seat. Without a gap they are equal.
7. **A room that seats a third player moves to the relay without any message.** Every member sees the same joins and switches on its own. Only the host tells a later newcomer.
