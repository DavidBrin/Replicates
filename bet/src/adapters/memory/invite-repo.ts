import type { Invite, InviteId, UserId } from "@/domain/entities";
import type { InviteRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

export class MemoryInviteRepo implements InviteRepo {
  constructor(private readonly tables: Tables) {}

  async findById(id: InviteId): Promise<Invite | undefined> {
    const found = this.tables.invites.get(id);
    return found ? cloneEntity(found) : undefined;
  }

  async findByTokenHash(tokenHash: string): Promise<Invite | undefined> {
    for (const invite of this.tables.invites.values()) {
      if (invite.tokenHash === tokenHash) return cloneEntity(invite);
    }
    return undefined;
  }

  async listByInvitee(userId: UserId): Promise<Invite[]> {
    const result: Invite[] = [];
    for (const invite of this.tables.invites.values()) {
      if (invite.inviteeId === userId) result.push(cloneEntity(invite));
    }
    return result;
  }

  async listByInviter(userId: UserId): Promise<Invite[]> {
    const result: Invite[] = [];
    for (const invite of this.tables.invites.values()) {
      if (invite.inviterId === userId) result.push(cloneEntity(invite));
    }
    return result;
  }

  async insert(invite: Invite): Promise<Invite> {
    if (this.tables.invites.has(invite.id)) {
      throw new Error(`Invite ${invite.id} already exists`);
    }
    this.tables.invites.set(invite.id, cloneEntity(invite));
    return cloneEntity(invite);
  }

  async update(
    id: InviteId,
    patch: Partial<Omit<Invite, "id">>,
  ): Promise<Invite> {
    const existing = this.tables.invites.get(id);
    if (!existing) {
      throw new Error(`Invite ${id} not found`);
    }
    const updated: Invite = { ...existing, ...patch, id };
    this.tables.invites.set(id, cloneEntity(updated));
    return cloneEntity(updated);
  }
}
