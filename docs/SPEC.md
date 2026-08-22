# Technical Specification

## 1. System

Three interacting projects:

### Sensor Firmware
Responsibilities:
- connect to Wi-Fi;
- read temperature and humidity;
- send one measurement every minute to Server API;
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

Initial endpoint:

`POST /api/v1/measurements`

History endpoint:

`GET /api/v1/measurements`

Expected filters:
- `device_id`
- `from`
- `to`
- `interval`

Convenience endpoint:

`GET /api/v1/measurements/week`

### Telegram Bot App
Responsibilities:
- send messages to configured Telegram group;
- send chart images;
- receive notification requests/events from server side;
- remain free of sensor business logic where possible.

## 2. Measurement storage

Initial logical table:

- id
- device_id
- timestamp
- temperature
- humidity
- uptime
- wifi_rssi

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

Compare against the value associated with the last notification, not blindly against only the previous one-minute sample.

If both metrics trigger in a short period, combine them into one notification when possible.

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
- average humidity

Maximum points per series: 168.

The chart should be delivered to Telegram as an image.

## 6. Emulator-first development

Before using physical ESP32 hardware, implement a local emulator that:
- runs on macOS;
- emits plausible temperature/humidity values;
- posts to the same production API contract every minute;
- can optionally simulate threshold changes and connectivity loss.

The real ESP32 must later replace the emulator without requiring Server API or Telegram architecture changes.
