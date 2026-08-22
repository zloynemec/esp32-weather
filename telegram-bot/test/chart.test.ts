import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import { WeatherBot } from "../src/bot.js";
import { renderMeasurementChart } from "../src/chart-renderer.js";
import type {
  BotLogger,
  Device,
  MeasurementChart,
  TelegramUpdate,
} from "../src/types.js";

const device: Device = {
  device_id: "esp32-test-01",
  description: "Рабочий кабинет",
  temperature_delta_threshold: 1,
  humidity_delta_threshold: 5,
  notification_cooldown_seconds: 600,
  created_at: "2026-08-22T10:00:00.000Z",
  updated_at: "2026-08-22T10:00:00.000Z",
  last_seen_at: "2026-08-22T12:00:00.000Z",
};

const chart: MeasurementChart = {
  device_id: device.device_id,
  range: "day",
  from: "2026-08-21T12:00:00.000Z",
  to: "2026-08-22T12:00:00.000Z",
  bucket_seconds: 900,
  points: [
    { timestamp: "2026-08-21T12:00:00.000Z", temperature: 20, humidity: 40 },
    { timestamp: "2026-08-22T00:00:00.000Z", temperature: 22, humidity: 45 },
    { timestamp: "2026-08-22T12:00:00.000Z", temperature: 21, humidity: 43 },
  ],
};

const logger: BotLogger = {
  info: () => undefined,
  error: () => undefined,
};

describe("measurement chart", () => {
  it("renders a 1200x720 PNG containing both series", async () => {
    const png = await renderMeasurementChart(chart, "Рабочий кабинет", "UTC");
    const metadata = await sharp(png).metadata();

    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 1_200);
    assert.equal(metadata.height, 720);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  });

  it("uses the day range by default and sends the generated photo", async () => {
    const photos: Buffer[] = [];
    const requestedRanges: string[] = [];
    const bot = new WeatherBot(
      {
        sendMessage: async () => undefined,
        sendPhoto: async (_chatId, photo) => {
          photos.push(photo);
        },
      },
      {
        listDevices: async () => [device],
        getLatestMeasurement: async () => null,
        getMeasurementChart: async (_deviceId, range) => {
          requestedRanges.push(range);
          return chart;
        },
      },
      { chatId: "-100123", timeZone: "UTC" },
      logger,
    );

    await bot.handleUpdate(commandUpdate("/chart"));

    assert.deepEqual(requestedRanges, ["day"]);
    assert.equal(photos.length, 1);
    assert.equal(photos[0]?.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  });

  it("accepts all supported period arguments", async () => {
    const requestedRanges: string[] = [];
    const bot = new WeatherBot(
      {
        sendMessage: async () => undefined,
        sendPhoto: async () => undefined,
      },
      {
        listDevices: async () => [device],
        getLatestMeasurement: async () => null,
        getMeasurementChart: async (_deviceId, range) => {
          requestedRanges.push(range);
          return { ...chart, range };
        },
      },
      { chatId: "-100123", timeZone: "UTC" },
      logger,
    );

    for (const range of ["hour", "day", "week", "month"]) {
      await bot.handleUpdate(commandUpdate(`/chart ${range}`));
    }

    assert.deepEqual(requestedRanges, ["hour", "day", "week", "month"]);
  });
});

function commandUpdate(text: string): TelegramUpdate {
  return {
    update_id: 1,
    message: { message_id: 1, chat: { id: -100123 }, text },
  };
}
