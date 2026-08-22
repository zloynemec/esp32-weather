#pragma once

#include <Arduino.h>

#ifndef WEATHER_WIFI_SSID
#define WEATHER_WIFI_SSID "Wokwi-GUEST"
#endif

#ifndef WEATHER_WIFI_PASSWORD
#define WEATHER_WIFI_PASSWORD ""
#endif

#ifndef WEATHER_SERVER_URL
#define WEATHER_SERVER_URL "http://host.wokwi.internal:3000/api/v1/measurements"
#endif

#ifndef WEATHER_DEVICE_ID
#define WEATHER_DEVICE_ID "esp32-wokwi-01"
#endif

#ifndef WEATHER_DS18B20_DEVICE_1_ID
#define WEATHER_DS18B20_DEVICE_1_ID "esp32-wokwi-ds18b20-01"
#endif

#ifndef WEATHER_DS18B20_DEVICE_2_ID
#define WEATHER_DS18B20_DEVICE_2_ID "esp32-wokwi-ds18b20-02"
#endif

namespace AppConfig {

constexpr char kWifiSsid[] = WEATHER_WIFI_SSID;
constexpr char kWifiPassword[] = WEATHER_WIFI_PASSWORD;
constexpr char kServerUrl[] = WEATHER_SERVER_URL;
constexpr char kDhtDeviceId[] = WEATHER_DEVICE_ID;
constexpr const char* kDs18b20DeviceIds[] = {
    WEATHER_DS18B20_DEVICE_1_ID,
    WEATHER_DS18B20_DEVICE_2_ID,
};

constexpr uint8_t kDhtPin = 15;
constexpr uint8_t kOneWirePin = 4;
constexpr size_t kDs18b20SensorCount =
    sizeof(kDs18b20DeviceIds) / sizeof(kDs18b20DeviceIds[0]);
constexpr uint32_t kMeasurementIntervalMs = 60000UL;
constexpr uint32_t kWifiRetryIntervalMs = 5000UL;
constexpr uint32_t kWifiConnectTimeoutMs = 20000UL;

}  // namespace AppConfig
