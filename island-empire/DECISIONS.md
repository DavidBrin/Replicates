# Island Empire — Decision Log

Every choice this spec makes, with the reasoning and the evidence file it
rests on. Numbered sequentially; entries are never renumbered or reused.

---

## D1 — The board is a square grid with 4-neighbour adjacency, not hex

**Decision.** Every rule, coordinate, and rendering formula in this project uses a square grid and orthogonal (4-neighbour) adjacency.

**Why.** `research/06-research-brief.md` §2 is screenshot- and video-frame-verified: thin square grid lines, diagonal tiles never carry a shield badge, territory borders drawn along tile edges. The genealogy lane (`04-genealogy-slay-antiyoy-engine.md`) worked from Slay/Antiyoy's hex source and is explicitly superseded wherever it says "hex" — its algorithms (province flood-fill, move-zone BFS, defence max-reduce, map-generator blob fill) are still the right *shapes*, just re-derived over 4 neighbours instead of 6.

**Consequence.** No axial/cube coordinate math anywhere (§5 of the genealogy doc is inapplicable); tile coordinates are plain `{x, y}` integers, hit-testing is exact integer division, no rounding.

---

## D2 — A unit may chain unlimited free repositions per turn, but only 4 tiles at a time

**Decision.** Each individual MOVE is a budget-4 flood fill through the unit's own province (Antiyoy's `UNIT_MOVE_LIMIT`), but a move to an empty owned tile does not mark the unit acted — it may issue another budget-4 move immediately, any number of times, until it attacks or clears a field/grave.

**Why.** The brief's §6 explicitly frames this as free repositioning capped only by "one attack per turn" (Slay semantics) while also confirming the 4-step lit-region UI (Antiyoy's bound). Both are true simultaneously once repositioning is understood as *not consuming the action*, only recomputed fresh from wherever the unit currently stands — exactly how Antiyoy's own `readyToMove` flag behaves (genealogy §2.5: only `attack`/`chop` clear it).

---

## D3 — Knight L3/L4 cost and upkeep: 30/40 gold, 12/30 upkeep

**Decision.** Carried directly from the brief's own decision (§4, §13): cost follows `10 × level`; upkeep follows the curve `2, 5, 12, 30`.

**Why.** L1/L2 are screenshot-confirmed; L3/L4 are extrapolated by the brief, not by me — restated here because §3.2 of this spec depends on it and every implementer needs the number in one place without re-deriving it.

---

## D4 — Woodwall and stone tower defend only their own tile

**Decision.** Unlike the city (D5), a wall or tower's strength applies to its own tile alone — it never projects onto neighbours.

**Why.** `crop-shields-wt-0330.png` (cited in the brief) shows a woodwall's own tile reading "2" while its neighbour reads the city's "1", not the wall's "2". This is confirmed for the woodwall; the stone tower's self-only behaviour is the brief's parallel decision (no screenshot shows a stone tower's neighbour, but nothing suggests towers behave differently from walls, and Antiyoy's own Tower is likewise self-only per genealogy §2.4).

---

## D5 — The city projects strength-1 defence to its 4 neighbours

**Decision.** The city is the one building that behaves like a unit for defence purposes: self + 4 same-province neighbours, at strength 1.

**Why.** Confirmed directly by the strength chart (brief §4: "L2 beats L1 and city") requiring the city to have a defence number, and by the general "defence = max over self + same-province neighbours" rule applying to buildings and units alike per Antiyoy's `Hex.getDefenseNumber` (genealogy §2.4) — walls are the deliberate exception (D4), not the rule.

---

## D6 — Grass fields never spread; graves become fields after 2 of the owner's turns

**Decision.** No field-spreading mechanic exists anywhere on the map, ever. A grave auto-converts to a grass field once its owner has started 2 turns since the death.

**Why.** The brief's own decision (§2, §13): 200 reviewed frames show fields only as fixed map obstacles, never growing. The 2-turn grave timer is the brief's decision, restated here because §3.8's turn sequence needs the exact trigger point (owner's turn-start, not a global clock) spelled out.

---

## D7 — Province split: largest fragment keeps the treasury; capturing the city always zeroes it

