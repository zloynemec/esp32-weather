import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("measurement chart API", () => {
  it("aggregates temperature and humidity into aligned buckets", async () => {
    let currentTime = new Date("2026-08-22T12:01:00.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => currentTime });

    await postMeasurement(app, 20, 40);
    currentTime = new Date("2026-08-22T12:05:00.000Z");
    await postMeasurement(app, 22, 44);
    currentTime = new Date("2026-08-22T12:16:00.000Z");
    await postMeasurement(app, 24, 48);
    currentTime = new Date("2026-08-22T12:30:00.000Z");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/measurements/chart?device_id=esp32-test-01&range=day",
    });

    assert.equal(response.statusCode, 200);
    const chart = response.json().chart;
    assert.equal(chart.range, "day");
    assert.equal(chart.bucket_seconds, 900);
    assert.deepEqual(chart.points, [
      { timestamp: "2026-08-22T12:00:00.000Z", temperature: 21, humidity: 42 },
      { timestamp: "2026-08-22T12:15:00.000Z", temperature: 24, humidity: 48 },
    ]);
  });

  it("defaults to one day and validates supported ranges", async () => {
    const currentTime = new Date("2026-08-22T12:30:00.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => currentTime });

    const defaultResponse = await app.inject({
      method: "GET",
      url: "/api/v1/measurements/chart?device_id=esp32-test-01",
    });
    assert.equal(defaultResponse.statusCode, 200);
    assert.equal(defaultResponse.json().chart.range, "day");
    assert.equal(defaultResponse.json().chart.points.length, 0);

    const invalidResponse = await app.inject({
      method: "GET",
      url: "/api/v1/measurements/chart?device_id=esp32-test-01&range=year",
    });
    assert.equal(invalidResponse.statusCode, 400);
  });

  it("returns null humidity for temperature-only buckets", async () => {
    let currentTime = new Date("2026-08-22T12:01:00.000Z");
    app = buildApp({ databasePath: ":memory:", now: () => currentTime });
    await app.inject({
      method: "POST",
      url: "/api/v1/measurements",
      payload: { device_id: "esp32-ds18b20-01", temperature: 18.5 },
    });
    currentTime = new Date("2026-08-22T12:30:00.000Z");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/measurements/chart?device_id=esp32-ds18b20-01&range=day",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().chart.points[0].humidity, null);
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
