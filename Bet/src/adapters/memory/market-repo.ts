import type { GroupId, Market, MarketId, UserId } from "@/domain/entities";
import type { MarketRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

export class MemoryMarketRepo implements MarketRepo {
  constructor(private readonly tables: Tables) {}

  async findById(id: MarketId): Promise<Market | undefined> {
    const found = this.tables.markets.get(id);
    return found ? cloneEntity(found) : undefined;
  }

  async listByGroup(groupId: GroupId): Promise<Market[]> {
    const result: Market[] = [];
    for (const market of this.tables.markets.values()) {
      if (market.groupId === groupId) result.push(cloneEntity(market));
    }
    return result;
  }

  async listByCreator(userId: UserId): Promise<Market[]> {
    const result: Market[] = [];
    for (const market of this.tables.markets.values()) {
      if (market.creatorId === userId) result.push(cloneEntity(market));
    }
    return result;
  }

  async listPublic(): Promise<Market[]> {
    const result: Market[] = [];
    for (const market of this.tables.markets.values()) {
      if (market.visibility === "public") result.push(cloneEntity(market));
    }
    return result;
  }

  async insert(market: Market): Promise<Market> {
    if (this.tables.markets.has(market.id)) {
      throw new Error(`Market ${market.id} already exists`);
    }
    this.tables.markets.set(market.id, cloneEntity(market));
    return cloneEntity(market);
  }

  async update(
    id: MarketId,
    patch: Partial<Omit<Market, "id">>,
  ): Promise<Market> {
    const existing = this.tables.markets.get(id);
    if (!existing) {
      throw new Error(`Market ${id} not found`);
    }
    const updated: Market = { ...existing, ...patch, id };
    this.tables.markets.set(id, cloneEntity(updated));
    return cloneEntity(updated);
  }
}
