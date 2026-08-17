/**
 * The recommender's domain surface.
 *
 * Everything exported here is pure: the graph's constants, the score, the
 * candidate-combining rules and the ordering. The SQL that maintains the graph
 * and the SQL that reads it live in `adapters/repositories/watch-events.ts` and
 * `adapters/repositories/recommendations.ts`, and both import from here rather
 * than restating a threshold or a cap in a query string.
 *
 * That direction is the point of the split. Four surfaces — watch-next,
 * home, autoplay, Shorts — differ in what they seed from and what they filter,
 * and agree on how a candidate is scored, how paths to it collapse, how one
 * channel is capped and how a thin result is backfilled. Keeping the agreement
 * in one module is what stops the four from becoming four near-identical
 * queries that drift apart one bug fix at a time.
 */

export {
  SESSION_VIDEO_CAP,
  MIN_COVISIT_WEIGHT,
  TOP_K_STORED,
  TOP_K_SERVED,
  MAX_HOPS,
  HOP_FANOUT,
  HOME_SEED_LIMIT,
  SHORTS_SEED_LIMIT,
  HOME_FEED_SIZE,
  SIDEBAR_SIZE,
  SHORTS_FEED_SIZE,
  HOME_CHANNEL_CAP,
  SIDEBAR_CHANNEL_CAP,
  SHORTS_CHANNEL_CAP,
  admitToSession,
  relatedness,
  clearsCoVisitFloor,
  bestPerCandidate,
  aggregateAcrossSeeds,
  compareByScore,
  compareByAutoplayPriority,
  capPerChannel,
  backfill,
  pickAutoplay,
} from "./covisitation";

export type {
  Viewer,
  SessionAdmission,
  HopCandidate,
  AggregatedCandidate,
} from "./covisitation";
