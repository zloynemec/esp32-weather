#include <Arduino.h>
#include <WiFi.h>
#include <esp_timer.h>

#include "api_client.h"
#include "app_config.h"
#include "sensor_reader.h"

namespace {

SensorReader sensor(AppConfig::kDhtPin);
ApiClient apiClient(AppConfig::kServerUrl, AppConfig::kDeviceId);

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

void takeAndSendMeasurement() {
  SensorReading reading{};
  if (!sensor.read(reading)) {
    Serial.println("[sensor] failed to read DHT22");
    return;
  }

  Serial.printf(
      "[sensor] temperature=%.1f C humidity=%.1f %%\n",
      reading.temperature,
      reading.humidity);

  const uint64_t uptimeSeconds = static_cast<uint64_t>(esp_timer_get_time()) / 1000000ULL;
  if (!apiClient.sendMeasurement(reading, uptimeSeconds, WiFi.RSSI())) {
    Serial.println("[api] measurement was not accepted");
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("[system] ESP32 Weather starting");

  sensor.begin();
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
    takeAndSendMeasurement();
  }

  delay(100);
}
