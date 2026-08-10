import type { Notification, NotificationId, UserId } from "@/domain/entities";
import type { NotificationRepo } from "@/ports/data-store";
import { cloneEntity, type Tables } from "./tables";

export class MemoryNotificationRepo implements NotificationRepo {
  constructor(private readonly tables: Tables) {}

  async findById(id: NotificationId): Promise<Notification | undefined> {
    const found = this.tables.notifications.get(id);
    return found ? cloneEntity(found) : undefined;
  }

  async listByUser(
    userId: UserId,
    options?: { unreadOnly?: boolean },
  ): Promise<Notification[]> {
    const result: Notification[] = [];
    for (const notification of this.tables.notifications.values()) {
      if (notification.userId !== userId) continue;
      if (options?.unreadOnly && notification.readAt !== undefined) continue;
      result.push(notification);
    }
    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return result.map(cloneEntity);
  }

  async insert(notification: Notification): Promise<Notification> {
    if (this.tables.notifications.has(notification.id)) {
      throw new Error(`Notification ${notification.id} already exists`);
    }
    this.tables.notifications.set(notification.id, cloneEntity(notification));
    return cloneEntity(notification);
  }

  async markRead(id: NotificationId): Promise<Notification> {
    const existing = this.tables.notifications.get(id);
    if (!existing) {
      throw new Error(`Notification ${id} not found`);
    }
    const updated: Notification = { ...existing, readAt: new Date() };
    this.tables.notifications.set(id, cloneEntity(updated));
    return cloneEntity(updated);
  }

  async markAllRead(userId: UserId): Promise<void> {
    const now = new Date();
    for (const [id, notification] of this.tables.notifications) {
      if (notification.userId === userId && notification.readAt === undefined) {
        this.tables.notifications.set(id, cloneEntity({ ...notification, readAt: now }));
      }
    }
  }
}
