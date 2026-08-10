/**
 * The ~24 public Explore markets (docs/plan.md Task 5): world-event
 * questions across Politics/Sports/Crypto/Culture/Economics/Climate/Tech,
 * Kalshi/Polymarket-shaped, with a mix of binary, multi-outcome and
 * head-to-head sports cards (Task 13 renders all three card variants).
 *
 * Per David's ambiguity resolution, these deliberately avoid putting words
 * or actions on any real named individual — phrasing is institutional
 * ("Will the Fed cut rates...") or, for sports, uses invented team names
 * rather than real ones, so nothing here reads as a claim about a real
 * person or makes up a real organization's action.
 *
 * ## The id-prefix category convention, and why it's gone
 *
 * `Market` originally had no `category` column, so this file encoded a
 * market's category in its **id prefix** (`mkt-sports_…`) and exposed
 * `categoryFromMarketId` to read it back out. `Market.category` was added
 * later and `GET /api/explore` groups on that real field, which left the
 * id-prefix machinery (`EXPLORE_CATEGORIES`, `categoryFromMarketId`) with
 * zero consumers — two ways to answer the same question, one of them
 * unenforced and free to drift. The final review deleted them.
 *
 * `categoryIdPrefix` survives only because `seed.ts` still uses it to mint
 * readable ids; nothing parses those ids back.
 */

import { TOKEN_BLUE, TOKEN_NO, TOKEN_ORANGE, TOKEN_YES, OUTCOME_COLOR_CYCLE } from "./palette";

export type ExploreCategory =
  | "politics"
  | "sports"
  | "crypto"
  | "culture"
  | "economics"
  | "climate"
  | "tech";

/** Prefixes each seeded Explore market's id with its category, purely so
 * ids read legibly in logs and test failures (`mkt-sports_…`). It is no
 * longer load-bearing: see this module's doc comment. */
export function categoryIdPrefix(category: ExploreCategory): string {
  return `mkt-${category}`;
}

export interface ExploreOutcomeSeed {
  key: string;
  label: string;
  color: string;
}

export interface ExploreMarketSeed {
  key: string;
  category: ExploreCategory;
  variant: "binary" | "multi" | "headToHead";
  question: string;
  resolutionCriteria: string;
  resolutionSource: string;
  outcomes: readonly ExploreOutcomeSeed[];
  /** Keyed by outcome `key`; must sum to ~1. */
  startProbabilities: Record<string, number>;
  /** Keyed by outcome `key`; per-day drift in logit space. */
  driftPerOutcome: Record<string, number>;
  /** Per-day logit-space noise scale (shared across outcomes). */
  volatility: number;
  closesInDays: number;
}

const YES_NO_OUTCOMES: readonly ExploreOutcomeSeed[] = [
  { key: "yes", label: "Yes", color: TOKEN_YES },
  { key: "no", label: "No", color: TOKEN_NO },
];

function binaryMarket(
  def: Omit<ExploreMarketSeed, "variant" | "outcomes" | "startProbabilities" | "driftPerOutcome"> & {
    yesProbability: number;
    yesDrift: number;
  },
): ExploreMarketSeed {
  return {
    ...def,
    variant: "binary",
    outcomes: YES_NO_OUTCOMES,
    startProbabilities: { yes: def.yesProbability, no: 1 - def.yesProbability },
    driftPerOutcome: { yes: def.yesDrift, no: -def.yesDrift },
  };
}

