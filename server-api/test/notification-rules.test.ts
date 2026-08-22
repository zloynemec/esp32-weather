import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateNotification } from "../src/notification-rules.js";

describe("notification rules", () => {
  it("triggers at the configured absolute thresholds and combines both metrics", () => {
    const decision = evaluateNotification({
      currentTemperature: 19,
      currentHumidity: 45,
      previousTemperature: 20,
      previousHumidity: 40,
      temperatureThreshold: 1,
      humidityThreshold: 5,
      cooldownSeconds: 600,
      lastNotificationAt: null,
      measurementTimestamp: "2026-08-22T12:01:00.000Z",
    });

    assert.deepEqual(decision, {
      temperatureDelta: -1,
      humidityDelta: 5,
      temperatureTriggered: true,
      humidityTriggered: true,
    });
  });

  it("does not trigger below the configured thresholds", () => {
    const decision = evaluateNotification({
      currentTemperature: 20.9,
      currentHumidity: 44.9,
      previousTemperature: 20,
      previousHumidity: 40,
      temperatureThreshold: 1,
      humidityThreshold: 5,
      cooldownSeconds: 600,
      lastNotificationAt: null,
      measurementTimestamp: "2026-08-22T12:01:00.000Z",
    });

    assert.equal(decision, null);
  });

  it("suppresses changes during cooldown and allows them at its boundary", () => {
    const base = {
      currentTemperature: 22,
      currentHumidity: 40,
      previousTemperature: 20,
      previousHumidity: 40,
      temperatureThreshold: 1,
      humidityThreshold: 5,
      cooldownSeconds: 600,
      lastNotificationAt: "2026-08-22T12:00:00.000Z",
    };

    assert.equal(
      evaluateNotification({ ...base, measurementTimestamp: "2026-08-22T12:09:59.999Z" }),
      null,
    );
    assert.notEqual(
      evaluateNotification({ ...base, measurementTimestamp: "2026-08-22T12:10:00.000Z" }),
      null,
    );
  });
});