**Decision.** On a real split (>1 fragment), the single largest fragment inherits the whole prior treasury and every other fragment starts at 0. If the captured tile was the province's city tile, the treasury is zeroed outright, independent of fragment sizes.

**Why.** The first half is Antiyoy's `FieldManager.splitProvince`, byte-exact (genealogy §2.7). The second half **deliberately fixes a bug the genealogy doc flags in Antiyoy's own shipped code**: Antiyoy's guard for "don't inherit money when the captured hex was the capital" tests a field that has already been zeroed earlier in the same function, so it never fires — meaning Antiyoy's actual behaviour lets the largest fragment inherit money even on a direct capital capture, contradicting the Slay manual's stated rule ("if a capital is destroyed... all its money will be lost"). This spec follows the manual's *stated intent*, not Antiyoy's *shipped accident* — capturing a city always destroys that province's money, full stop.

---

## D8 — Province merge: surviving city is the largest fragment's, ties broken by lowest `(y, x)`

**Decision.** When a capture unites ≥2 of the capturer's own provinces (or lone tiles), the combined province's gold is the sum of every merging piece's gold, and the surviving city is whichever merging fragment was largest by tile count; a tie is broken by the lowest `(y, x)` tile index among the candidate cities.

**Why.** The "largest keeps the capital" half is Antiyoy's `checkToUniteProvinces` (genealogy §2.7) and the Slay manual's own "smaller territory's capital disappears" rule. The tie-break is this spec's own addition — neither source states one, and `apply()` must be deterministic (§4's contract, tested by the determinism property test in §11), so an arbitrary but stable rule was required. Lowest `(y, x)` was picked because it needs no extra state and is trivially reproducible from the tile list alone.

---

## D9 — A lone (size-1) tile is not a province: no gold, no building, and it can starve

**Decision.** A single captured tile with no same-owner neighbour never gets a `Province` object. Its income is computed and discarded (not banked anywhere), nothing can be built on it, and a unit standing on it starves at the owner's next turn-start if it is still friendless.

**Why.** Antiyoy's `DetectorProvince` only registers a `Province` at size ≥2 (genealogy §2.7), and its `checkForAloneUnits` starvation rule (genealogy §2.8) is independent of bankruptcy — both restated in the brief (§3: "a unit standing there with no friendly neighbour starves at turn start").

---

## D10 — The shop is a fixed 4-card set in each mode, replacing the brief's ambiguous "level 4+ also Farm" clause

**Decision.** Nothing selected → always Knight L1, Woodwall, Stone Tower, Farm (4 cards). A friendly unit selected → always Knight L1–L4 merge cards, with any card that would push the merge past level 4 disabled.

**Why.** The brief (§6) hedges: *"with nothing selected the HUD shows Knight L1 and Woodwall cards (level 4+ also Farm; the row scrolls when more items exist [decision])"* — it never states what gates Farm's appearance ("level 4+" of what — the player's highest unit? the province?). Rather than invent an ungrounded gating condition, this spec always offers all four buildable items, using the brief's own "row scrolls when more items exist" clause to handle the narrow-viewport case. This is strictly simpler to implement and test, and every cost/upkeep number in the economy table (§3.2) already applies regardless of purchase path, so nothing about the numbers changes — only when a card is visible.

---

## D11 — Gold is always spent from the province that owns the target tile, not a separately-tracked "active province"

**Decision.** `BUY`'s and `ATTACK`'s province lookup is derived purely from the action's `at`/`unitAt` tile — there is no `GameState.activeProvinceId` field.

