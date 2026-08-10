import type { MarketId, Trade, TradeId, UserId } from "@/domain/entities";
import type { TradeRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

export class MemoryTradeRepo implements TradeRepo {
  constructor(private readonly tables: Tables) {}

  async findById(id: TradeId): Promise<Trade | undefined> {
    const found = this.tables.trades.get(id);
    return found ? cloneEntity(found) : undefined;
  }

  async listByMarket(marketId: MarketId): Promise<Trade[]> {
    const result: Trade[] = [];
    for (const trade of this.tables.trades.values()) {
      if (trade.marketId === marketId) result.push(cloneEntity(trade));
    }
    return result;
  }

  async listByUser(userId: UserId): Promise<Trade[]> {
    const result: Trade[] = [];
    for (const trade of this.tables.trades.values()) {
      if (trade.userId === userId) result.push(cloneEntity(trade));
    }
    return result;
  }

  async insert(trade: Trade): Promise<Trade> {
    if (this.tables.trades.has(trade.id)) {
      throw new Error(`Trade ${trade.id} already exists`);
    }
    this.tables.trades.set(trade.id, cloneEntity(trade));
    return cloneEntity(trade);
  }
}
