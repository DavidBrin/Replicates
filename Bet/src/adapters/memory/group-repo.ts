import type { Group, GroupId, UserId } from "@/domain/entities";
import type { GroupRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

export class MemoryGroupRepo implements GroupRepo {
  constructor(private readonly tables: Tables) {}

  async findById(id: GroupId): Promise<Group | undefined> {
    const found = this.tables.groups.get(id);
    return found ? cloneEntity(found) : undefined;
  }

  async findBySlug(slug: string): Promise<Group | undefined> {
    for (const group of this.tables.groups.values()) {
      if (group.slug === slug) return cloneEntity(group);
    }
    return undefined;
  }

  async listByMember(userId: UserId): Promise<Group[]> {
    const result: Group[] = [];
    for (const group of this.tables.groups.values()) {
      if (group.memberIds.includes(userId)) result.push(cloneEntity(group));
    }
    return result;
  }

  async insert(group: Group): Promise<Group> {
    if (this.tables.groups.has(group.id)) {
      throw new Error(`Group ${group.id} already exists`);
    }
    this.tables.groups.set(group.id, cloneEntity(group));
    return cloneEntity(group);
  }

  async update(id: GroupId, patch: Partial<Omit<Group, "id">>): Promise<Group> {
    const existing = this.tables.groups.get(id);
    if (!existing) {
      throw new Error(`Group ${id} not found`);
    }
    const updated: Group = { ...existing, ...patch, id };
    this.tables.groups.set(id, cloneEntity(updated));
    return cloneEntity(updated);
  }

  async addMember(id: GroupId, userId: UserId): Promise<Group> {
    const existing = this.tables.groups.get(id);
    if (!existing) {
      throw new Error(`Group ${id} not found`);
    }
    if (existing.memberIds.includes(userId)) {
      return cloneEntity(existing);
    }
    const updated: Group = {
      ...existing,
      memberIds: [...existing.memberIds, userId],
    };
    this.tables.groups.set(id, cloneEntity(updated));
    return cloneEntity(updated);
  }

  async removeMember(id: GroupId, userId: UserId): Promise<Group> {
    const existing = this.tables.groups.get(id);
    if (!existing) {
      throw new Error(`Group ${id} not found`);
    }
    const updated: Group = {
      ...existing,
      memberIds: existing.memberIds.filter((m) => m !== userId),
    };
    this.tables.groups.set(id, cloneEntity(updated));
    return cloneEntity(updated);
  }
}
