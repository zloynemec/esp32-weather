# Technical Specification

## 1. System

Three interacting projects:

### Sensor Firmware
Responsibilities:
- run the same C++/Arduino application on an emulated or physical ESP32;
- connect to Wi-Fi;
- read temperature and humidity from a DHT22 and temperature from two DS18B20 sensors on one 1-Wire bus;
- send one measurement per logical sensor every minute to Server API;
- expose basic diagnostics such as uptime and Wi-Fi RSSI.

Example payload:

```json
{
  "device_id": "esp32-test-01",
  "temperature": 23.7,
  "humidity": 56.2,
  "uptime": 182340,
  "wifi_rssi": -61
}
```

### Server API
Responsibilities:
- accept measurements;
- validate payload;
- add server timestamp;
- store measurements in SQLite;
- expose history;
- aggregate hourly data;
- evaluate notification conditions;
- detect missing sensor data and recovery.

Device endpoints:

- `GET /api/v1/devices` — list registered devices;
- `GET /api/v1/devices/:device_id` — get one device and its settings;
- `PATCH /api/v1/devices/:device_id` — update its description and notification thresholds.
- `GET /api/v1/notifications/pending` — list durable events awaiting delivery;
- `POST /api/v1/notifications/:notification_id/delivered` — acknowledge delivery.

Devices are registered automatically when their first measurement is accepted.

Initial endpoint:

`POST /api/v1/measurements`

Current request contract:

```json
{
  "device_id": "esp32-test-01",
  "temperature": 23.7,
  "humidity": 56.2,
  "uptime": 182340,
  "wifi_rssi": -61
}
```

Temperature-only payload:

```json
{
  "device_id": "esp32-wokwi-ds18b20-01",
  "temperature": 18.5,
  "uptime": 182340,
  "wifi_rssi": -61
}
```

- `device_id` and `temperature` are required;
- `humidity` is optional and is stored as `NULL` for temperature-only sensors;
- `uptime` and `wifi_rssi` are optional diagnostics;
- unknown properties are rejected;
- the server assigns the measurement `timestamp` and returns the stored row with
  HTTP status `201`.

History endpoint:

`GET /api/v1/measurements`

Expected filters:
- `device_id`
- `from`
- `to`
- `interval`

The first storage milestone supports `device_id` and `limit` (default 100, maximum
1000). Time filters and aggregation remain part of the later history milestone.

Chart endpoint:

`GET /api/v1/measurements/chart?device_id=...&range=day`

Supported ranges and aggregation:

- `hour`: one-minute averages, up to 60 points;
- `day`: 15-minute averages, up to 96 points;
- `week`: hourly averages, up to 168 points;
- `month`: six-hour averages over the last 30 days, up to 120 points.

### Telegram Bot App
Responsibilities:
- send messages to configured Telegram group;
- send chart images;
- receive notification requests/events from server side;
- remain free of sensor business logic where possible.

## 2. Measurement storage

Device table:

- device_id
- description
- temperature_delta_threshold
- humidity_delta_threshold
- notification_cooldown_seconds
- last_notified_temperature
- last_notified_humidity
- last_notified_at
- created_at
- updated_at
- last_seen_at

Default thresholds:

- temperature: 1.0 °C
- humidity: 5 percentage points

The rule represented by each threshold is a simple absolute delta comparison:

```text
abs(current_value - last_notified_value) >= configured_threshold
```

`last_seen_at` is updated atomically with each accepted measurement and will later
be used by connectivity monitoring.

Initial logical table:

- id
- device_id
- timestamp
- temperature
- humidity
- uptime
- wifi_rssi

`humidity` is nullable. Temperature-only devices still participate in storage,
temperature notification rules and chart aggregation; humidity rules are skipped.

At one measurement per minute:
- 1,440 rows/day/device
- 10,080 rows/week/device
- 525,600 rows/year/device

## 3. Notification rules

Defaults:
- temperature delta: >= 1.0 °C
- humidity delta: >= 5 percentage points
- cooldown: 10 minutes

Thresholds should be configurable.

Thresholds are stored per device in the `devices` table. They must be greater than
zero; temperature is limited to 180 °C and humidity to 100 percentage points.
Cooldown is stored per device in seconds, defaults to 600, and may range from 0 to
86,400.

Compare against the value associated with the last notification, not blindly against only the previous one-minute sample.

If both available metrics trigger in a short period, combine them into one notification when possible.

The first accepted measurement initializes the comparison baseline without creating
an event. A triggered decision and its `notification_events` outbox row are stored in
the same transaction as the measurement. The comparison baseline advances when the
event is created. The bot marks the event delivered only after Telegram accepts the
message; failed deliveries remain pending for retry.

## 4. Connectivity monitoring

If no data has arrived from a device for > 5 minutes:
- send outage notification once.

When data resumes:
- send recovery notification once.

## 5. Weekly chart

Period: last 7 days.
Resolution: one hour.
Aggregation:
- average temperature
- average humidity when available

Maximum points per series: 168.

The chart should be delivered to Telegram as an image. A temperature-only device
produces a single-series chart without a humidity axis.

The command interface extends this model with hour, day and 30-day ranges. The
default `/chart` request uses one day. When humidity is available, temperature and
humidity share one PNG and time axis while using separate labelled Y axes because
their units differ.

## 6. Emulator-first development

Before using physical hardware, compile the production-shaped C++/Arduino firmware
with PlatformIO and run it on a virtual ESP32 in Wokwi:

- emulate an ESP32 DevKitC, a DHT22 and two DS18B20 sensors sharing GPIO 4;
- read the sensor through the real DHT driver rather than generating values in the host application;
- connect through the emulated Wi-Fi interface;
- post to the production API contract every minute;
- allow all temperatures and DHT22 humidity to be changed through Wokwi controls;
- reach the local Server API through `host.wokwi.internal`.

The emulator is the Wokwi hardware environment, not a separate Node.js data
generator. The same firmware structure must later run on a physical ESP32 without
requiring Server API or Telegram architecture changes.
