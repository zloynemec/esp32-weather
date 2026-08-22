import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatChangeNotification } from "../src/format.js";
import { NotificationDispatcher } from "../src/notification-dispatcher.js";
import type { BotLogger, NotificationEvent } from "../src/types.js";

const notification: NotificationEvent = {
  id: 7,
  device_id: "esp32-test-01",
  device_description: "Рабочий кабинет",
  measurement_id: 12,
  measurement_timestamp: "2026-08-22T12:01:00.000Z",
  current_temperature: 21.2,
  previous_temperature: 20,
  temperature_delta: 1.2,
  current_humidity: 46,
  previous_humidity: 40,
  humidity_delta: 6,
  temperature_triggered: true,
  humidity_triggered: true,
  created_at: "2026-08-22T12:01:00.000Z",
  delivered_at: null,
};

const logger: BotLogger = {
  info: () => undefined,
  error: () => undefined,
};

describe("change notification delivery", () => {
  it("formats current, previous and delta values for both metrics", () => {
    const text = formatChangeNotification(notification, "UTC");

    assert.match(text, /Рабочий кабинет/);
    assert.match(text, /Температура.*21,2 °C/);
    assert.match(text, /Было: 20,0 °C.*\+1,2 °C/);
    assert.match(text, /Влажность.*46,0 %/);
    assert.match(text, /Было: 40,0 %.*\+6,0 п\.п\./);
  });

  it("acknowledges an event only after Telegram accepts the message", async () => {
    const sent: string[] = [];
    const acknowledged: number[] = [];
    const dispatcher = new NotificationDispatcher(
      { sendMessage: async (_chatId, text) => sent.push(text) },
      {
        listPendingNotifications: async () => [notification],
        markNotificationDelivered: async (id) => {
          acknowledged.push(id);
        },
      },
      "-100123",
      "UTC",
      logger,
    );

    assert.equal(await dispatcher.runOnce(), 1);
    assert.equal(sent.length, 1);
    assert.deepEqual(acknowledged, [7]);
  });

  it("leaves an event pending when Telegram delivery fails", async () => {
    const acknowledged: number[] = [];
    const dispatcher = new NotificationDispatcher(
      {
        sendMessage: async () => {
          throw new Error("Telegram unavailable");
        },
      },
      {
        listPendingNotifications: async () => [notification],
        markNotificationDelivered: async (id) => {
          acknowledged.push(id);
        },
      },
      "-100123",
      "UTC",
      logger,
    );

    await assert.rejects(dispatcher.runOnce(), /Telegram unavailable/);
    assert.deepEqual(acknowledged, []);
  });
});
