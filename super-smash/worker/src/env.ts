import type { RoomDO } from "./roomDO";

/** Bindings from wrangler.jsonc, plus the two secrets David sets with `wrangler secret put`. */
export interface Env {
  readonly ROOMS: DurableObjectNamespace<RoomDO>;
  readonly ASSETS: Fetcher;
  readonly TURN_KEY_ID?: string;
  readonly TURN_KEY_API_TOKEN?: string;
}
