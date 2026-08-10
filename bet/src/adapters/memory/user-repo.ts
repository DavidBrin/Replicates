import type { User, UserId } from "@/domain/entities";
import type { UserRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

export class MemoryUserRepo implements UserRepo {
  constructor(private readonly tables: Tables) {}

  async findById(id: UserId): Promise<User | undefined> {
    const found = this.tables.users.get(id);
    return found ? cloneEntity(found) : undefined;
  }

  async findByHandle(handle: string): Promise<User | undefined> {
    const needle = handle.toLowerCase();
    for (const user of this.tables.users.values()) {
      if (user.handle.toLowerCase() === needle) return cloneEntity(user);
    }
    return undefined;
  }

  async searchByHandlePrefix(prefix: string, limit: number): Promise<User[]> {
    const needle = prefix.toLowerCase();
    const matches: User[] = [];
    for (const user of this.tables.users.values()) {
      if (user.handle.toLowerCase().startsWith(needle)) {
        matches.push(user);
      }
    }
    matches.sort((a, b) => a.handle.localeCompare(b.handle));
    return matches.slice(0, limit).map(cloneEntity);
  }

  async list(): Promise<User[]> {
    return Array.from(this.tables.users.values()).map(cloneEntity);
  }

  async insert(user: User): Promise<User> {
    if (this.tables.users.has(user.id)) {
      throw new Error(`User ${user.id} already exists`);
    }
    this.tables.users.set(user.id, cloneEntity(user));
    return cloneEntity(user);
  }

  async update(id: UserId, patch: Partial<Omit<User, "id">>): Promise<User> {
    const existing = this.tables.users.get(id);
    if (!existing) {
      throw new Error(`User ${id} not found`);
    }
    const updated: User = { ...existing, ...patch, id };
    this.tables.users.set(id, cloneEntity(updated));
    return cloneEntity(updated);
  }
}
