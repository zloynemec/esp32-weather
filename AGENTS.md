# AGENTS.md

## Project goal

Build a simple, understandable educational IoT system with three independently maintainable components:

- ESP32 sensor firmware
- Server API
- Telegram Bot application

Prefer simple solutions over premature abstraction.

## Architecture rules

1. ESP32 knows only about the sensor, Wi-Fi and Server API.
2. ESP32 must not contain Telegram-specific logic.
3. Server API is the source of truth for measurements and notification rules.
4. Telegram Bot is primarily a delivery/presentation component.
5. Components communicate through explicit APIs/events.
6. Secrets must never be committed. Use `.env` / `.env.example`.
7. Keep the MVP runnable locally on macOS before deploying anywhere.
8. First develop the complete flow by running the real C++/Arduino firmware on an emulated ESP32; later validate and adapt the same firmware on physical hardware.

## Required behavior

- Sensor measurement interval: 60 seconds.
- Store temperature and humidity measurements.
- Device identifier is required.
- Server timestamps accepted measurements.
- Detect significant change relative to the value of the previous notification:
  - temperature: default threshold 1.0 °C
  - humidity: default threshold 5 percentage points
- Avoid Telegram spam:
  - default cooldown: 10 minutes
  - combine simultaneous parameter changes into one notification where practical
- Detect sensor outage:
  - alert after 5 minutes without data
  - alert when data flow recovers
- Telegram notification includes:
  - current value
  - previous notification value
  - delta
  - measurement time
  - chart for the last 7 days
- Weekly chart:
  - hourly aggregation
  - average temperature
  - average humidity
  - up to 168 points per series

## Development order

1. Establish repository structure and contracts.
2. Implement Server API and SQLite schema.
3. Implement C++/Arduino sensor firmware for an emulated ESP32 and DHT22.
4. Verify Wokwi ESP32 -> API -> database flow.
5. Implement Telegram Bot.
6. Implement notification/event rules.
7. Implement chart generation.
8. Add outage/recovery monitoring.
9. Validate and adapt the firmware on a physical ESP32 and sensor.
10. Add tests and deployment documentation.

## Coding expectations

- TypeScript strict mode where applicable.
- Small modules with clear responsibility.
- Validate all external input.
- Meaningful error handling and logging.
- Add tests for notification thresholds and API validation.
- Update README/docs when architecture or public API changes.
- Before large changes, briefly state the intended plan.
