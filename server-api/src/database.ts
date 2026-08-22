import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  Device,
  ChartPoint,
  Measurement,
  MeasurementQuery,
  NewMeasurement,
  NotificationEvent,
  UpdateDevice,
} from "./types.js";
import { evaluateNotification } from "./notification-rules.js";

interface MeasurementRow {
  id: number;
  device_id: string;
  timestamp: string;
  temperature: number;
  humidity: number | null;
  uptime: number | null;
  wifi_rssi: number | null;
}

interface DeviceRow {
  device_id: string;
  description: string | null;
  temperature_delta_threshold: number;
  humidity_delta_threshold: number;
  notification_cooldown_seconds: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

interface DeviceNotificationState extends DeviceRow {
  last_notified_temperature: number | null;
  last_notified_humidity: number | null;
  last_notified_at: string | null;
}

interface NotificationEventRow {
  id: number;
  device_id: string;
  device_description: string | null;
  measurement_id: number;
  measurement_timestamp: string;
  current_temperature: number;
  previous_temperature: number;
  temperature_delta: number;
  current_humidity: number | null;
  previous_humidity: number | null;
  humidity_delta: number | null;
  temperature_triggered: number;
  humidity_triggered: number;
  created_at: string;
  delivered_at: string | null;
}

interface ChartPointRow {
  bucket_epoch: number;
  temperature: number;
  humidity: number | null;
}

export class WeatherRepository {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA journal_mode = WAL;");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        description TEXT CHECK (description IS NULL OR length(description) <= 200),
        temperature_delta_threshold REAL NOT NULL DEFAULT 1.0
          CHECK (temperature_delta_threshold > 0 AND temperature_delta_threshold <= 180),
        humidity_delta_threshold REAL NOT NULL DEFAULT 5.0
          CHECK (humidity_delta_threshold > 0 AND humidity_delta_threshold <= 100),
        notification_cooldown_seconds INTEGER NOT NULL DEFAULT 600
          CHECK (notification_cooldown_seconds >= 0 AND notification_cooldown_seconds <= 86400),
        last_notified_temperature REAL,
        last_notified_humidity REAL,
        last_notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT
      );

      CREATE TABLE IF NOT EXISTS measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        temperature REAL NOT NULL,
        humidity REAL,
        uptime INTEGER,
        wifi_rssi INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_measurements_device_timestamp
        ON measurements (device_id, timestamp DESC);

