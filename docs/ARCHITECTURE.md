# Architecture

```text
┌───────────────────┐
│ ESP32 / Emulator  │
│ BME280            │
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
