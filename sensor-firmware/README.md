# ESP32 Sensor Firmware

This component contains the C++/Arduino application that runs on both the Wokwi
ESP32 and the future physical device. Wokwi emulates the hardware; it does not
replace the firmware with a host-side data generator.

## Hardware used in the emulator

- ESP32 DevKitC;
- DHT22 data pin connected to GPIO 15;
- virtual `Wokwi-GUEST` Wi-Fi access point.

## Responsibilities

- connect and reconnect to Wi-Fi;
- read temperature and humidity from DHT22;
- send a JSON measurement to Server API every 60 seconds;
- include device uptime and Wi-Fi RSSI;
- log sensor and HTTP errors to the serial monitor.

## Build and run

```bash
pio run
```

Then open `diagram.json` in VS Code and start the Wokwi simulator. Keep Server API
running locally on port 3000. The firmware accesses it through
`http://host.wokwi.internal:3000`.

The Wokwi DHT22 controls can be used to change temperature and humidity while the
firmware is running.

For a physical device, copy `platformio_override.example.ini` to
`platformio_override.ini` and replace Wi-Fi and API settings. Never commit the
local override because it may contain secrets.
