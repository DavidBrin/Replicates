import type { ProjectInfo } from "@/lib/registry";

/**
 * The seven sibling replicas as encyclopedia subjects. Facts are sourced
 * exclusively from `research/02-project-dossiers.md` (extracted from each
 * project's own README) — nothing here is invented.
 *
 * `liveUrl` is `null` for every project below: as of this writing nothing in
 * the repo is deployed (research/02-project-dossiers.md, "Root repo": "No
 * live URLs exist yet for any project"). This is the ONE field to edit to
 * make a project's "Website" infobox row and external links go live — set it
 * to the deployed URL and the stub red link becomes a normal blue external
 * link (DECISIONS D3). See the README's "add your live project link" guide
 * for the step-by-step.
 */
export const projects: ProjectInfo[] = [
  {
    name: "Linear",
    slug: "Linear_(replica)",
    tagline: "the issue tracker, rebuilt from measurements",
    replicaOf: { name: "Linear", url: "https://linear.app" },
    folder: "Linear",
    stack: ["Next.js 16", "PGlite (local)", "Neon (production)"],
    testStats: "1,559 unit tests, 23 e2e",
    builtWith: "Six research lanes, seven build slices",
    liveUrl: null,
    screenshots: [
      "Linear/docs/screenshots/issue-list.png",
      "Linear/docs/screenshots/issue-detail.png",
      "Linear/docs/screenshots/board.png",
      "Linear/docs/screenshots/projects.png",
      "Linear/docs/screenshots/command-palette.png",
      "Linear/docs/screenshots/members.png",
      "Linear/docs/screenshots/marketing.png",
      "Linear/docs/screenshots/dag.png",
    ],
  },
  {
    name: "Notion",
    slug: "Notion_(replica)",
    tagline: "marketing site + product, one session",
    replicaOf: { name: "Notion", url: "https://www.notion.so" },
    folder: "Notion",
    stack: ["Next.js", "IndexedDB (no backend)", "four StorageAdapter implementations"],
    testStats: "147 tests",
    builtWith: "Parallel research agents; single-threaded foundation; then 4 parallel surface agents",
    liveUrl: null,
    screenshots: [],
  },
  {
    name: "YouTube",
    slug: "YouTube_(replica)",
    tagline: "the server never opens a codec",
    replicaOf: { name: "YouTube", url: "https://www.youtube.com" },
    folder: "youtube",
    stack: [
      "Next.js",
      "PGlite (local) / Neon (production)",
      "hand-written MP4 demuxer, fMP4 muxer, HLS packager",
      "MSE player with its own ABR",
    ],
    testStats: "2,227 unit tests, 38 e2e specs",
    builtWith: "Nine research lanes, twelve build slices, five codex rounds (~72 findings)",
    liveUrl: null,
    screenshots: [
      "youtube/docs/screenshots/replica-home-1920.png",
      "youtube/docs/screenshots/replica-watch-1920.png",
    ],
  },
  {
    name: "Super Smash",
    slug: "Super_Smash_(replica)",
    tagline: "eight fighters, one keyboard, sixty frames a second",
    replicaOf: { name: "Super Smash Bros. Ultimate", url: "https://www.smashbros.com/en_US/" },
    folder: "super-smash",
    stack: [
      "Next.js",
      "WebRTC rollback netcode",
      "Q12 fixed-point simulation",
      "seeded PRNG inside GameState",
    ],
    testStats: "1,285 unit/property tests, 7 e2e",
    builtWith: "Eight research lanes, frozen engine contract, six build slices",
    liveUrl: null,
    screenshots: [
      "super-smash/docs/screenshots/title.png",
      "super-smash/docs/screenshots/main-menu.png",
      "super-smash/docs/screenshots/character-select.png",
      "super-smash/docs/screenshots/stage-select.png",
      "super-smash/docs/screenshots/rules.png",
      "super-smash/docs/screenshots/match.png",
      "super-smash/docs/screenshots/match-2.png",
      "super-smash/docs/screenshots/controls.png",
    ],
  },
  {
    name: "Fake Phone",
    slug: "Fake_Phone",
    tagline: "never feel alone",
    replicaOf: {
      name: "the iOS and Android incoming-call screen",
      url: "https://support.apple.com/guide/iphone/answer-or-decline-phone-calls-iph3f4d0f80/ios",
    },
    folder: "fake-phone",
    stack: ["Next.js", "installable PWA"],
    testStats: "363 unit tests, 89 e2e",
    builtWith: "Six research lanes, six build slices",
    liveUrl: null,
    screenshots: [
      "fake-phone/docs/screenshots/home.png",
      "fake-phone/docs/screenshots/home-full.png",
      "fake-phone/docs/screenshots/ios-incoming.png",
      "fake-phone/docs/screenshots/ios-in-call.png",
      "fake-phone/docs/screenshots/android-incoming.png",
      "fake-phone/docs/screenshots/android-in-call.png",
      "fake-phone/docs/screenshots/live-streaming.png",
      "fake-phone/docs/screenshots/live-primer.png",
      "fake-phone/docs/screenshots/ring-countdown.png",
    ],
  },
  {
    name: "Bet",
    slug: "Bet_(app)",
    tagline: "a private, friend-first prediction market",
    replicaOf: { name: "Polymarket", url: "https://polymarket.com" },
    folder: "bet",
    stack: ["Next.js", "Hanson's LMSR pricing engine", "fast-check property-based tests", "in-memory store"],
    testStats: "~664 unit/property/route tests",
    builtWith: "A 14-task plan: implementer + independent reviewer + fix loop per task",
    liveUrl: null,
    screenshots: [],
  },
  {
    name: "Dollar Pixels",
    slug: "Dollar_Pixels",
    tagline: "$1 buys nine pixels",
    replicaOf: { name: "The Million Dollar Homepage", url: "http://www.milliondollarhomepage.com" },
    folder: "dollar-pixels",
    stack: ["Next.js", "canvas renderer with O(1) hit-testing", "Stripe (one env var away)"],
    testStats: "414 unit/property tests, 30 e2e",
    builtWith: "Five research lanes, five build slices",
    liveUrl: null,
    screenshots: [
      "dollar-pixels/docs/screenshots/the-wall.png",
      "dollar-pixels/docs/screenshots/selecting.png",
      "dollar-pixels/docs/screenshots/zoomed.png",
      "dollar-pixels/docs/screenshots/checkout.png",
      "dollar-pixels/docs/screenshots/new-page.png",
      "dollar-pixels/docs/screenshots/directory.png",
      "dollar-pixels/docs/screenshots/landing.png",
    ],
  },
];
