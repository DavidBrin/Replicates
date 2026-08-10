/**
 * The ~10 private markets, hand-authored end to end: question, outcomes,
 * a scripted trade sequence, and a scripted chat script. Hand-authoring
 * (rather than procedurally generating) both trades and chat together is
 * deliberate — it's the only way to make the two actually correspond to
 * each other (a chat line reacting to a trade that really happened a
 * moment earlier) while staying fully deterministic (every number below is
 * a literal; nothing here reads from the PRNG).
 *
 * `dayOffset` throughout means "days before the seed's anchor `now`" — a
 * trade/message at `dayOffset: 13.5` happened 13.5 days ago, one at
 * `dayOffset: 0.4` happened ~10 hours ago. `seed.ts` converts these to
 * absolute `Date`s against the single `now` it reads once from `Clock`.
 *
 * Every `trades` list is given in NARRATIVE (any) order here for
 * readability; `seed.ts` sorts each market's trades to chronological order
 * (descending `dayOffset`) before executing them, since the pricing
 * engines are stateful and must see trades in the order they "happened."
 *
 * Coverage (docs/plan.md Task 5): 10 markets, every `MarketStatus`
 * (open/closed/resolving/resolved) present, pricing kinds lmsr×6 /
 * fixedOdds×2 / parimutuel×2, cadence variety (burst-then-quiet: sl-10k,
 * rm-dishes; dramatic late swing: rm-flight; nearly flat: sl-practice),
 * and exactly one non-zero `feeBps` market (sl-10k, 200 = 2%) — every
 * other market is `feeBps: 0` per DECISIONS D3 ("friend markets are
 * fee-free by default").
 */

export type PrivatePricingKind = "lmsr" | "fixedOdds" | "parimutuel";
export type PrivateMarketStatus = "open" | "closed" | "resolving" | "resolved";

export interface OutcomeSeed {
  key: string;
  label: string;
  color: string;
}

export interface TradeSeed {
  dayOffset: number;
  handle: string;
  outcomeKey: string;
  /** Decimal credits spent (a "budget" buy order — the engine determines
   * the resulting share count). */
  budget: number;
}

export interface ChatLineSeed {
  dayOffset: number;
  handle: string;
  text: string;
}

export interface ResolutionSeed {
  winningOutcomeKey: string;
  proposedByHandle: string;
  proposedDaysAgo: number;
}

export interface PrivateMarketSeed {
  key: string;
  groupSlug: string;
  creatorHandle: string;
  question: string;
  resolutionCriteria: string;
  resolutionSource?: string;
  outcomes: OutcomeSeed[];
  pricingKind: PrivatePricingKind;
  feeBps: number;
  /** LMSR only — feeds `defaultB`. */
  expectedParticipants?: number;
  /** fixedOdds only — creator's stated opening probabilities, keyed by
   * outcome key. Need not already sum to exactly 1; `seed.ts` normalizes. */
  fixedOpeningPrices?: Record<string, number>;
  minStake: number;
  maxStake: number;
  stakesVisible: boolean;
  status: PrivateMarketStatus;
  /** Days before `now` the market was opened for trading. */
  createdDaysAgo: number;
  /** Days from `now` the market closes/closed — negative means already in
   * the past. */
  closesInDays: number;
  resolution?: ResolutionSeed;
  trades: TradeSeed[];
  chat: ChatLineSeed[];
}

const YES_NO: OutcomeSeed[] = [
  { key: "yes", label: "Yes", color: "#2bae4c" },
  { key: "no", label: "No", color: "#f43437" },
];

