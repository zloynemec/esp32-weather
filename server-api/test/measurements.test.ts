import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

const fixedTime = new Date("2026-08-22T12:34:56.000Z");
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("measurements API", () => {
  it("stores a valid measurement with a server timestamp", async () => {
    app = buildApp({ databasePath: ":memory:", now: () => fixedTime });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/measurements",
      payload: {
        device_id: "esp32-test-01",
        temperature: 23.7,
        humidity: 56.2,
        uptime: 120,
        wifi_rssi: -61,
      },
    });

    assert.equal(createResponse.statusCode, 201);
    assert.deepEqual(createResponse.json(), {
      measurement: {
        id: 1,
        device_id: "esp32-test-01",
        timestamp: fixedTime.toISOString(),
        temperature: 23.7,
        humidity: 56.2,
        uptime: 120,
        wifi_rssi: -61,
      },
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/measurements?device_id=esp32-test-01&limit=10",
    });

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().measurements.length, 1);
    assert.equal(listResponse.json().measurements[0].device_id, "esp32-test-01");
  });

  it("rejects invalid measurements without storing them", async () => {
    app = buildApp({ databasePath: ":memory:" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/measurements",
      payload: {
        device_id: "esp32-test-01",
        temperature: 20,
        humidity: 101,
      },
    });

    assert.equal(response.statusCode, 400);

    const listResponse = await app.inject({ method: "GET", url: "/api/v1/measurements" });
    assert.deepEqual(listResponse.json(), { measurements: [] });
  });

  it("rejects unexpected fields and invalid query limits", async () => {
    app = buildApp({ databasePath: ":memory:" });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/measurements",
      payload: {
        device_id: "esp32-test-01",
        temperature: 20,
        humidity: 40,
        telegram_chat_id: "not-allowed",
      },
    });
    assert.equal(createResponse.statusCode, 400);

    const listResponse = await app.inject({ method: "GET", url: "/api/v1/measurements?limit=1001" });
    assert.equal(listResponse.statusCode, 400);
  });
});

describe("API documentation", () => {
  it("serves Scalar and an OpenAPI document", async () => {
    app = buildApp({ databasePath: ":memory:" });

    const redirectResponse = await app.inject({ method: "GET", url: "/docs" });
    assert.equal(redirectResponse.statusCode, 301);
    assert.equal(redirectResponse.headers.location, "/docs/");

    const docsResponse = await app.inject({ method: "GET", url: "/docs/" });
    assert.equal(docsResponse.statusCode, 200);
    assert.match(docsResponse.headers["content-type"] ?? "", /^text\/html/);
    assert.match(docsResponse.body, /ESP32 Weather API/);

    const specificationResponse = await app.inject({ method: "GET", url: "/openapi.json" });
    assert.equal(specificationResponse.statusCode, 200);

    const specification = specificationResponse.json();
    assert.equal(specification.openapi, "3.0.3");
    assert.equal(specification.info.title, "ESP32 Weather API");
    assert.ok(specification.paths["/api/v1/measurements"].post);
    assert.ok(specification.paths["/api/v1/measurements"].get);
    assert.ok(specification.paths["/api/v1/measurements/chart"].get);
    assert.ok(specification.paths["/api/v1/devices"].get);
    assert.ok(specification.paths["/api/v1/devices/{device_id}"].get);
    assert.ok(specification.paths["/api/v1/devices/{device_id}"].patch);
    assert.ok(specification.paths["/api/v1/notifications/pending"].get);
    assert.ok(specification.paths["/api/v1/notifications/{notification_id}/delivered"].post);
    assert.equal(specification.paths["/openapi.json"], undefined);
  });
});
