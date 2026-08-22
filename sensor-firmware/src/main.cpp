#include <Arduino.h>
#include <WiFi.h>
#include <esp_timer.h>

#include "api_client.h"
#include "app_config.h"
#include "ds18b20_reader.h"
#include "sensor_reader.h"

namespace {

SensorReader dhtSensor(AppConfig::kDhtPin);
Ds18b20Reader ds18b20Sensors(AppConfig::kOneWirePin);
ApiClient apiClient(AppConfig::kServerUrl);

uint32_t lastMeasurementAt = 0;
uint32_t lastWifiAttemptAt = 0;
bool firstMeasurement = true;

bool intervalElapsed(uint32_t now, uint32_t previous, uint32_t interval) {
  return static_cast<uint32_t>(now - previous) >= interval;
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  Serial.printf("[wifi] connecting to %s", AppConfig::kWifiSsid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(AppConfig::kWifiSsid, AppConfig::kWifiPassword);

  const uint32_t startedAt = millis();
  while (
      WiFi.status() != WL_CONNECTED &&
      !intervalElapsed(millis(), startedAt, AppConfig::kWifiConnectTimeoutMs)) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[wifi] connection timed out");
    WiFi.disconnect();
    return false;
  }

  Serial.printf("[wifi] connected, IP=%s RSSI=%d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  return true;
}

void sendDhtMeasurement(uint64_t uptimeSeconds, int32_t wifiRssi) {
  SensorReading reading{};
  if (!dhtSensor.read(reading)) {
    Serial.println("[dht22] failed to read sensor");
    return;
  }

  Serial.printf(
      "[dht22] temperature=%.1f C humidity=%.1f %%\n",
      reading.temperature,
      reading.humidity);

  if (!apiClient.sendMeasurement(
          AppConfig::kDhtDeviceId, reading, uptimeSeconds, wifiRssi)) {
    Serial.printf("[api] measurement for %s was not accepted\n", AppConfig::kDhtDeviceId);
  }
}

void sendDs18b20Measurements(uint64_t uptimeSeconds, int32_t wifiRssi) {
  ds18b20Sensors.requestTemperatures();
  const size_t sensorCount = ds18b20Sensors.sensorCount() < AppConfig::kDs18b20SensorCount
      ? ds18b20Sensors.sensorCount()
      : AppConfig::kDs18b20SensorCount;
  for (size_t index = 0; index < sensorCount; ++index) {
    float temperature = 0;
    if (!ds18b20Sensors.read(index, temperature)) {
      Serial.printf("[ds18b20] failed to read sensor %u\n", static_cast<unsigned>(index + 1));
      continue;
    }

    const SensorReading reading{temperature, 0, false};
    const char* deviceId = AppConfig::kDs18b20DeviceIds[index];
    Serial.printf(
        "[ds18b20] sensor=%u device_id=%s temperature=%.1f C\n",
        static_cast<unsigned>(index + 1),
        deviceId,
        temperature);
    if (!apiClient.sendMeasurement(deviceId, reading, uptimeSeconds, wifiRssi)) {
      Serial.printf("[api] measurement for %s was not accepted\n", deviceId);
    }
  }
}

void takeAndSendMeasurements() {
  const uint64_t uptimeSeconds = static_cast<uint64_t>(esp_timer_get_time()) / 1000000ULL;
  const int32_t wifiRssi = WiFi.RSSI();
  sendDhtMeasurement(uptimeSeconds, wifiRssi);
  sendDs18b20Measurements(uptimeSeconds, wifiRssi);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("[system] ESP32 Weather starting");

  dhtSensor.begin();
  ds18b20Sensors.begin();
  connectWifi();
}

void loop() {
  const uint32_t now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (lastWifiAttemptAt == 0 ||
        intervalElapsed(now, lastWifiAttemptAt, AppConfig::kWifiRetryIntervalMs)) {
      lastWifiAttemptAt = now;
      connectWifi();
    }
    delay(100);
    return;
  }

  if (firstMeasurement ||
      intervalElapsed(now, lastMeasurementAt, AppConfig::kMeasurementIntervalMs)) {
    firstMeasurement = false;
    lastMeasurementAt = now;
    takeAndSendMeasurements();
  }

  delay(100);
}