      INSERT OR IGNORE INTO devices (
        device_id, created_at, updated_at, last_seen_at
      )
      SELECT device_id, MIN(timestamp), MIN(timestamp), MAX(timestamp)
      FROM measurements
      GROUP BY device_id;
    `);

    this.#ensureNullableHumidityColumns();
    this.#ensureDeviceNotificationColumns();
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS notification_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        device_description TEXT,
        measurement_id INTEGER NOT NULL,
        measurement_timestamp TEXT NOT NULL,
        current_temperature REAL NOT NULL,
        previous_temperature REAL NOT NULL,
        temperature_delta REAL NOT NULL,
        current_humidity REAL,
        previous_humidity REAL,
        humidity_delta REAL,
        temperature_triggered INTEGER NOT NULL CHECK (temperature_triggered IN (0, 1)),
        humidity_triggered INTEGER NOT NULL CHECK (humidity_triggered IN (0, 1)),
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        FOREIGN KEY (measurement_id) REFERENCES measurements(id)
      );

      CREATE INDEX IF NOT EXISTS idx_notification_events_pending
        ON notification_events (delivered_at, id);

      UPDATE devices SET last_notified_temperature = (
          SELECT temperature FROM measurements
          WHERE measurements.device_id = devices.device_id
          ORDER BY timestamp DESC, id DESC LIMIT 1
        )
      WHERE last_notified_temperature IS NULL;

      UPDATE devices SET last_notified_humidity = (
          SELECT humidity FROM measurements
          WHERE measurements.device_id = devices.device_id AND humidity IS NOT NULL
          ORDER BY timestamp DESC, id DESC LIMIT 1
        )
      WHERE last_notified_humidity IS NULL;
    `);
  }

  insert(input: NewMeasurement, timestamp: string): Measurement {
    this.#database.exec("BEGIN IMMEDIATE;");

    let measurementId: number;
    try {
      this.#database
        .prepare(`
          INSERT INTO devices (
            device_id, created_at, updated_at, last_seen_at,
            last_notified_temperature, last_notified_humidity
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET
            last_seen_at = excluded.last_seen_at
        `)
        .run(
          input.device_id,
          timestamp,
          timestamp,
          timestamp,
          input.temperature,
          input.humidity ?? null,
        );

      const result = this.#database
        .prepare(`
          INSERT INTO measurements (
            device_id, timestamp, temperature, humidity, uptime, wifi_rssi
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          input.device_id,
          timestamp,
          input.temperature,
          input.humidity ?? null,
          input.uptime ?? null,
          input.wifi_rssi ?? null,
        );
      measurementId = Number(result.lastInsertRowid);

      const device = this.#getDeviceNotificationState(input.device_id);
      if (
        device !== null &&
        device.last_notified_temperature !== null
      ) {
        const decision = evaluateNotification({
          currentTemperature: input.temperature,
          currentHumidity: input.humidity ?? null,
          previousTemperature: device.last_notified_temperature,
          previousHumidity: device.last_notified_humidity,
          temperatureThreshold: device.temperature_delta_threshold,
          humidityThreshold: device.humidity_delta_threshold,
          cooldownSeconds: device.notification_cooldown_seconds,
          lastNotificationAt: device.last_notified_at,
          measurementTimestamp: timestamp,
        });

        if (decision !== null) {
          this.#database
            .prepare(`
              INSERT INTO notification_events (
                device_id,
                device_description,
                measurement_id,
                measurement_timestamp,
                current_temperature,
                previous_temperature,
                temperature_delta,
                current_humidity,
                previous_humidity,
                humidity_delta,
                temperature_triggered,
                humidity_triggered,
                created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              input.device_id,
              device.description,
              measurementId,
              timestamp,
              input.temperature,
              device.last_notified_temperature,
              decision.temperatureDelta,
              input.humidity ?? null,
              device.last_notified_humidity,
              decision.humidityDelta,
              decision.temperatureTriggered ? 1 : 0,
              decision.humidityTriggered ? 1 : 0,
              timestamp,
            );
          this.#database
            .prepare(`
              UPDATE devices
              SET
                last_notified_temperature = ?,
                last_notified_humidity = ?,
                last_notified_at = ?
              WHERE device_id = ?
            `)
            .run(
              input.temperature,
              input.humidity ?? device.last_notified_humidity,
              timestamp,
              input.device_id,
            );
        } else if (device.last_notified_humidity === null && input.humidity !== undefined) {
          this.#database
            .prepare(`
              UPDATE devices
              SET last_notified_humidity = ?
              WHERE device_id = ?
            `)
            .run(input.humidity, input.device_id);
        }
      }
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

    return {
      id: measurementId,
      device_id: input.device_id,
      timestamp,
      temperature: input.temperature,
      humidity: input.humidity ?? null,
      uptime: input.uptime ?? null,
      wifi_rssi: input.wifi_rssi ?? null,
    };
  }

  list(query: MeasurementQuery): Measurement[] {
    if (query.device_id !== undefined) {
      return this.#database
        .prepare(`
          SELECT id, device_id, timestamp, temperature, humidity, uptime, wifi_rssi
          FROM measurements
          WHERE device_id = ?
          ORDER BY timestamp DESC, id DESC
          LIMIT ?
        `)
        .all(query.device_id, query.limit ?? 100) as unknown as MeasurementRow[];
    }

    return this.#database
      .prepare(`
        SELECT id, device_id, timestamp, temperature, humidity, uptime, wifi_rssi
        FROM measurements
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      `)
      .all(query.limit ?? 100) as unknown as MeasurementRow[];
  }

  getChartPoints(
    deviceId: string,
    from: string,
    to: string,
    bucketSeconds: number,
    limit: number,
  ): ChartPoint[] {
    const rows = this.#database
      .prepare(`
        SELECT
          CAST(CAST(strftime('%s', timestamp) AS INTEGER) / ? AS INTEGER) * ? AS bucket_epoch,
          AVG(temperature) AS temperature,
          AVG(humidity) AS humidity
        FROM measurements
        WHERE device_id = ? AND timestamp > ? AND timestamp <= ?
        GROUP BY bucket_epoch
        ORDER BY bucket_epoch
        LIMIT ?
      `)
      .all(bucketSeconds, bucketSeconds, deviceId, from, to, limit) as unknown as ChartPointRow[];
    return rows.map((row) => ({
      timestamp: new Date(row.bucket_epoch * 1_000).toISOString(),
      temperature: row.temperature,
      humidity: row.humidity,
    }));
  }

  listDevices(): Device[] {
    return this.#database
      .prepare(`
        SELECT
          device_id,
          description,
          temperature_delta_threshold,
          humidity_delta_threshold,
          notification_cooldown_seconds,
          created_at,
          updated_at,
          last_seen_at
        FROM devices
        ORDER BY device_id
      `)
      .all() as unknown as DeviceRow[];
  }

  getDevice(deviceId: string): Device | null {
    const row = this.#database
      .prepare(`
        SELECT
          device_id,
          description,
          temperature_delta_threshold,
          humidity_delta_threshold,
          notification_cooldown_seconds,
          created_at,
          updated_at,
          last_seen_at
        FROM devices
        WHERE device_id = ?
      `)
      .get(deviceId) as DeviceRow | undefined;

    return row ?? null;
  }

  updateDevice(deviceId: string, input: UpdateDevice, timestamp: string): Device | null {
    const current = this.getDevice(deviceId);
    if (current === null) {
      return null;
    }

    this.#database
      .prepare(`
        UPDATE devices
        SET
          description = ?,
          temperature_delta_threshold = ?,
          humidity_delta_threshold = ?,
          notification_cooldown_seconds = ?,
          updated_at = ?
        WHERE device_id = ?
      `)
      .run(
        input.description !== undefined ? input.description : current.description,
        input.temperature_delta_threshold ?? current.temperature_delta_threshold,
        input.humidity_delta_threshold ?? current.humidity_delta_threshold,
        input.notification_cooldown_seconds ?? current.notification_cooldown_seconds,
        timestamp,
        deviceId,
      );

    return this.getDevice(deviceId);
  }

  listPendingNotifications(limit: number): NotificationEvent[] {
    const rows = this.#database
      .prepare(`
        SELECT
          id,
          device_id,
          device_description,
          measurement_id,
          measurement_timestamp,
          current_temperature,
          previous_temperature,
          temperature_delta,
          current_humidity,
          previous_humidity,
          humidity_delta,
          temperature_triggered,
          humidity_triggered,
          created_at,
          delivered_at
        FROM notification_events
        WHERE delivered_at IS NULL
        ORDER BY id
        LIMIT ?
      `)
      .all(limit) as unknown as NotificationEventRow[];
    return rows.map((row) => this.#mapNotificationEvent(row));
  }

  markNotificationDelivered(notificationId: number, timestamp: string): NotificationEvent | null {
    this.#database
      .prepare(`
        UPDATE notification_events
        SET delivered_at = COALESCE(delivered_at, ?)
        WHERE id = ?
      `)
      .run(timestamp, notificationId);
    const row = this.#database
      .prepare(`
        SELECT
          id,
          device_id,
          device_description,
          measurement_id,
          measurement_timestamp,
          current_temperature,
          previous_temperature,
          temperature_delta,
          current_humidity,
          previous_humidity,
          humidity_delta,
          temperature_triggered,
          humidity_triggered,
          created_at,
          delivered_at
        FROM notification_events
        WHERE id = ?
      `)
      .get(notificationId) as NotificationEventRow | undefined;
    return row ? this.#mapNotificationEvent(row) : null;
  }

  #getDeviceNotificationState(deviceId: string): DeviceNotificationState | null {
    const row = this.#database
      .prepare(`
        SELECT
          device_id,
          description,
          temperature_delta_threshold,
          humidity_delta_threshold,
          notification_cooldown_seconds,
          last_notified_temperature,
          last_notified_humidity,
          last_notified_at,
          created_at,
          updated_at,
          last_seen_at
        FROM devices
        WHERE device_id = ?
      `)
      .get(deviceId) as DeviceNotificationState | undefined;
    return row ?? null;
  }

  #mapNotificationEvent(row: NotificationEventRow): NotificationEvent {
    return {
      ...row,
      temperature_triggered: row.temperature_triggered === 1,
      humidity_triggered: row.humidity_triggered === 1,
    };
  }

  #ensureNullableHumidityColumns(): void {
    const measurementColumns = this.#database
      .prepare("PRAGMA table_info(measurements)")
      .all() as unknown as Array<{ name: string; notnull: number }>;
    const measurementHumidity = measurementColumns.find((column) => column.name === "humidity");
    const notificationTableExists = this.#database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notification_events'")
      .get() !== undefined;
    const notificationHumidityIsRequired = notificationTableExists
      ? (
          this.#database.prepare("PRAGMA table_info(notification_events)").all() as unknown as Array<{
            name: string;
            notnull: number;
          }>
        ).some((column) =>
          ["current_humidity", "previous_humidity", "humidity_delta"].includes(column.name) &&
          column.notnull === 1,
        )
      : false;

    if (measurementHumidity?.notnull !== 1 && !notificationHumidityIsRequired) {
      return;
    }

    this.#database.exec("PRAGMA foreign_keys = OFF;");
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      if (notificationTableExists) {
        this.#database.exec("ALTER TABLE notification_events RENAME TO notification_events_legacy;");
      }
      this.#database.exec(`
        ALTER TABLE measurements RENAME TO measurements_legacy;

        CREATE TABLE measurements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          temperature REAL NOT NULL,
          humidity REAL,
          uptime INTEGER,
          wifi_rssi INTEGER
        );

        INSERT INTO measurements (
          id, device_id, timestamp, temperature, humidity, uptime, wifi_rssi
        )
        SELECT id, device_id, timestamp, temperature, humidity, uptime, wifi_rssi
        FROM measurements_legacy;
      `);

      if (notificationTableExists) {
        this.#database.exec(`
          CREATE TABLE notification_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            device_description TEXT,
            measurement_id INTEGER NOT NULL,
            measurement_timestamp TEXT NOT NULL,
            current_temperature REAL NOT NULL,
            previous_temperature REAL NOT NULL,
            temperature_delta REAL NOT NULL,
            current_humidity REAL,
            previous_humidity REAL,
            humidity_delta REAL,
            temperature_triggered INTEGER NOT NULL CHECK (temperature_triggered IN (0, 1)),
            humidity_triggered INTEGER NOT NULL CHECK (humidity_triggered IN (0, 1)),
            created_at TEXT NOT NULL,
            delivered_at TEXT,
            FOREIGN KEY (measurement_id) REFERENCES measurements(id)
          );

          INSERT INTO notification_events (
            id, device_id, device_description, measurement_id, measurement_timestamp,
            current_temperature, previous_temperature, temperature_delta,
            current_humidity, previous_humidity, humidity_delta,
            temperature_triggered, humidity_triggered, created_at, delivered_at
          )
          SELECT
            id, device_id, device_description, measurement_id, measurement_timestamp,
            current_temperature, previous_temperature, temperature_delta,
            current_humidity, previous_humidity, humidity_delta,
            temperature_triggered, humidity_triggered, created_at, delivered_at
          FROM notification_events_legacy;

          DROP TABLE notification_events_legacy;
        `);
      }

      this.#database.exec(`
        DROP TABLE measurements_legacy;
        CREATE INDEX idx_measurements_device_timestamp
          ON measurements (device_id, timestamp DESC);
      `);
      if (notificationTableExists) {
        this.#database.exec(`
          CREATE INDEX idx_notification_events_pending
            ON notification_events (delivered_at, id);
        `);
      }
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    } finally {
      this.#database.exec("PRAGMA foreign_keys = ON;");
    }
  }

  #ensureDeviceNotificationColumns(): void {
    const columns = this.#database
      .prepare("PRAGMA table_info(devices)")
      .all() as unknown as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    const additions = [
      [
        "notification_cooldown_seconds",
        "notification_cooldown_seconds INTEGER NOT NULL DEFAULT 600 CHECK (notification_cooldown_seconds >= 0 AND notification_cooldown_seconds <= 86400)",
      ],
      ["last_notified_temperature", "last_notified_temperature REAL"],
      ["last_notified_humidity", "last_notified_humidity REAL"],
      ["last_notified_at", "last_notified_at TEXT"],
    ] as const;
    for (const [name, definition] of additions) {
      if (!names.has(name)) {
        this.#database.exec(`ALTER TABLE devices ADD COLUMN ${definition}`);
      }
    }
  }

  close(): void {
    this.#database.close();
  }
}
