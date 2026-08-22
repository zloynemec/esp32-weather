import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WeatherBot } from "../src/bot.js";
import type { BotLogger, Device, Measurement, TelegramUpdate } from "../src/types.js";

const device: Device = {
  device_id: "esp32-wokwi-01",
  description: "Рабочий кабинет",
  temperature_delta_threshold: 1,
  humidity_delta_threshold: 5,
  notification_cooldown_seconds: 600,
  created_at: "2026-08-22T10:00:00.000Z",
  updated_at: "2026-08-22T10:00:00.000Z",
  last_seen_at: "2026-08-22T12:34:56.000Z",
};

const measurement: Measurement = {
  id: 1,
  device_id: device.device_id,
  timestamp: "2026-08-22T12:34:56.000Z",
  temperature: 23.7,
  humidity: 56.2,
  uptime: 120,
  wifi_rssi: -61,
};

const logger: BotLogger = {
  info: () => undefined,
  error: () => undefined,
};

function commandUpdate(text: string, chatId = -100123): TelegramUpdate {
  return {
    update_id: 1,
    message: { message_id: 1, chat: { id: chatId }, text },
  };
}

describe("WeatherBot", () => {
  it("returns the latest measurement for the only registered device", async () => {
    const sent: string[] = [];
    const bot = new WeatherBot(
      { sendMessage: async (_chatId, text) => sent.push(text) },
      {
        listDevices: async () => [device],
        getLatestMeasurement: async () => measurement,
      },
      { chatId: "-100123", timeZone: "UTC" },
      logger,
    );

    await bot.handleUpdate(commandUpdate("/weather"));

    assert.equal(sent.length, 1);
    assert.match(sent[0] ?? "", /Рабочий кабинет/);
    assert.match(sent[0] ?? "", /23,7 °C/);
    assert.match(sent[0] ?? "", /56,2 %/);
  });

  it("ignores messages from chats that are not configured", async () => {
    const sent: string[] = [];
    const bot = new WeatherBot(
      { sendMessage: async (_chatId, text) => sent.push(text) },
      {
        listDevices: async () => [device],
        getLatestMeasurement: async () => measurement,
      },
      { chatId: "-100123", timeZone: "UTC" },
      logger,
    );

    await bot.handleUpdate(commandUpdate("/weather", -999));

    assert.deepEqual(sent, []);
  });

  it("asks for a device when several devices exist and no default is configured", async () => {
    const sent: string[] = [];
    const secondDevice = { ...device, device_id: "esp32-bedroom-01" };
    const bot = new WeatherBot(
      { sendMessage: async (_chatId, text) => sent.push(text) },
      {
        listDevices: async () => [device, secondDevice],
        getLatestMeasurement: async () => {
          throw new Error("must not be called");
        },
      },
      { chatId: "-100123", timeZone: "UTC" },
      logger,
    );

    await bot.handleUpdate(commandUpdate("/weather"));

    assert.match(sent[0] ?? "", /Укажите датчик/);
    assert.match(sent[0] ?? "", /esp32-wokwi-01/);
    assert.match(sent[0] ?? "", /esp32-bedroom-01/);
  });
});