export const PRIVATE_MARKET_SEEDS: readonly PrivateMarketSeed[] = [
  // ---------------------------------------------------------------------
  // Sunday League
  // ---------------------------------------------------------------------
  {
    key: "sl-10k",
    groupSlug: "sunday-league",
    creatorHandle: "maya",
    question: "Will Marcus actually run the 10k on Saturday?",
    resolutionCriteria:
      "Resolves Yes if Marcus posts a finish-line photo or a Strava link before midnight Saturday. No if he doesn't run, bails, or \"forgets his shoes\" again.",
    resolutionSource: "Strava / group chat proof",
    outcomes: YES_NO,
    pricingKind: "lmsr",
    feeBps: 200, // the one market with fees on, so the fee UI has something to show
    expectedParticipants: 7,
    minStake: 1,
    maxStake: 200,
    stakesVisible: true,
    status: "open",
    createdDaysAgo: 14,
    closesInDays: 3,
    trades: [
      { dayOffset: 13.5, handle: "maya", outcomeKey: "no", budget: 20 },
      { dayOffset: 13.2, handle: "jordan", outcomeKey: "no", budget: 15 },
      { dayOffset: 12.8, handle: "sam", outcomeKey: "yes", budget: 10 },
      { dayOffset: 12.5, handle: "liv", outcomeKey: "no", budget: 25 },
      { dayOffset: 11.9, handle: "dev", outcomeKey: "no", budget: 40 },
      { dayOffset: 11.6, handle: "chaosgremlin", outcomeKey: "no", budget: 12 },
      { dayOffset: 9.0, handle: "marcus", outcomeKey: "yes", budget: 30 },
      { dayOffset: 3.2, handle: "sam", outcomeKey: "yes", budget: 15 },
      { dayOffset: 1.5, handle: "maya", outcomeKey: "no", budget: 18 },
      { dayOffset: 0.4, handle: "jordan", outcomeKey: "yes", budget: 10 },
    ],
    chat: [
      { dayOffset: 13.6, handle: "maya", text: "ok I need to make this official. marcus 10k saturday. yes or no" },
      { dayOffset: 13.4, handle: "jordan", text: "no shot. he skipped leg day for a month" },
      { dayOffset: 12.9, handle: "sam", text: "guys have some faith. I'm in on yes" },
      { dayOffset: 12.6, handle: "liv", text: "he said this about the half marathon too. and the 5k before that" },
      { dayOffset: 12.0, handle: "dev", text: "putting my money where my mouth is. taking no" },
      { dayOffset: 11.7, handle: "chaosgremlin", text: "lmao betrayal is a strong word but ok, no from me too" },
      { dayOffset: 9.1, handle: "marcus", text: "rude. I bought new shoes just to prove you all wrong" },
      { dayOffset: 8.9, handle: "liv", text: "the shoes have to actually leave the box marcus" },
      { dayOffset: 3.3, handle: "sam", text: "he posted a training run on strava?? screenshotting this" },
      { dayOffset: 3.1, handle: "chaosgremlin", text: "one 3 mile jog does not a 10k make. staying no" },
      { dayOffset: 1.6, handle: "maya", text: "one training run means nothing. adding to my no" },
      { dayOffset: 1.4, handle: "marcus", text: "the disrespect in this chat is actually crazy" },
      { dayOffset: 0.5, handle: "jordan", text: "fine fine, hedging a little yes just in case" },
      { dayOffset: 0.2, handle: "dev", text: "saturday's gonna be a whole event either way" },
    ],
  },
  {
    key: "sl-practice",
    groupSlug: "sunday-league",
    creatorHandle: "liv",
    question: "Does anyone actually show up to 6am practice this week?",
    resolutionCriteria:
      "Resolves Yes if at least 3 people (not counting the coach) show up to a 6am practice before Sunday. No otherwise.",
    resolutionSource: "whoever's actually awake to take attendance",
    outcomes: YES_NO,
    pricingKind: "lmsr",
    feeBps: 0,
    expectedParticipants: 7,
    minStake: 1,
    maxStake: 100,
    stakesVisible: true,
    status: "open",
    createdDaysAgo: 12,
    closesInDays: 4,
    trades: [
      { dayOffset: 12.0, handle: "liv", outcomeKey: "yes", budget: 10 },
      { dayOffset: 11.5, handle: "jordan", outcomeKey: "no", budget: 10 },
      { dayOffset: 10.0, handle: "sam", outcomeKey: "yes", budget: 8 },
      { dayOffset: 8.5, handle: "chaosgremlin", outcomeKey: "no", budget: 9 },
      { dayOffset: 6.0, handle: "maya", outcomeKey: "yes", budget: 7 },
      { dayOffset: 3.0, handle: "dev", outcomeKey: "no", budget: 8 },
    ],
    chat: [
      { dayOffset: 12.1, handle: "liv", text: "6am practice thursday. who's actually coming" },
      { dayOffset: 11.6, handle: "jordan", text: "lol no. I value sleep" },
      { dayOffset: 10.1, handle: "sam", text: "I'll be there, don't @ me later" },
      { dayOffset: 8.6, handle: "chaosgremlin", text: "putting money on nobody showing up" },
      { dayOffset: 6.1, handle: "maya", text: "harsh but might be accurate" },
      { dayOffset: 3.1, handle: "dev", text: "I'll set an alarm. no promises" },
    ],
  },
  {
    key: "sl-mvp",
    groupSlug: "sunday-league",
    creatorHandle: "maya",
    question: "Who's Sunday League MVP this month?",
    resolutionCriteria:
      "Resolves to whoever the group agrees had the most goal contributions across this month's matches, decided by informal vote in this chat.",
    resolutionSource: "group vote in the market chat",
    outcomes: [
      { key: "marcus", label: "Marcus", color: "#7c6cff" },
      { key: "sam", label: "Sam", color: "#4877ff" },
      { key: "liv", label: "Liv", color: "#a261e1" },
      { key: "chaosgremlin", label: "Chaos Gremlin", color: "#0595b3" },
    ],
    pricingKind: "lmsr",
    feeBps: 0,
    expectedParticipants: 7,
    minStake: 1,
    maxStake: 150,
    stakesVisible: true,
    status: "resolving",
    createdDaysAgo: 14,
    closesInDays: -1,
    resolution: { winningOutcomeKey: "marcus", proposedByHandle: "maya", proposedDaysAgo: 0.3 },
    trades: [
      { dayOffset: 10.0, handle: "maya", outcomeKey: "marcus", budget: 15 },
      { dayOffset: 9.0, handle: "jordan", outcomeKey: "sam", budget: 12 },
      { dayOffset: 7.5, handle: "dev", outcomeKey: "marcus", budget: 20 },
      { dayOffset: 6.0, handle: "liv", outcomeKey: "liv", budget: 18 },
      { dayOffset: 4.0, handle: "chaosgremlin", outcomeKey: "chaosgremlin", budget: 10 },
      { dayOffset: 2.5, handle: "sam", outcomeKey: "sam", budget: 14 },
      { dayOffset: 1.2, handle: "maya", outcomeKey: "marcus", budget: 10 },
    ],
    chat: [
      { dayOffset: 10.1, handle: "maya", text: "monthly mvp market is live. don't be shy" },
      { dayOffset: 9.1, handle: "jordan", text: "sam had that hat trick two weeks ago, easy pick" },
      { dayOffset: 7.6, handle: "dev", text: "marcus has been everywhere on the pitch lately though" },
      { dayOffset: 6.1, handle: "liv", text: "in this economy? betting on myself" },
      { dayOffset: 4.1, handle: "chaosgremlin", text: "same energy, putting it all on me" },
      { dayOffset: 2.6, handle: "sam", text: "reinforcing my own case, no shame" },
      { dayOffset: 1.3, handle: "maya", text: "marcus it is, doubling down before close" },
      { dayOffset: 0.9, handle: "jordan", text: "close is here. marcus really did carry october" },
    ],
  },
  {
    key: "sl-season",
    groupSlug: "sunday-league",
    creatorHandle: "jordan",
    question: "Where does the Sunday League team finish this season?",
    resolutionCriteria:
      "Resolves to whichever bracket the team's final league position falls into once the season standings are posted.",
    resolutionSource: "league standings page",
    outcomes: [
      { key: "top3", label: "Top 3", color: "#2bae4c" },
      { key: "midtable", label: "Mid-table", color: "#efc500" },
      { key: "bottom", label: "Bottom half", color: "#f43437" },
    ],
    pricingKind: "parimutuel",
    feeBps: 0,
    minStake: 1,
    maxStake: 100,
    stakesVisible: false,
    status: "resolved",
    createdDaysAgo: 14,
    closesInDays: -10,
    resolution: { winningOutcomeKey: "top3", proposedByHandle: "jordan", proposedDaysAgo: 9 },
    trades: [
      { dayOffset: 13.0, handle: "jordan", outcomeKey: "top3", budget: 20 },
      { dayOffset: 12.5, handle: "maya", outcomeKey: "midtable", budget: 15 },
      { dayOffset: 12.0, handle: "dev", outcomeKey: "top3", budget: 25 },
      { dayOffset: 11.0, handle: "sam", outcomeKey: "top3", budget: 10 },
      { dayOffset: 10.5, handle: "liv", outcomeKey: "bottom", budget: 8 },
    ],
    chat: [
      { dayOffset: 13.1, handle: "jordan", text: "season standings market, put your allegiance where your mouth is" },
      { dayOffset: 12.6, handle: "maya", text: "realistically we're a mid-table team and that's ok" },
      { dayOffset: 12.1, handle: "dev", text: "no I believe in this squad, top 3 or bust" },
      { dayOffset: 11.1, handle: "sam", text: "agreed, we've been on a run lately" },
      { dayOffset: 10.6, handle: "liv", text: "someone has to be realistic. bottom half, sorry" },
    ],
  },

  // ---------------------------------------------------------------------
  // The Roommates
  // ---------------------------------------------------------------------
  {
    key: "rm-dishes",
    groupSlug: "the-roommates",
    creatorHandle: "dev",
    question: "Does anyone do the dishes before Thursday?",
    resolutionCriteria:
      "Resolves Yes if the sink is empty by Thursday 11:59pm. Photo evidence required, group chat is judge and jury.",
    resolutionSource: "photo of the empty sink",
    outcomes: YES_NO,
    pricingKind: "lmsr",
    feeBps: 0,
    expectedParticipants: 5,
    minStake: 1,
    maxStake: 100,
    stakesVisible: true,
    status: "open",
    createdDaysAgo: 7,
    closesInDays: 2,
    trades: [
      { dayOffset: 6.5, handle: "dev", outcomeKey: "no", budget: 15 },
      { dayOffset: 6.2, handle: "priya", outcomeKey: "no", budget: 10 },
      { dayOffset: 5.8, handle: "kiwi", outcomeKey: "yes", budget: 12 },
      { dayOffset: 5.0, handle: "jordan", outcomeKey: "no", budget: 8 },
      { dayOffset: 3.0, handle: "kiwi", outcomeKey: "yes", budget: 15 },
      { dayOffset: 2.0, handle: "priya", outcomeKey: "no", budget: 12 },
      { dayOffset: 1.0, handle: "dev", outcomeKey: "no", budget: 18 },
      { dayOffset: 0.3, handle: "jordan", outcomeKey: "no", budget: 6 },
    ],
    chat: [
      { dayOffset: 6.6, handle: "dev", text: "opening a market on this because apparently we need incentives now" },
      { dayOffset: 6.3, handle: "priya", text: "the sink situation is genuinely unwell. no from me" },
      { dayOffset: 5.9, handle: "kiwi", text: "offended you'd all doubt me. taking yes, I'll do it myself" },
      { dayOffset: 5.7, handle: "priya", text: "kiwi you said that last week" },
      { dayOffset: 5.1, handle: "jordan", text: "historically this household does not do dishes preemptively" },
      { dayOffset: 4.0, handle: "dev", text: "still a mountain in there for the record" },
      { dayOffset: 3.1, handle: "kiwi", text: "doubling down. gonna prove you all wrong tonight" },
      { dayOffset: 2.9, handle: "jordan", text: "we've heard this before kiwi. genuinely rooting for you though" },
      { dayOffset: 2.1, handle: "priya", text: "sink status: unchanged. adding to my no" },
      { dayOffset: 1.5, handle: "kiwi", text: "ok tonight for real, I have a system" },
      { dayOffset: 1.1, handle: "dev", text: "a system. sure. staying no" },
      { dayOffset: 0.6, handle: "priya", text: "it is thursday morning and the sink remains a crime scene" },
      { dayOffset: 0.4, handle: "jordan", text: "kiwi's system has entered its final hours" },
      { dayOffset: 0.1, handle: "kiwi", text: "the system is still loading. give it time" },
    ],
  },
  {
    key: "rm-flight",
    groupSlug: "the-roommates",
    creatorHandle: "kiwi",
    question: "Will Priya's flight get delayed again?",
    resolutionCriteria:
      "Resolves Yes if Priya's return flight departs more than 60 minutes after its scheduled time. No if it's on time or early. Screenshot of the airline app is final.",
    resolutionSource: "airline app screenshot",
    outcomes: YES_NO,
    pricingKind: "lmsr",
    feeBps: 0,
    expectedParticipants: 5,
    minStake: 1,
    maxStake: 100,
    stakesVisible: true,
    status: "closed",
    createdDaysAgo: 13,
    closesInDays: -2,
    trades: [
      { dayOffset: 13.0, handle: "kiwi", outcomeKey: "no", budget: 10 },
      { dayOffset: 11.0, handle: "priya", outcomeKey: "no", budget: 8 },
      { dayOffset: 8.0, handle: "dev", outcomeKey: "no", budget: 6 },
      { dayOffset: 5.0, handle: "jordan", outcomeKey: "no", budget: 5 },
      { dayOffset: 2.3, handle: "noodle", outcomeKey: "yes", budget: 30 },
      { dayOffset: 2.2, handle: "kiwi", outcomeKey: "yes", budget: 25 },
      { dayOffset: 2.1, handle: "priya", outcomeKey: "yes", budget: 15 },
      { dayOffset: 2.05, handle: "dev", outcomeKey: "yes", budget: 20 },
    ],
    chat: [
      { dayOffset: 13.1, handle: "kiwi", text: "priya's flight market. she's due back tuesday, place your bets" },
      { dayOffset: 11.1, handle: "priya", text: "excuse me I am optimistic about my own flight, taking no" },
      { dayOffset: 8.1, handle: "dev", text: "giving the airline the benefit of the doubt, no" },
      { dayOffset: 5.1, handle: "jordan", text: "agreed, no delay this time" },
      { dayOffset: 2.31, handle: "noodle", text: "PRIYA THE APP JUST WENT RED. 2hr delay" },
      { dayOffset: 2.25, handle: "kiwi", text: "no way. flipping to yes immediately" },
      { dayOffset: 2.15, handle: "priya", text: "of course it's delayed, why am I even surprised at this point" },
      { dayOffset: 2.06, handle: "dev", text: "should've seen this coming honestly. yes all the way" },
    ],
  },
  {
    key: "rm-padthai",
    groupSlug: "the-roommates",
    creatorHandle: "noodle",
    question: "Who finally finishes the leftover pad thai before it goes bad?",
    resolutionCriteria:
      "Resolves to whoever the container ends up empty because of, self-reported, honor system.",
    resolutionSource: "honor system",
    outcomes: [
      { key: "dev", label: "Dev", color: "#7c6cff" },
      { key: "priya", label: "Priya", color: "#f43437" },
      { key: "kiwi", label: "Kiwi", color: "#ff9500" },
      { key: "noodle", label: "Noodle", color: "#28cc95" },
      { key: "jordan", label: "Jordan", color: "#2bae4c" },
    ],
    pricingKind: "fixedOdds",
    feeBps: 0,
    fixedOpeningPrices: { dev: 0.15, priya: 0.25, kiwi: 0.1, noodle: 0.3, jordan: 0.2 },
    minStake: 1,
    maxStake: 40,
    stakesVisible: false,
    status: "open",
    createdDaysAgo: 5,
    closesInDays: 5,
    trades: [
      { dayOffset: 4.5, handle: "noodle", outcomeKey: "noodle", budget: 6 },
      { dayOffset: 3.5, handle: "priya", outcomeKey: "priya", budget: 5 },
      { dayOffset: 2.0, handle: "dev", outcomeKey: "jordan", budget: 4 },
      { dayOffset: 1.0, handle: "kiwi", outcomeKey: "noodle", budget: 3 },
    ],
    chat: [
      { dayOffset: 4.6, handle: "noodle", text: "the pad thai has maybe 2 days left in it. odds are set, go" },
      { dayOffset: 3.6, handle: "priya", text: "it's calling my name at 2am, taking myself" },
      { dayOffset: 2.1, handle: "dev", text: "jordan's the dark horse here, he microwaves everything at midnight" },
      { dayOffset: 1.1, handle: "kiwi", text: "noodle wrote the odds, noodle's definitely eating it. taking noodle" },
    ],
  },
  {
    key: "rm-wifi",
    groupSlug: "the-roommates",
    creatorHandle: "jordan",
    question: "Will the WiFi get fixed by Friday?",
    resolutionCriteria:
      "Resolves Yes if the router gets replaced or reset and a speed test shows over 100mbps by Friday 6pm.",
    resolutionSource: "speed test screenshot",
    outcomes: YES_NO,
    pricingKind: "parimutuel",
    feeBps: 0,
    minStake: 1,
    maxStake: 60,
    stakesVisible: false,
    status: "resolved",
    createdDaysAgo: 10,
    closesInDays: -6,
    resolution: { winningOutcomeKey: "yes", proposedByHandle: "jordan", proposedDaysAgo: 5 },
    trades: [
      { dayOffset: 9.0, handle: "jordan", outcomeKey: "no", budget: 8 },
      { dayOffset: 8.0, handle: "dev", outcomeKey: "yes", budget: 10 },
      { dayOffset: 7.0, handle: "priya", outcomeKey: "no", budget: 6 },
      { dayOffset: 6.5, handle: "kiwi", outcomeKey: "yes", budget: 9 },
    ],
    chat: [
      { dayOffset: 9.1, handle: "jordan", text: "isp ticket #4 is open. I have no faith left, taking no" },
      { dayOffset: 8.1, handle: "dev", text: "calling it now, they fix it same day they always do eventually" },
      { dayOffset: 7.1, handle: "priya", text: "based on ticket #1 through #3's track record, no" },
      { dayOffset: 6.6, handle: "kiwi", text: "optimist tax, taking yes" },
    ],
  },

  // ---------------------------------------------------------------------
  // Fantasy 2026
  // ---------------------------------------------------------------------
  {
    key: "fa-playoffs",
    groupSlug: "fantasy-2026",
    creatorHandle: "birdie",
    question: "Will Marcus's fantasy team make the playoffs?",
    resolutionCriteria:
      "Resolves Yes if Marcus's team is in the top 6 of the league standings when the regular season ends.",
    resolutionSource: "league standings page",
    outcomes: YES_NO,
    pricingKind: "lmsr",
    feeBps: 0,
    expectedParticipants: 6,
    minStake: 1,
    maxStake: 120,
    stakesVisible: true,
    status: "open",
    createdDaysAgo: 14,
    closesInDays: 10,
    trades: [
      { dayOffset: 13.0, handle: "birdie", outcomeKey: "no", budget: 12 },
      { dayOffset: 11.5, handle: "maya", outcomeKey: "yes", budget: 10 },
      { dayOffset: 9.0, handle: "sam", outcomeKey: "yes", budget: 8 },
      { dayOffset: 7.0, handle: "yeetmaster", outcomeKey: "no", budget: 15 },
      { dayOffset: 5.0, handle: "dev", outcomeKey: "yes", budget: 10 },
      { dayOffset: 3.5, handle: "marcus", outcomeKey: "yes", budget: 25 },
      { dayOffset: 2.0, handle: "birdie", outcomeKey: "no", budget: 10 },
      { dayOffset: 0.8, handle: "maya", outcomeKey: "yes", budget: 6 },
    ],
    chat: [
      { dayOffset: 13.1, handle: "birdie", text: "marcus's team has been a mess all season, taking no" },
      { dayOffset: 11.6, handle: "maya", text: "he's got the waiver wire game though, taking yes" },
      { dayOffset: 9.1, handle: "sam", text: "his RB depth is actually pretty solid, agreed with maya" },
      { dayOffset: 7.1, handle: "yeetmaster", text: "his QB is on bye for two more weeks lol. no" },
      { dayOffset: 5.1, handle: "dev", text: "he'll figure it out, he always does. yes" },
      { dayOffset: 3.6, handle: "marcus", text: "putting my money where my mouth is too, betting on myself" },
      { dayOffset: 2.1, handle: "birdie", text: "confidence noted, still not convinced" },
      { dayOffset: 0.9, handle: "maya", text: "topping up before close, this team's for real" },
    ],
  },
  {
    key: "fa-championship",
    groupSlug: "fantasy-2026",
    creatorHandle: "yeetmaster",
    question: "Who wins the Fantasy 2026 championship?",
    resolutionCriteria:
      "Resolves to whoever wins the league's championship matchup in the final week of the season.",
    resolutionSource: "league bracket page",
    outcomes: [
      { key: "dev", label: "Dev", color: "#7c6cff" },
      { key: "maya", label: "Maya", color: "#a394ff" },
      { key: "marcus", label: "Marcus", color: "#efc500" },
      { key: "yeetmaster", label: "Yeetmaster", color: "#0595b3" },
      { key: "birdie", label: "Birdie", color: "#e5bd45" },
      { key: "sam", label: "Sam", color: "#4877ff" },
    ],
    pricingKind: "fixedOdds",
    feeBps: 0,
    fixedOpeningPrices: { dev: 0.1, maya: 0.2, marcus: 0.15, yeetmaster: 0.3, birdie: 0.1, sam: 0.15 },
    minStake: 1,
    maxStake: 80,
    stakesVisible: false,
    status: "open",
    createdDaysAgo: 14,
    closesInDays: 12,
    trades: [
      { dayOffset: 12.0, handle: "yeetmaster", outcomeKey: "yeetmaster", budget: 15 },
      { dayOffset: 9.0, handle: "maya", outcomeKey: "maya", budget: 10 },
      { dayOffset: 6.0, handle: "dev", outcomeKey: "yeetmaster", budget: 8 },
      { dayOffset: 3.0, handle: "marcus", outcomeKey: "marcus", budget: 12 },
      { dayOffset: 1.0, handle: "sam", outcomeKey: "sam", budget: 9 },
    ],
    chat: [
      { dayOffset: 12.1, handle: "yeetmaster", text: "odds are set by yours truly. taking myself, obviously" },
      { dayOffset: 9.1, handle: "maya", text: "the arrogance is not backed by the standings but ok, taking myself" },
      { dayOffset: 6.1, handle: "dev", text: "gonna trust the trash talk on this one, riding with yeetmaster" },
      { dayOffset: 3.1, handle: "marcus", text: "y'all are sleeping on my bench depth, taking myself" },
      { dayOffset: 1.1, handle: "sam", text: "quietly the most consistent team all year. taking myself too" },
    ],
  },
];
