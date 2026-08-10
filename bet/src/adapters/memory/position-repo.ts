import type { MarketId, OutcomeId, Position, PositionId, UserId } from "@/domain/entities";
import type { PositionRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

export class MemoryPositionRepo implements PositionRepo {
  constructor(private readonly tables: Tables) {}

  async findById(id: PositionId): Promise<Position | undefined> {
    const found = this.tables.positions.get(id);
    return found ? cloneEntity(found) : undefined;
  }

  async find(
    marketId: MarketId,
    outcomeId: OutcomeId,
    userId: UserId,
  ): Promise<Position | undefined> {
    for (const position of this.tables.positions.values()) {
      if (
        position.marketId === marketId &&
        position.outcomeId === outcomeId &&
        position.userId === userId
      ) {
        return cloneEntity(position);
      }
    }
    return undefined;
  }

  async listByMarket(marketId: MarketId): Promise<Position[]> {
    const result: Position[] = [];
    for (const position of this.tables.positions.values()) {
      if (position.marketId === marketId) result.push(cloneEntity(position));
    }
    return result;
  }

  async listByUser(userId: UserId): Promise<Position[]> {
    const result: Position[] = [];
    for (const position of this.tables.positions.values()) {
      if (position.userId === userId) result.push(cloneEntity(position));
    }
    return result;
  }

  async insert(position: Position): Promise<Position> {
    if (this.tables.positions.has(position.id)) {
      throw new Error(`Position ${position.id} already exists`);
    }
    this.tables.positions.set(position.id, cloneEntity(position));
    return cloneEntity(position);
  }

  async update(
    id: PositionId,
    patch: Partial<Omit<Position, "id">>,
  ): Promise<Position> {
    const existing = this.tables.positions.get(id);
    if (!existing) {
      throw new Error(`Position ${id} not found`);
    }
    const updated: Position = { ...existing, ...patch, id };
    this.tables.positions.set(id, cloneEntity(updated));
    return cloneEntity(updated);
  }
}
