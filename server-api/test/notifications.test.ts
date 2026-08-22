import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("notification events API", () => {
  it("uses the first measurement as baseline and combines simultaneous changes", async () => {
    let currentTime = new Date("2026-08-22T12:00:00.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => currentTime });

    await postMeasurement(app, 20, 40);
    assert.deepEqual(await pendingNotifications(app), []);

    currentTime = new Date("2026-08-22T12:01:00.000Z");
    await postMeasurement(app, 21.2, 46);
    const notifications = await pendingNotifications(app);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].temperature_triggered, true);
    assert.equal(notifications[0].humidity_triggered, true);
    assert.equal(notifications[0].previous_temperature, 20);
    assert.equal(notifications[0].current_temperature, 21.2);
    assert.equal(notifications[0].temperature_delta, 1.1999999999999993);
    assert.equal(notifications[0].previous_humidity, 40);
    assert.equal(notifications[0].humidity_delta, 6);
  });

  it("keeps comparing with the last notification and enforces cooldown", async () => {
    let currentTime = new Date("2026-08-22T12:00:00.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => currentTime });

    await postMeasurement(app, 20, 40);
    currentTime = new Date("2026-08-22T12:01:00.000Z");
    await postMeasurement(app, 21, 40);

    currentTime = new Date("2026-08-22T12:06:00.000Z");
    await postMeasurement(app, 23, 40);
    assert.equal((await pendingNotifications(app)).length, 1);

    currentTime = new Date("2026-08-22T12:11:00.000Z");
    await postMeasurement(app, 22.1, 40);
    const notifications = await pendingNotifications(app);
    assert.equal(notifications.length, 2);
    assert.equal(notifications[1].previous_temperature, 21);
    assert.ok(Math.abs(notifications[1].temperature_delta - 1.1) < 0.000_001);
  });

  it("marks an event as delivered so it leaves the pending queue", async () => {
    let currentTime = new Date("2026-08-22T12:00:00.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => currentTime });
    await postMeasurement(app, 20, 40);
    currentTime = new Date("2026-08-22T12:01:00.000Z");
    await postMeasurement(app, 21, 40);
    const [notification] = await pendingNotifications(app);
    assert.ok(notification);

    currentTime = new Date("2026-08-22T12:02:00.000Z");
    const deliveredResponse = await app.inject({
      method: "POST",
      url: `/api/v1/notifications/${notification.id}/delivered`,
    });
    assert.equal(deliveredResponse.statusCode, 200);
    assert.equal(deliveredResponse.json().notification.delivered_at, currentTime.toISOString());
    assert.deepEqual(await pendingNotifications(app), []);
  });

  it("creates temperature-only events without humidity values", async () => {
    let currentTime = new Date("2026-08-22T12:00:00.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => currentTime });

    await postTemperatureOnlyMeasurement(app, 18.5);
    currentTime = new Date("2026-08-22T12:10:00.000Z");
    await postTemperatureOnlyMeasurement(app, 20);

    const [notification] = await pendingNotifications(app);
    assert.ok(notification);
    assert.equal(notification.temperature_triggered, true);
    assert.equal(notification.humidity_triggered, false);
    assert.equal(notification.current_humidity, null);
    assert.equal(notification.previous_humidity, null);
    assert.equal(notification.humidity_delta, null);
  });
});

async function postMeasurement(
  instance: FastifyInstance,
  temperature: number,
  humidity: number,
): Promise<void> {
  const response = await instance.inject({
    method: "POST",
    url: "/api/v1/measurements",
    payload: { device_id: "esp32-test-01", temperature, humidity },
  });
  assert.equal(response.statusCode, 201);
}

async function postTemperatureOnlyMeasurement(
  instance: FastifyInstance,
  temperature: number,
): Promise<void> {
  const response = await instance.inject({
    method: "POST",
    url: "/api/v1/measurements",
    payload: { device_id: "esp32-ds18b20-01", temperature },
  });
  assert.equal(response.statusCode, 201);
}

async function pendingNotifications(instance: FastifyInstance): Promise<any[]> {
  const response = await instance.inject({
    method: "GET",
    url: "/api/v1/notifications/pending",
  });
  assert.equal(response.statusCode, 200);
  return response.json().notifications;
}
