import { formatChangeNotification } from "./format.js";
import type { BotLogger, NotificationEvent } from "./types.js";

interface NotificationSource {
  listPendingNotifications(limit?: number): Promise<NotificationEvent[]>;
  markNotificationDelivered(notificationId: number): Promise<void>;
}

interface TelegramMessenger {
  sendMessage(chatId: string, text: string): Promise<unknown>;
}

export class NotificationDispatcher {
  constructor(
    private readonly telegram: TelegramMessenger,
    private readonly source: NotificationSource,
    private readonly chatId: string,
    private readonly timeZone: string,
    private readonly logger: BotLogger,
  ) {}

  async runOnce(): Promise<number> {
    const notifications = await this.source.listPendingNotifications();
    for (const notification of notifications) {
      await this.telegram.sendMessage(
        this.chatId,
        formatChangeNotification(notification, this.timeZone),
      );
      await this.source.markNotificationDelivered(notification.id);
      this.logger.info(`Delivered notification ${notification.id} for ${notification.device_id}`);
    }
    return notifications.length;
  }
}