export const EXPLORE_MARKET_SEEDS: readonly ExploreMarketSeed[] = [
  // -------------------------------------------------------------- Politics
  binaryMarket({
    key: "politics-coalition",
    category: "politics",
    question: "Will the ruling coalition win the next confidence vote?",
    resolutionCriteria: "Resolves Yes if the government wins the scheduled confidence vote by simple majority.",
    resolutionSource: "official parliamentary record",
    yesProbability: 0.62,
    yesDrift: -0.001,
    volatility: 0.05,
    closesInDays: 45,
  }),
  binaryMarket({
    key: "politics-snap-election",
    category: "politics",
    question: "Will a snap election be called before year-end?",
    resolutionCriteria: "Resolves Yes if a national snap election is formally called before December 31.",
    resolutionSource: "official government announcement",
    yesProbability: 0.22,
    yesDrift: 0.002,
    volatility: 0.06,
    closesInDays: 60,
  }),
  binaryMarket({
    key: "politics-turnout",
    category: "politics",
    question: "Will voter turnout exceed 60% in the next general election?",
    resolutionCriteria: "Resolves Yes if certified turnout is above 60% of registered voters.",
    resolutionSource: "national election commission",
    yesProbability: 0.48,
    yesDrift: 0,
    volatility: 0.05,
    closesInDays: 120,
  }),
  {
    key: "politics-seats",
    category: "politics",
    variant: "multi",
    question: "Which bloc wins the most seats in the next parliamentary election?",
    resolutionCriteria: "Resolves to whichever bloc holds the most seats when the final results are certified.",
    resolutionSource: "national election commission",
    outcomes: [
      { key: "coalition", label: "Governing coalition", color: OUTCOME_COLOR_CYCLE[0]! },
      { key: "opposition", label: "Opposition bloc", color: OUTCOME_COLOR_CYCLE[1]! },
      { key: "regional", label: "Regional parties", color: OUTCOME_COLOR_CYCLE[2]! },
      { key: "other", label: "Other", color: OUTCOME_COLOR_CYCLE[3]! },
    ],
    startProbabilities: { coalition: 0.42, opposition: 0.35, regional: 0.15, other: 0.08 },
    driftPerOutcome: { coalition: -0.001, opposition: 0.0015, regional: 0, other: -0.0005 },
    volatility: 0.04,
    closesInDays: 150,
  },

  // ---------------------------------------------------------------- Sports
  binaryMarket({
    key: "sports-comets-championship",
    category: "sports",
    question: "Will the Comets win this year's league championship?",
    resolutionCriteria: "Resolves Yes if the Comets win the championship series.",
    resolutionSource: "league office final results",
    yesProbability: 0.28,
    yesDrift: 0.001,
    volatility: 0.06,
    closesInDays: 70,
  }),
  {
    key: "sports-comets-vs-harbor",
    category: "sports",
    variant: "headToHead",
    question: "Comets vs. Harbor FC — who wins the semifinal?",
    resolutionCriteria: "Resolves to whichever team wins the semifinal match (including any overtime/shootout).",
    resolutionSource: "league office final results",
    outcomes: [
      { key: "comets", label: "Comets", color: TOKEN_BLUE },
      { key: "harbor", label: "Harbor FC", color: TOKEN_ORANGE },
    ],
    startProbabilities: { comets: 0.55, harbor: 0.45 },
    driftPerOutcome: { comets: 0.0005, harbor: -0.0005 },
    volatility: 0.07,
    closesInDays: 14,
  },
  {
    key: "sports-sox-vs-ironclad",
    category: "sports",
    variant: "headToHead",
    question: "Riverside Sox vs. Ironclad — who takes the series?",
    resolutionCriteria: "Resolves to whichever team wins the best-of-seven series outright.",
    resolutionSource: "league office final results",
    outcomes: [
      { key: "sox", label: "Riverside Sox", color: TOKEN_BLUE },
      { key: "ironclad", label: "Ironclad", color: TOKEN_ORANGE },
    ],
    startProbabilities: { sox: 0.4, ironclad: 0.6 },
    driftPerOutcome: { sox: -0.0008, ironclad: 0.0008 },
    volatility: 0.06,
    closesInDays: 21,
  },
  binaryMarket({
    key: "sports-scoring-record",
    category: "sports",
    question: "Will this season see a new scoring record set?",
    resolutionCriteria: "Resolves Yes if the all-time single-season scoring record is broken before the season ends.",
    resolutionSource: "league official statistics",
    yesProbability: 0.33,
    yesDrift: 0.002,
    volatility: 0.05,
    closesInDays: 100,
  }),

  // ---------------------------------------------------------------- Crypto
  binaryMarket({
    key: "crypto-btc-150k",
    category: "crypto",
    question: "Will Bitcoin close above $150,000 this year?",
    resolutionCriteria: "Resolves Yes if BTC/USD closes above $150,000 on any major exchange before December 31.",
    resolutionSource: "major exchange closing price",
    yesProbability: 0.37,
    yesDrift: 0.001,
    volatility: 0.07,
    closesInDays: 140,
  }),
  binaryMarket({
    key: "crypto-eth-flip",
    category: "crypto",
    question: "Will Ethereum's market cap exceed Bitcoin's before 2030?",
    resolutionCriteria: "Resolves Yes if ETH's total market cap exceeds BTC's on any single day before 2030.",
    resolutionSource: "aggregated market data provider",
    yesProbability: 0.12,
    yesDrift: -0.0005,
    volatility: 0.05,
    closesInDays: 365,
  }),
  binaryMarket({
    key: "crypto-xrp-etf",
    category: "crypto",
    question: "Will a spot XRP ETF be approved in the US this year?",
    resolutionCriteria: "Resolves Yes if a spot XRP ETF receives regulatory approval and begins trading in the US.",
    resolutionSource: "regulator public filings",
    yesProbability: 0.58,
    yesDrift: 0.003,
    volatility: 0.08,
    closesInDays: 90,
  }),
  binaryMarket({
    key: "crypto-exchange-solvency",
    category: "crypto",
    question: "Will a top-10 exchange face a solvency crisis this year?",
    resolutionCriteria: "Resolves Yes if a top-10-by-volume exchange halts withdrawals or files for insolvency.",
    resolutionSource: "public reporting from major financial news outlets",
    yesProbability: 0.15,
    yesDrift: 0.001,
    volatility: 0.06,
    closesInDays: 120,
  }),

  // --------------------------------------------------------------- Culture
  binaryMarket({
    key: "culture-box-office-2b",
    category: "culture",
    question: "Will this year's highest-grossing film cross $2B worldwide?",
    resolutionCriteria: "Resolves Yes if any film released this year crosses $2B in worldwide box office gross.",
    resolutionSource: "industry box-office tracking service",
    yesProbability: 0.44,
    yesDrift: 0.002,
    volatility: 0.06,
    closesInDays: 200,
  }),
  binaryMarket({
    key: "culture-streaming-drama-award",
    category: "culture",
    question: "Will a streaming series win Best Drama at this year's top TV awards?",
    resolutionCriteria: "Resolves Yes if a series originally released on a streaming platform wins Best Drama.",
    resolutionSource: "official awards broadcast results",
    yesProbability: 0.35,
    yesDrift: 0,
    volatility: 0.05,
    closesInDays: 60,
  }),
  {
    key: "culture-top-studio",
    category: "culture",
    variant: "multi",
    question: "Which studio releases the highest-grossing film of the year?",
    resolutionCriteria: "Resolves to whichever studio distributed the year's highest-grossing worldwide release.",
    resolutionSource: "industry box-office tracking service",
    outcomes: [
      { key: "studio-a", label: "Studio A", color: OUTCOME_COLOR_CYCLE[0]! },
      { key: "studio-b", label: "Studio B", color: OUTCOME_COLOR_CYCLE[1]! },
      { key: "studio-c", label: "Studio C", color: OUTCOME_COLOR_CYCLE[2]! },
      { key: "other", label: "Other", color: OUTCOME_COLOR_CYCLE[3]! },
    ],
    startProbabilities: { "studio-a": 0.34, "studio-b": 0.29, "studio-c": 0.22, other: 0.15 },
    driftPerOutcome: { "studio-a": 0.001, "studio-b": -0.0005, "studio-c": -0.0005, other: 0 },
    volatility: 0.04,
    closesInDays: 200,
  },

  // ------------------------------------------------------------- Economics
  binaryMarket({
    key: "econ-fed-cut",
    category: "economics",
    question: "Will the Fed cut rates at its next meeting?",
    resolutionCriteria: "Resolves Yes if the Federal Reserve lowers the target federal funds rate at its next FOMC meeting.",
    resolutionSource: "FOMC official statement",
    yesProbability: 0.71,
    yesDrift: -0.002,
    volatility: 0.06,
    closesInDays: 30,
  }),
  binaryMarket({
    key: "econ-cpi-below-2-5",
    category: "economics",
    question: "Will US CPI year-over-year fall below 2.5% this year?",
    resolutionCriteria: "Resolves Yes if any monthly CPI YoY print this year comes in below 2.5%.",
    resolutionSource: "Bureau of Labor Statistics release",
    yesProbability: 0.4,
    yesDrift: 0.002,
    volatility: 0.05,
    closesInDays: 150,
  }),
  binaryMarket({
    key: "econ-yield-curve-inverted",
    category: "economics",
    question: "Will the yield curve stay inverted through year-end?",
    resolutionCriteria: "Resolves Yes if the 10y-2y Treasury spread remains negative through December 31.",
    resolutionSource: "Treasury daily yield curve rates",
    yesProbability: 0.3,
    yesDrift: -0.001,
    volatility: 0.05,
    closesInDays: 100,
  }),

  // --------------------------------------------------------------- Climate
  binaryMarket({
    key: "climate-hottest-5",
    category: "climate",
    question: "Will this year rank among the 5 hottest on record?",
    resolutionCriteria: "Resolves Yes if this year lands in the top 5 warmest years in the official global record.",
    resolutionSource: "national/international climate monitoring agency",
    yesProbability: 0.83,
    yesDrift: 0.001,
    volatility: 0.03,
    closesInDays: 250,
  }),
  binaryMarket({
    key: "climate-cat5-landfall",
    category: "climate",
    question: "Will a Category 5 hurricane make US landfall this year?",
    resolutionCriteria: "Resolves Yes if a storm makes US landfall at Category 5 intensity this year.",
    resolutionSource: "national weather/hurricane monitoring agency",
    yesProbability: 0.18,
    yesDrift: 0.002,
    volatility: 0.06,
    closesInDays: 180,
  }),
  binaryMarket({
    key: "climate-emissions-decline",
    category: "climate",
    question: "Will global CO2 emissions decline year-over-year?",
    resolutionCriteria: "Resolves Yes if the year's global CO2 emissions estimate is below the prior year's.",
    resolutionSource: "international energy/climate agency annual report",
    yesProbability: 0.31,
    yesDrift: 0,
    volatility: 0.04,
    closesInDays: 300,
  }),

  // ------------------------------------------------------------------ Tech
  binaryMarket({
    key: "tech-ai-benchmark",
    category: "tech",
    question: "Will a major AI lab release a model that tops today's best benchmark this year?",
    resolutionCriteria: "Resolves Yes if a newly released model sets a new state-of-the-art on a major public benchmark.",
    resolutionSource: "public benchmark leaderboard",
    yesProbability: 0.76,
    yesDrift: 0.002,
    volatility: 0.05,
    closesInDays: 90,
  }),
  binaryMarket({
    key: "tech-robotaxi-10-cities",
    category: "tech",
    question: "Will a robotaxi service operate in 10+ US cities by year-end?",
    resolutionCriteria: "Resolves Yes if any single operator runs public robotaxi service in 10 or more US cities.",
    resolutionSource: "operator public service maps / press releases",
    yesProbability: 0.24,
    yesDrift: 0.002,
    volatility: 0.06,
    closesInDays: 200,
  }),
  {
    key: "tech-fusion-first",
    category: "tech",
    variant: "multi",
    question: "Which company powers the first commercial fusion plant?",
    resolutionCriteria: "Resolves to whichever company's reactor design is first connected to the grid commercially.",
    resolutionSource: "public regulatory filings and press releases",
    outcomes: [
      { key: "company-a", label: "Company A", color: OUTCOME_COLOR_CYCLE[0]! },
      { key: "company-b", label: "Company B", color: OUTCOME_COLOR_CYCLE[1]! },
      { key: "company-c", label: "Company C", color: OUTCOME_COLOR_CYCLE[2]! },
      { key: "none-by-2030", label: "None by 2030", color: OUTCOME_COLOR_CYCLE[3]! },
    ],
    startProbabilities: { "company-a": 0.28, "company-b": 0.24, "company-c": 0.18, "none-by-2030": 0.3 },
    driftPerOutcome: { "company-a": 0.0005, "company-b": 0, "company-c": -0.0005, "none-by-2030": 0 },
    volatility: 0.03,
    closesInDays: 365,
  },
];
