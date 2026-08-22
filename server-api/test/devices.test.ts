import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("devices API", () => {
  it("registers a device with default notification thresholds on its first measurement", async () => {
    const acceptedAt = new Date("2026-08-22T12:34:56.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => acceptedAt });

    const measurementResponse = await app.inject({
      method: "POST",
      url: "/api/v1/measurements",
      payload: {
        device_id: "esp32-wokwi-01",
        temperature: 23.7,
        humidity: 56.2,
      },
    });
    assert.equal(measurementResponse.statusCode, 201);

    const deviceResponse = await app.inject({
      method: "GET",
      url: "/api/v1/devices/esp32-wokwi-01",
    });

    assert.equal(deviceResponse.statusCode, 200);
    assert.deepEqual(deviceResponse.json(), {
      device: {
        device_id: "esp32-wokwi-01",
        description: null,
        temperature_delta_threshold: 1,
        humidity_delta_threshold: 5,
        notification_cooldown_seconds: 600,
        created_at: acceptedAt.toISOString(),
        updated_at: acceptedAt.toISOString(),
        last_seen_at: acceptedAt.toISOString(),
      },
    });
  });

  it("updates description and absolute delta thresholds", async () => {
    let currentTime = new Date("2026-08-22T12:00:00.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => currentTime });

    await app.inject({
      method: "POST",
      url: "/api/v1/measurements",
      payload: {
        device_id: "esp32-wokwi-01",
        temperature: 20,
        humidity: 40,
      },
    });

    currentTime = new Date("2026-08-22T12:05:00.000Z");
    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/devices/esp32-wokwi-01",
      payload: {
        description: "Wokwi sensor in the study room",
        temperature_delta_threshold: 0.8,
        humidity_delta_threshold: 4,
        notification_cooldown_seconds: 300,
      },
    });

    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json().device.description, "Wokwi sensor in the study room");
    assert.equal(updateResponse.json().device.temperature_delta_threshold, 0.8);
    assert.equal(updateResponse.json().device.humidity_delta_threshold, 4);
    assert.equal(updateResponse.json().device.notification_cooldown_seconds, 300);
    assert.equal(updateResponse.json().device.updated_at, currentTime.toISOString());
  });

  it("lists devices and updates last_seen_at without replacing their settings", async () => {
    let currentTime = new Date("2026-08-22T12:00:00.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => currentTime });

    await app.inject({
      method: "POST",
      url: "/api/v1/measurements",
      payload: { device_id: "device-b", temperature: 20, humidity: 40 },
    });
    await app.inject({
      method: "PATCH",
      url: "/api/v1/devices/device-b",
      payload: { description: "Second device", temperature_delta_threshold: 2 },
    });

    currentTime = new Date("2026-08-22T12:01:00.000Z");
    await app.inject({
      method: "POST",
      url: "/api/v1/measurements",
      payload: { device_id: "device-b", temperature: 21, humidity: 41 },
    });

    const listResponse = await app.inject({ method: "GET", url: "/api/v1/devices" });
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().devices.length, 1);
    assert.equal(listResponse.json().devices[0].description, "Second device");
    assert.equal(listResponse.json().devices[0].temperature_delta_threshold, 2);
    assert.equal(listResponse.json().devices[0].last_seen_at, currentTime.toISOString());
  });

  it("validates updates and returns 404 for an unknown device", async () => {
    app = buildApp({ databasePath: ":memory:" });

    const emptyResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/devices/unknown-device",
      payload: {},
    });
    assert.equal(emptyResponse.statusCode, 400);

    const invalidThresholdResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/devices/unknown-device",
      payload: { temperature_delta_threshold: 0 },
    });
    assert.equal(invalidThresholdResponse.statusCode, 400);

    const invalidCooldownResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/devices/unknown-device",
      payload: { notification_cooldown_seconds: -1 },
    });
    assert.equal(invalidCooldownResponse.statusCode, 400);

    const notFoundResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/devices/unknown-device",
      payload: { description: "Unknown" },
    });
    assert.equal(notFoundResponse.statusCode, 404);
  });
});