**Why.** The brief's UI description implies a notion of "the selected/active province" whose income/gold the HUD displays, but nothing requires that to be *stored* state rather than *derived* state. Deriving it from the action's own coordinates keeps `apply()` fully self-contained and side-effect-free with respect to selection (a UI/session concern per §4's layering), and matches `super-smash`'s precedent of keeping the simulation ignorant of anything the player merely *looked at*.

---

## D12 — One-click-move attacks with the weakest ready unit that still wins

**Decision.** With the setting ON, tapping a capturable tile adjacent to several of the player's ready units picks the **weakest** one whose strength still exceeds the tile's defence; if none qualifies, the tap does nothing.

**Why.** The brief confirms the toggle exists and its default (OFF) but not its tie-break (§6). Picking the weakest sufficient unit is the choice that best preserves the player's stronger units for harder targets — an inference from the genre's general "don't overkill" instinct (Antiyoy's own `findMostAttractiveHex`/allure heuristic makes a similar economy-of-force argument for the AI, genealogy §4.3.2) rather than a documented Island Empire rule.

---

## D13 — UNDO is a full per-turn stack

**Decision.** Every action taken during a turn can be undone, in reverse order, until the stack is empty; `END_TURN` clears it.

**Why.** The brief only confirms UNDO exists and greys out when empty (§6); it does not say whether it is single-step or multi-step. A full stack is strictly more useful, costs nothing extra to implement (the engine already returns immutable states), and "greys out when nothing to undo" reads naturally as "stack is empty" rather than "you already undid your one allowed undo."

---

## D14 — AI starting-gold handicap by difficulty: Easy ×0.5, Normal ×1, Hard ×1.5

**Decision.** A campaign level's AI seats have their authored `startGold` multiplied by 0.5/1/1.5 for Easy/Normal/Hard respectively, rounded to the nearest integer.

**Why.** The brief flags this as an open decision (§8: *"Easy/Normal/Hard = AI tier... and starting-gold handicap for the AI"*) without numbers. A symmetric multiplier around 1× is the simplest rule that produces a real, tunable difference per difficulty without needing per-level hand-authored gold tables, and keeps `MapDefinition.difficulty` a small, uniform structure (§4) rather than three full duplicate `players[]` arrays.

---

## D15 — Random maps: every province starts at 10 gold

**Decision.** Carried directly from the brief (§4, §11), itself Antiyoy's `Province.DEFAULT_MONEY = 10` (genealogy §2.2).

---

## D16 — Random map generator: Antiyoy's pipeline, re-derived over 4-neighbour flood fills

**Decision.** `src/engine/generator/` implements: seeded island-blob flood fill → road-link blobs → crop to bounds → require one connected landmass ≥25% of the bounded area → scatter mountains/forest/fields/ponds → assign random owners → balance passes (cap province size, equalise province counts per seat within 1, guarantee every seat a ≥3-tile starting province) → 10 gold + one L1 unit per starting province — all using 4-neighbour BFS/flood fill instead of the hex 6-neighbour version.

**Why.** The brief's decision (§11), which itself adapts genealogy §3's byte-level Antiyoy `MapGenerator.java` reading. Re-derived over 4-neighbour adjacency per D1; every acceptance threshold (25% land, ±1 province-count fairness) is carried unchanged since they are ratios, not grid-shape-dependent.

---

## D17 — AI: the two-phase greedy heuristic, re-derived over 4-neighbour allure/defence math

**Decision.** `src/engine/ai/` implements: per ready unit, attack the reachable enemy tile with the highest "allure" (count of same-owner 4-neighbours after capture), heavy units prefer walls/towers, else clear a field, else retreat from an exposed border tile; then spend — build walls/towers where predicted defence gain clears a threshold, buy units in ascending level only while the province stays solvent `level+1` turns ahead, merge when it enables a needed capture. Difficulty deltas (Easy: no walls, 50% chance to skip a unit, random target; Normal: full heuristic; Hard: + idle-unit push to the front + a safety check before leaving a border tile) match the brief's table exactly.

**Why.** The brief's decision (§10), itself genealogy §4's byte-level reading of Antiyoy's `ArtificialIntelligence`/`AiEasy`/`AiHardSlayRules`. Every "6 neighbours" reference in the source becomes "4 neighbours" here per D1; the allure/defence-gain formulas are otherwise unchanged since they are already neighbour-count-agnostic ratios.

---

## D18 — Canvas + code-drawn pixel-art sprites, no image assets

**Decision.** Every terrain/building/unit/decoration is drawn from code (shapes, fills, simple geometry) onto pre-rasterised offscreen canvases, never loaded from an image file.

**Why.** There is no legitimate way to obtain HBRZ's own art, exactly the reasoning `super-smash`'s D2 records for Nintendo's. Generation also avoids the failure mode of an asset-production stall that D2 cites as having killed multiple prior open-source clones.

---

## D19 — 32px native sprites, continuous zoom, palette measured from the screenshots

**Decision.** Every tile, building and unit is drawn once onto a 32×32 native offscreen canvas (outlines `#1A1010`) and blitted nearest-neighbour at `camera.tilePx / 32`, where `tilePx` is a continuous zoom (48–160 px desktop, 56–200 px phone). The SPEC §8 palette is the one `research/05-visual-design.md` measured with PIL from the store screenshots, not an eyeballed approximation.

**Why.** The visual lane measured 94–216 px tile spacing across the store screenshots at a fixed 1080 px width — the real game zooms continuously, so integer-only scaling would not reproduce it. Stair-step analysis of the peasant portrait in `play-05.png` gives an 8 px block unit and a ~24 px figure, so a 32 px native canvas holds every visible detail (eyes, belt, shield) with room for a plume. Because the source is authored crisp and the blit is nearest-neighbour, a fractional scale only moves stair-steps by a pixel; it never blurs.

---

## D20 — 8 fixed player colours; 5 measured on screen, 3 extrapolated

**Decision.** Seat order `blue #337DF8, red #C6293B, green #52C73F, yellow #F2C531, purple #8E44AD, pink #DE26D3, orange #F07C2A, grey #595959`.

**Why.** Blue, red, green, pink/magenta and grey were sampled from territory borders and the weekly-challenge minimaps (`play-03`, `play-04`, `play-06`, `play-10`). The game markets 8 seats and the campaign puts the human on blue with red as the first enemy and green as the second (levels 1–24 in the walkthroughs), so blue is seat 0. Yellow, purple and orange fill the remaining seats with hue separation from every measured colour.

---

## D21 — Type: Pixelify Sans, white fill with a black text-shadow outline

**Decision.** UI/HUD text uses Google Fonts' "Pixelify Sans" (bold weight), self-hosted at build via `next/font/google`, rendered white with a 4-direction black `text-shadow` outline.

**Why.** The screenshots' headline copy ("EVERY MOVE MATTERS", "Weekly Challenges", "Choose Your Strategy") is a chunky, rounded pixel face, closer to Pixelify Sans than to a thin retro face like Press Start 2P. Self-hosting at build matches the house pattern `Linear/SPEC.md` §5 documents for Inter Variable — no runtime CDN dependency, consistent with the zero-config promise every sibling app makes.

---

## D22 — Persistence: PGlite locally, Neon in production, no third driver

**Decision.** Reuse Linear's exact driver-selection shape: `DATABASE_URL` present ⇒ Neon; absent ⇒ PGlite; `DB_DRIVER` can force either; production refuses PGlite unless an explicit, serverless-fenced escape hatch is set (`E2E_ALLOW_PGLITE_PRODUCTION_BUILD` + `!isServerless()`).

**Why.** Brief §12 states this pattern explicitly, citing `00-repo-conventions.md`. Re-deriving Linear's `env.ts`/`adapters/db/*` shape rather than inventing a new one keeps island-empire consistent with every sibling and avoids re-discovering the exact failure modes Linear's comments already document (an ephemeral serverless filesystem silently discarding PGlite's writes; a wrong `DB_DRIVER` value must throw, never fall back).

---

## D23 — Progress/settings in `localStorage`; maps and challenge records in Postgres

**Decision.** `campaign progress`, `stars`, and `settings` (one-click-move, music, sound, `deviceId`) never touch the network. `maps` and `challenge_records` are the only two Postgres tables.

**Why.** The brief states this split exactly (§12): "Persistence is only needed for... progress/settings [localStorage]... custom maps and weekly-medal records [Postgres]." No accounts exist, so there is nothing else that could plausibly need a server round-trip.

---

## D24 — The weekly-challenge pool is uniformly the `maps` table — seeded levels are inserted as ordinary rows too

**Decision.** At `db:push`/seed time, the 7 non-tutorial campaign levels are inserted into the `maps` table (`eligible_for_challenge = true`) alongside whatever community maps exist, so `selectWeeklyChallenge` never special-cases "seeded vs. community" — it is always "pick 3 rows from `maps`."

**Why.** Without this, weekly selection would need two different code paths (one reading `src/content/levels/*.ts`, one reading the DB) and a way to disambiguate a picked id's source when resolving it for play. Inserting the seeded levels as real rows collapses that into one code path and one loader (`/play/custom/[mapId]`), at the cost of a small amount of duplicated data (the levels also exist as bundled TypeScript literals for `/play/campaign/[levelId]`, which must keep working with an empty/unseeded DB).

---

## D25 — Weekly picks are recomputed deterministically from the ISO week on every request — no stored "this week" row, no cron

**Decision.** `GET /api/challenges/current` calls a pure function of `(now, pool)` every time it's hit; nothing is written to the database to "lock in" a week's picks.

**Why.** The brief specifies "three maps chosen deterministically... by ISO week" (§8), which is exactly the property a pure seeded-PRNG selection gives for free — anyone hitting the endpoint in the same ISO week and with the same pool gets the same 3 maps, with no scheduled job needed to roll them over at the week boundary. This is also the simplest correct thing for a personal Vercel project with no cron/queue infrastructure. The one caveat, accepted deliberately: if the `maps` pool changes *within* a week (a new community map submitted), the pool passed to the selection function should be pinned to "all maps as of the most recent Monday 00:00 UTC" rather than "all maps right now," to avoid the picks visibly shifting mid-week for players who load the page twice — implemented by filtering `maps.created_at <= weekStart` in the query that builds `pool`.

---

## D26 — Medal tiers equal the difficulty beaten; tracked by a `localStorage` `deviceId`, not an account

**Decision.** Bronze/Silver/Gold correspond exactly to beating a challenge map on Easy/Normal/Hard. `challenge_records` is keyed `(map_id, device_id, difficulty)`, unique, where `device_id` is a UUID generated once client-side and stored in `localStorage`.

**Why.** The brief confirms medals exist per difficulty (§8, "3 medal dots" visible in `play-06.png`) without specifying the mapping; difficulty-equals-medal is the simplest faithful reading and needs no separate scoring system. A `deviceId` stands in for an account since the project deliberately has none (§2); it is not a security boundary, only a way to make "already played" idempotent per device.

---

## D27 — Campaign progress is scaled down proportionally: 12 levels × 3 difficulties = 36 max stars

**Decision.** One star per difficulty beaten per level; the original game's "120 stars per island" (40 levels × 3 difficulties) scales to 36 for this replica's 12-level island.

**Why.** The brief ships one 12-level island in place of the original's 3×40 (§8's replica-decision row), so the star total must scale with it rather than being copied verbatim — 120 stars across 12 levels would imply a different per-level structure the brief never specifies.

---

## D28 — One island of 12 hand-made levels, plus direct tap-to-jump on the overworld

**Decision.** 5 tutorial + 7 puzzle levels ship as the entire campaign; the overworld supports both the original's sequential walking avatar **and** a direct tap on any already-unlocked node.

**Why.** The brief's explicit decision (§8): it both satisfies "≥10 seeded maps" from the task and fixes the one concrete UX complaint the research surfaced — Slyther Droid's review calling the walk-only navigation "tedious" and asking for exactly this fix.

---

## D29 — `/play` splits into three route shapes by where the `MapDefinition` comes from

**Decision.** `/play/campaign/[levelId]` (bundled content, zero DB dependency, deep-linkable) · `/play/custom/[mapId]` (DB-backed, deep-linkable — editor "Play" and the share page both use it) · `/play/session` (client-store-backed, for random and hot-seat, whose maps are generated at setup time and never persisted).

**Why.** Not stated in the brief; this is a genuine architectural gap the spec had to close. Forcing every play mode through one dynamic route would mean either (a) writing every random/hot-seat map to the database just to get it an id, which is wasted writes and clutters the `maps` table's "real" custom-map listing, or (b) a single route that sometimes reads a URL param and sometimes reads a client store, which is a harder contract to test. Splitting by data source mirrors `super-smash`'s own precedent exactly: match configuration lives in a client `zustand` store (`matchConfig`) precisely because it is generated at setup time and would be lost on a cold `page.goto` — the same reasoning applies here to `sessionConfig`.

---

## D30 — Two contracts are published first, not one: engine types, then session config

**Decision.** `src/engine/types.ts` + `src/engine/index.ts` land as S1's first commit. `src/game/sessionConfig.ts` + `src/game/tutorialTriggers.ts` land as S2's first commit, immediately after.

**Why.** The task requires S1 to publish first so S2–S5 can compile against it — but S3 (content/tutorials) and S5 (random/hot-seat setup) both need to *write into* a session-configuration shape that belongs conceptually to S2's in-game screen, not to S1's engine (selection/camera/tutorial-progress are UI concerns per §4's layering rule, so they cannot live in `engine/types.ts`). Naming this as an explicit second published contract, rather than letting each of S3/S5 invent its own ad-hoc "how do I start a game" shape, is what keeps the five slices actually disjoint.

---

## D31 — The layering test bans a longer list of sibling directories, because AI and the generator live *inside* `engine/`

**Decision.** `src/engine/layering.test.ts` bans imports from `render/, game/, components/, app/, ports/, adapters/, content/` (plus `react`/`next`), not just `render/, net/, ...` as `super-smash`'s version does.

**Why.** `super-smash` keeps `ai/` as a sibling of `engine/` and therefore bans engine from importing it; this project's brief explicitly puts `src/engine/ai/` and `src/engine/generator/` **inside** `engine/` (§4), so those are normal internal imports, not violations — but `content/` (level data) is new and must be banned in the *opposite* direction from what might be assumed: `content/` imports `engine/`'s types to author `MapDefinition`s, never the reverse, so `engine/` importing `content/` would be the layering violation to catch.

---

## D32 — No online play, no IAP, no ads, no unlockable-skin economy

**Decision.** Restated from the brief (§8, §14) as a spec-level scope line, §2/§13: this ships as a free, fully offline-capable personal project with one cosmetic skin per biome and nothing to purchase.

**Why.** Matches the task's explicit instruction ("out: online/IAP/ads/skins economy") and the brief's own replica-decision table, which cuts every monetisation mechanic while keeping the deterministic, skill-only combat the game's own tagline advertises ("No luck, no money, no upgrades. Only your skill counts.").

---

## D33 — The weekly countdown is computed client-side; nothing server-timed exists

**Decision.** "Available Nd Hh Mm" is `nextMondayUTC - Date.now()`, recomputed on the client every render tick the challenges screen is open; no server-side timer or scheduled job produces or updates it.

**Why.** Consistent with D25 — since the picks themselves are recomputed per-request rather than stored, there is no server-side "week" object to hang a countdown off of; deriving it purely from the current instant and the well-known ISO-week Monday boundary needs no additional state anywhere.

---

## D34 — One-click-move is a per-device setting, not per-map or per-session

**Decision.** The toggle lives in `localStorage` (`src/ports/settings.ts`), applying to every game the device plays, not saved into any `MapDefinition` or `sessionConfig`.

**Why.** The brief frames it as a general settings-screen toggle (§9), not a map- or mode-specific option, and every other setting (music, sound) is already device-scoped in `localStorage` per D23 — keeping all three together in one adapter avoids a second, inconsistent settings surface.

---

## D35 — Captured farms and walls are destroyed; captured mines change hands

**Decision.** Capturing a tile destroys any farm, woodwall or stone tower on it and collects a chest; a mine survives and pays +8 to its new owner.

**Why.** The brief (§5) confirms that a capture destroys the unit or building on the tile — the strength chart literally lists farms and walls as things a knight "beats". A mine is different in kind: it is never buyable, it is authored into a level as a resource (`play-03` shows one sitting in neutral land between two players), and destroying it on first contact would delete the level's only reason to fight over that spot. Keeping it makes mines the contested objectives the maps are drawn around.

---

## D36 — No income on day 1; the win check runs the instant a player is eliminated

**Decision.** The turn-start pipeline (income, upkeep, bankruptcy, starvation, grave aging) is skipped for every seat while `turnNumber === 0`. Elimination is checked after every capture, and if only one player remains the game ends immediately, even mid-turn.

**Why.** Campaign level 1 opens with 1 gold and income 2 and the first walkthrough frame still shows 1 gold with the human to move (`sheet-a00`, `wt-0005`), so income is not paid before a player's first turn. Ending the game on the capture that eliminates the last opponent matches every walkthrough's victory moment (the level ends on the capture of the last city, not after NEXT DAY).

---

## D37 — Undo replays the turn's history from a turn-start snapshot

**Decision.** `GameState.turnStart` holds the core state after the turn-start pipeline; `UNDO` drops the last `history` entry and replays the rest from that snapshot inside the engine.

**Why.** One snapshot per turn instead of one per action keeps memory flat regardless of how many actions a turn has, the engine is pure so the replay is exact, and a turn rarely exceeds 30 actions on a 40×40 map — well under the 20 ms budget SPEC §11 asserts. It also keeps UNDO inside the engine (so AI and tests see identical semantics) without nesting snapshots recursively.

---

## D38 — Weekly challenges: pool = seeded non-tutorial levels plus every community map; medals in localStorage only

**Decision.** `selectWeeklyChallenge` draws from the 7 seeded puzzle levels plus all rows of `maps`; there is no eligibility flag, no created-at pinning, and no `challenge_records` table — medals live in `localProgress.challengeMedals`.

**Why.** The feasibility review called the community-pool machinery disproportionate for a project with no accounts and a handful of maps at launch. Dropping the server-side record removes one table and one route from the heaviest slice (S4) while keeping the visible feature — three rotating maps, medals per difficulty, a countdown — exactly as the store screenshot shows it.

---

## D39 — The Easy AI recruits at most one knight per province per turn

**Decision.** In `buyKnights`, an Easy province stops after its first successful knight purchase each turn; Normal and Hard keep buying while solvent.

**Why.** A simulation of a Normal AI driving the human seat beats Easy on every level 01–11, so the levels are winnable by competent play — but a scripted first-time player (two knights, march on the city) lost levels 02–11 because Easy fielded a knight for every spare 10 gold and out-expanded it. The tutorial island exists to teach; Easy should let a learner make one economic mistake and recover. Slyther Droid's review that even the original's Easy "feels tough" is noted, and Normal keeps that feel.

---

## D40 — Two bankruptcy and chest edge cases are resolved by the data model, not by new state

**Decision.** A bankrupt unit on a bridge or a mine dies without leaving a grave. A chest authored on a player's own land is collected when one of their units steps onto it; a chest on foreign or neutral land is collected on capture.

**Why.** The codex review asked for graves on bridges and mines and for chests to pay only on capture. A grave is a terrain (`Terrain = "grave"`) and a bridge is a terrain too, so a grave on a bridge would need a second state dimension on every tile for a corner case the walkthroughs never show; a mine keeps its building, and a tile cannot hold a building and a grave. Own-land chests exist only when a level author places one there; letting the owner walk onto it is the obvious reading of "+10 once" and avoids a chest that can never be collected. Both are exceptions to a rule, stated in SPEC §3.2, not new mechanisms.

---

## D41 — The engine sells every knight level for direct placement, including attack-buys; the human shop exposes Level 1

**Decision.** `BUY knightN` is legal for N = 1..4 on an empty own tile or on an adjacent capturable tile the new knight can beat, at 10·N gold. The nothing-selected shop shows the Level 1 card; higher levels are reached by merge-buy onto a selected knight. The AI uses direct higher-level buys.

**Why.** Codex round 7 asked to restrict attack-buys to Level 1 because the shop only shows that card. But the original game's store screenshot (`play-05.png`) sells Level 1 and Level 4 cards side by side, and Antiyoy's `buildUnitByAttack` accepts any strength — direct purchase is the genre's rule, not a loophole. There is no economic asymmetry: a human who wants a Level 2 knight on a defended tile buys a Level 1 next to it and merge-buys another onto it (10 + 10, both ready), exactly what the AI pays for its direct Level 2. Keeping the rule in the engine keeps the AI strong and the engine faithful; keeping the shop at one placement card keeps the HUD identical to the walkthrough frames.

