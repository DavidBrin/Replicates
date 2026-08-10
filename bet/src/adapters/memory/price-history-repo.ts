import type { MarketId, PricePoint } from "@/domain/entities";
import type { PriceHistoryRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

export class MemoryPriceHistoryRepo implements PriceHistoryRepo {
  constructor(private readonly tables: Tables) {}

  async append(point: PricePoint): Promise<PricePoint> {
    const key = point.marketId;
    const existing = this.tables.pricePoints.get(key) ?? [];
    const stored = cloneEntity(point);
    this.tables.pricePoints.set(key, [...existing, stored]);
    return cloneEntity(stored);
  }

  async listByMarket(
    marketId: MarketId,
    options?: { since?: Date },
  ): Promise<PricePoint[]> {
    const points = this.tables.pricePoints.get(marketId) ?? [];
    const filtered = options?.since
      ? points.filter((p) => p.at.getTime() >= options.since!.getTime())
      : points;
    return filtered.map(cloneEntity);
  }
}
