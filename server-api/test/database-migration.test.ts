import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("SQLite migrations", () => {
  it("preserves legacy measurements while making humidity nullable", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "esp32-weather-migration-"));
    const databasePath = join(temporaryDirectory, "weather.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE devices (
        device_id TEXT PRIMARY KEY,
        description TEXT,
        temperature_delta_threshold REAL NOT NULL DEFAULT 1.0,
        humidity_delta_threshold REAL NOT NULL DEFAULT 5.0,
        notification_cooldown_seconds INTEGER NOT NULL DEFAULT 600,
        last_notified_temperature REAL,
        last_notified_humidity REAL,
        last_notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      CREATE TABLE measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        temperature REAL NOT NULL,
        humidity REAL NOT NULL,
        uptime INTEGER,
        wifi_rssi INTEGER
      );
      CREATE TABLE notification_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        device_description TEXT,
        measurement_id INTEGER NOT NULL,
        measurement_timestamp TEXT NOT NULL,
        current_temperature REAL NOT NULL,
        previous_temperature REAL NOT NULL,
        temperature_delta REAL NOT NULL,
        current_humidity REAL NOT NULL,
        previous_humidity REAL NOT NULL,
        humidity_delta REAL NOT NULL,
        temperature_triggered INTEGER NOT NULL,
        humidity_triggered INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        FOREIGN KEY (measurement_id) REFERENCES measurements(id)
      );
      CREATE INDEX idx_notification_events_pending
        ON notification_events (delivered_at, id);
      INSERT INTO measurements (
        device_id, timestamp, temperature, humidity, uptime, wifi_rssi
      ) VALUES (
        'esp32-wokwi-01', '2026-08-22T12:00:00.000Z', 23.7, 56.2, 120, -61
      );
      INSERT INTO notification_events (
        device_id, measurement_id, measurement_timestamp,
        current_temperature, previous_temperature, temperature_delta,
        current_humidity, previous_humidity, humidity_delta,
        temperature_triggered, humidity_triggered, created_at
      ) VALUES (
        'esp32-wokwi-01', 1, '2026-08-22T12:00:00.000Z',
        23.7, 22.0, 1.7, 56.2, 50.0, 6.2, 1, 1, '2026-08-22T12:00:00.000Z'
      );
    `);
    legacy.close();

    app = buildApp({ databasePath, now: () => new Date("2026-08-22T12:01:00.000Z") });
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/measurements",
      payload: { device_id: "esp32-ds18b20-01", temperature: 18.5 },
    });
    assert.equal(createResponse.statusCode, 201);

    const listResponse = await app.inject({ method: "GET", url: "/api/v1/measurements" });
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().measurements.length, 2);
    assert.equal(listResponse.json().measurements[0].humidity, null);
    assert.equal(listResponse.json().measurements[1].humidity, 56.2);

    const notificationsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/notifications/pending",
    });
    assert.equal(notificationsResponse.statusCode, 200);
    assert.equal(notificationsResponse.json().notifications[0].humidity_delta, 6.2);
  });
});
