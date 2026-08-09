import type {
  Friendship,
  FriendRequest,
  FriendRequestId,
  FriendRequestStatus,
  UserId,
} from "@/domain/entities";
import type { FriendRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

/** Orders a pair lexicographically and returns the `${a}:${b}` storage key,
 * matching the "one row per pair, `userAId < userBId`" contract. */
function pairKey(a: UserId, b: UserId): { key: string; userAId: UserId; userBId: UserId } {
  const [userAId, userBId] = a < b ? [a, b] : [b, a];
  return { key: `${userAId}:${userBId}`, userAId, userBId };
}

export class MemoryFriendRepo implements FriendRepo {
  constructor(private readonly tables: Tables) {}

  async areFriends(a: UserId, b: UserId): Promise<boolean> {
    const { key } = pairKey(a, b);
    return this.tables.friendships.has(key);
  }

  async listFriends(userId: UserId): Promise<Friendship[]> {
    const result: Friendship[] = [];
    for (const friendship of this.tables.friendships.values()) {
      if (friendship.userAId === userId || friendship.userBId === userId) {
        result.push(cloneEntity(friendship));
      }
    }
    return result;
  }

  async insertFriendship(friendship: Friendship): Promise<Friendship> {
    const { key, userAId, userBId } = pairKey(
      friendship.userAId,
      friendship.userBId,
    );
    if (this.tables.friendships.has(key)) {
      throw new Error(`Friendship between ${userAId} and ${userBId} already exists`);
    }
    const ordered: Friendship = { userAId, userBId, createdAt: friendship.createdAt };
    this.tables.friendships.set(key, cloneEntity(ordered));
    return cloneEntity(ordered);
  }

  async removeFriendship(a: UserId, b: UserId): Promise<void> {
    const { key } = pairKey(a, b);
    this.tables.friendships.delete(key);
  }

  async createRequest(request: FriendRequest): Promise<FriendRequest> {
    if (this.tables.friendRequests.has(request.id)) {
      throw new Error(`FriendRequest ${request.id} already exists`);
    }
    this.tables.friendRequests.set(request.id, cloneEntity(request));
    return cloneEntity(request);
  }

  async findRequestById(id: FriendRequestId): Promise<FriendRequest | undefined> {
    const found = this.tables.friendRequests.get(id);
    return found ? cloneEntity(found) : undefined;
  }

  async findPendingRequest(
    fromId: UserId,
    toId: UserId,
  ): Promise<FriendRequest | undefined> {
    for (const request of this.tables.friendRequests.values()) {
      if (
        request.fromId === fromId &&
        request.toId === toId &&
        request.status === "pending"
      ) {
        return cloneEntity(request);
      }
    }
    return undefined;
  }

  async listIncomingRequests(
    userId: UserId,
    status?: FriendRequestStatus,
  ): Promise<FriendRequest[]> {
    const result: FriendRequest[] = [];
    for (const request of this.tables.friendRequests.values()) {
      if (request.toId === userId && (!status || request.status === status)) {
        result.push(cloneEntity(request));
      }
    }
    return result;
  }

  async listOutgoingRequests(
    userId: UserId,
    status?: FriendRequestStatus,
  ): Promise<FriendRequest[]> {
    const result: FriendRequest[] = [];
    for (const request of this.tables.friendRequests.values()) {
      if (request.fromId === userId && (!status || request.status === status)) {
        result.push(cloneEntity(request));
      }
    }
    return result;
  }

  async updateRequestStatus(
    id: FriendRequestId,
    status: FriendRequestStatus,
  ): Promise<FriendRequest> {
    const existing = this.tables.friendRequests.get(id);
    if (!existing) {
      throw new Error(`FriendRequest ${id} not found`);
    }
    const updated: FriendRequest = { ...existing, status };
    this.tables.friendRequests.set(id, cloneEntity(updated));
    return cloneEntity(updated);
  }
}
