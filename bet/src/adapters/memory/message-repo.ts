import type { Message, RoomId, UserId } from "@/domain/entities";
import type { MessagePageOptions, MessageRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

/** Newest-first ordering key: by `at` descending, `id` descending as a
 * tie-break so same-millisecond messages still sort deterministically. */
function compareNewestFirst(a: Message, b: Message): number {
  const byTime = b.at.getTime() - a.at.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** True if `m` is strictly older (in newest-first order) than `cursor`. */
function isOlderThanCursor(
  m: Message,
  cursor: { at: Date; id: string },
): boolean {
  const mTime = m.at.getTime();
  const cTime = cursor.at.getTime();
  if (mTime !== cTime) return mTime < cTime;
  return m.id < cursor.id;
}

export class MemoryMessageRepo implements MessageRepo {
  constructor(private readonly tables: Tables) {}

  async listMessages(
    roomId: RoomId,
    options: MessagePageOptions,
  ): Promise<Message[]> {
    const candidates: Message[] = [];
    for (const message of this.tables.messages.values()) {
      if (message.roomId !== roomId) continue;
      if (options.before && !isOlderThanCursor(message, options.before)) continue;
      candidates.push(message);
    }
    candidates.sort(compareNewestFirst);
    return candidates.slice(0, options.limit).map(cloneEntity);
  }

  async findByClientId(
    roomId: RoomId,
    authorId: UserId | null,
    clientId: string,
  ): Promise<Message | undefined> {
    for (const message of this.tables.messages.values()) {
      if (
        message.roomId === roomId &&
        message.authorId === authorId &&
        message.clientId === clientId
      ) {
        return cloneEntity(message);
      }
    }
    return undefined;
  }

  async insert(message: Message): Promise<Message> {
    if (message.clientId !== undefined) {
      const existing = await this.findByClientId(
        message.roomId,
        message.authorId,
        message.clientId,
      );
      if (existing) return existing;
    }
    if (this.tables.messages.has(message.id)) {
      throw new Error(`Message ${message.id} already exists`);
    }
    this.tables.messages.set(message.id, cloneEntity(message));
    return cloneEntity(message);
  }
}
