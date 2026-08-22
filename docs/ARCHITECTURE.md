# Architecture

```text
┌───────────────────┐
│ ESP32             │
│ DHT22 + 2×DS18B20 │
│ physical / Wokwi  │
└─────────┬─────────┘
          │ HTTP POST /api/v1/measurements
          ▼
┌───────────────────┐
│ Server API        │
│ Fastify           │
│                   │
│ validation        │
│ storage           │
│ event rules       │
│ aggregation       │
│ device health     │
└───────┬───────────┘
        │
        ├──────────────► SQLite
        │
        ▼
┌───────────────────┐
│ Telegram Bot App  │
│                   │
│ text notifications│
│ charts            │
└─────────┬─────────┘
          ▼
    Telegram group
```

## Dependency direction

- Sensor -> Server API
- Telegram Bot -> Server API where historical data is required
- Server -> Bot notification interface/event

No direct Sensor -> Telegram dependency.

## Emulated hardware milestone

There is no separate host-side sensor emulator. The `sensor-firmware/` C++/Arduino
application is compiled by PlatformIO and executed on Wokwi's virtual ESP32 with a
virtual DHT22 and two virtual DS18B20 sensors on one 1-Wire GPIO. It uses the same
Wi-Fi and HTTP code intended for the physical device.

For local development, the Wokwi IoT Gateway resolves `host.wokwi.internal` to the
macOS host running Server API. Changing sensor controls in Wokwi changes the readings
observed by the firmware. Each physical sensor is represented as an independent API
device: DHT22 reports temperature and humidity, while each DS18B20 reports only temperature.

The first implemented Server API milestone contains:

- Fastify request validation;
- a measurement repository backed by SQLite;
- `POST /api/v1/measurements` for ingestion;
- `GET /api/v1/measurements` for recent measurements;
- `GET /health` for a basic process health check;
- an OpenAPI specification generated from route schemas;
- interactive Scalar API documentation at `/docs`.

## Telegram Bot command interface

The Telegram Bot is an independently runnable TypeScript workspace. It receives
commands through Telegram long polling and reads measurements from Server API. The
bot does not access SQLite and does not evaluate notification thresholds.

The initial command milestone supports:

- `/weather [device_id]` for the latest measurement;
- `/devices` for registered sensors and their last-seen time;
- `/chart [hour|day|week|month] [device_id]` for an on-demand combined PNG;
- `/help` for command discovery;
- an allowlist of exactly one configured Telegram chat.

## Change notification delivery

Threshold evaluation remains a Server API responsibility. Measurement ingestion
compares each available metric with the values associated with the last notification and
applies the per-device cooldown. When either threshold is reached, the measurement,
updated reference values and one combined `notification_events` outbox row are
committed atomically.

The Telegram Bot polls the pending-event API independently from Telegram command
polling. It sends one combined message and acknowledges the event only after the
Telegram API accepts it. A failed event remains pending, which gives the local MVP
at-least-once delivery semantics. Outage state and chart aggregation remain Server
API responsibilities for the following milestones.

## Chart generation

Server API owns time filtering and aggregation. Its chart endpoint returns aligned
temperature and nullable humidity averages with a hard limit of 168 points. The resolutions
are one minute for an hour, 15 minutes for a day, one hour for a week and six hours
for 30 days.

The Telegram Bot renders that series locally as SVG and converts it to a 1200×720
PNG. When humidity exists, both metrics share the time axis; temperature uses the
left Y axis and humidity the right Y axis. Temperature-only devices render a single
series. No measurement data is sent to an external chart service.

## Device registry

Server API keeps a `devices` table as the source of truth for device metadata and
notification thresholds and cooldown. A device is registered automatically with default settings
when its first measurement is accepted. Measurement ingestion updates `last_seen_at`
in the same SQLite transaction as the measurement insert.

The device registry stores numeric absolute-delta thresholds rather than a free-form
rule language. This keeps validation and the notification evaluator explicit:

```text
abs(current - last_notified) >= threshold
```
