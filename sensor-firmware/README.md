# ESP32 Sensor Firmware

This component contains the C++/Arduino application that runs on both the Wokwi
ESP32 and the future physical device. Wokwi emulates the hardware; it does not
replace the firmware with a host-side data generator.

## Hardware used in the emulator

- ESP32 DevKitC;
- DHT22 data pin connected to GPIO 15;
- two DS18B20 data pins connected to the same GPIO 4 1-Wire bus;
- 4.7 kΩ pull-up resistor from the 1-Wire data line to 3.3 V;
- virtual `Wokwi-GUEST` Wi-Fi access point.

## Responsibilities

- connect and reconnect to Wi-Fi;
- read temperature and humidity from DHT22;
- read both DS18B20 temperatures with one shared conversion request;
- send three independent JSON measurements to Server API every 60 seconds;
- include device uptime and Wi-Fi RSSI;
- log sensor and HTTP errors to the serial monitor.

## Build and run

```bash
pio run
```

Then open `diagram.json` in VS Code and start the Wokwi simulator. Keep Server API
running locally on port 3000. The firmware accesses it through
`http://host.wokwi.internal:3000`.

The Wokwi controls can be used to change all three temperatures and DHT22 humidity
while the firmware is running. The logical device IDs are:

- `esp32-wokwi-01` for DHT22;
- `esp32-wokwi-ds18b20-01` for the first discovered DS18B20;
- `esp32-wokwi-ds18b20-02` for the second discovered DS18B20.

DS18B20 payloads omit `humidity`; Server API persists it as `NULL`.

For a physical device, copy `platformio_override.example.ini` to
`platformio_override.ini` and replace Wi-Fi and API settings. Never commit the
local override because it may contain secrets.
