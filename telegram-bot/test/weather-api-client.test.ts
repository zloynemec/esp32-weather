import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WeatherApiClient } from "../src/weather-api-client.js";

describe("WeatherApiClient", () => {
  it("requests and validates the latest measurement", async () => {
    const urls: string[] = [];
    const client = new WeatherApiClient("http://weather.test", async (input) => {
      urls.push(String(input));
      return Response.json({
        measurements: [
          {
            id: 4,
            device_id: "esp32-test-01",
            measured_at: "2026-08-22T12:34:00.000Z",
            timestamp: "2026-08-22T12:34:56.000Z",
            temperature: 23.7,
            humidity: 56.2,
            uptime: null,
            wifi_rssi: -61,
          },
        ],
      });
    });

    const result = await client.getLatestMeasurement("esp32-test-01");

    assert.equal(result?.id, 4);
    assert.equal(
      urls[0],
      "http://weather.test/api/v1/measurements?device_id=esp32-test-01&limit=1",
    );
  });

  it("rejects malformed Server API data", async () => {
    const client = new WeatherApiClient(
      "http://weather.test",
      async () => Response.json({ devices: [{ device_id: "incomplete" }] }),
    );

    await assert.rejects(client.listDevices(), /invalid devices response/);
  });

  it("reads and acknowledges pending notification events", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const event = {
      id: 7,
      device_id: "esp32-test-01",
      device_description: null,
      measurement_id: 12,
      measurement_timestamp: "2026-08-22T12:01:00.000Z",
      current_temperature: 21,
      previous_temperature: 20,
      temperature_delta: 1,
      current_humidity: 40,
      previous_humidity: 40,
      humidity_delta: 0,
      temperature_triggered: true,
      humidity_triggered: false,
      created_at: "2026-08-22T12:01:00.000Z",
      delivered_at: null,
    };
    const client = new WeatherApiClient("http://weather.test", async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return Response.json(
        init?.method === "POST" ? { notification: { ...event, delivered_at: event.created_at } } : { notifications: [event] },
      );
    });

    assert.equal((await client.listPendingNotifications())[0]?.id, 7);
    await client.markNotificationDelivered(7);
    assert.deepEqual(requests, [
      { url: "http://weather.test/api/v1/notifications/pending?limit=20", method: "GET" },
      { url: "http://weather.test/api/v1/notifications/7/delivered", method: "POST" },
    ]);
  });

  it("reads a validated aligned chart series", async () => {
    const client = new WeatherApiClient("http://weather.test", async () =>
      Response.json({
        chart: {
          device_id: "esp32-test-01",
          range: "week",
          from: "2026-08-15T12:00:00.000Z",
          to: "2026-08-22T12:00:00.000Z",
          bucket_seconds: 3600,
          points: [
            {
              timestamp: "2026-08-22T11:00:00.000Z",
              temperature: 21,
              humidity: null,
            },
          ],
        },
      }),
    );

    const result = await client.getMeasurementChart("esp32-test-01", "week");
    assert.equal(result.range, "week");
    assert.equal(result.points[0]?.humidity, null);
  });
});
