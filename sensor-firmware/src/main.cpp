#include <Arduino.h>
#include <WiFi.h>
#include <esp_timer.h>
#include <time.h>

#include "api_client.h"
#include "app_config.h"
#include "ds18b20_reader.h"
#include "measurement_queue.h"
#include "sensor_reader.h"

namespace {

constexpr time_t kMinimumValidEpoch = 1704067200;  // 2024-01-01T00:00:00Z

SensorReader dhtSensor(AppConfig::kDhtPin);
Ds18b20Reader ds18b20Sensors(AppConfig::kOneWirePin);
ApiClient apiClient(AppConfig::kServerUrl);
MeasurementQueue measurementQueue;

uint32_t lastMeasurementAt = 0;
uint32_t lastWifiAttemptAt = 0;
uint32_t lastUploadFailureAt = 0;
bool firstMeasurement = true;
bool uploadRetryPending = false;
bool clockSyncStarted = false;
bool clockSyncLogged = false;

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

  Serial.printf(
      "[wifi] connected, IP=%s RSSI=%d dBm\n",
      WiFi.localIP().toString().c_str(),
      WiFi.RSSI());
  return true;
}

void startClockSync() {
  if (clockSyncStarted || WiFi.status() != WL_CONNECTED) {
    return;
  }
  configTime(0, 0, AppConfig::kNtpServer);
  clockSyncStarted = true;
  Serial.printf("[clock] synchronizing with %s\n", AppConfig::kNtpServer);
}

bool clockIsSynchronized() {
  const bool synchronized = time(nullptr) >= kMinimumValidEpoch;
  if (synchronized && !clockSyncLogged) {
    clockSyncLogged = true;
    Serial.println("[clock] synchronized");
  }
  return synchronized;
}

bool formatMeasuredAt(uint32_t capturedAtMillis, char* output, size_t outputSize) {
  const time_t currentEpoch = time(nullptr);
  if (currentEpoch < kMinimumValidEpoch) {
    return false;
  }

  const uint32_t elapsedSeconds =
      static_cast<uint32_t>(millis() - capturedAtMillis) / 1000UL;
  const time_t measuredEpoch = currentEpoch - elapsedSeconds;
  struct tm utcTime {};
  if (gmtime_r(&measuredEpoch, &utcTime) == nullptr) {
    return false;
  }
  return strftime(output, outputSize, "%Y-%m-%dT%H:%M:%SZ", &utcTime) > 0;
}

void enqueueMeasurement(
    const char* deviceId,
    const SensorReading& reading,
    uint64_t uptimeSeconds,
    int32_t wifiRssi,
    bool hasWifiRssi,
    uint32_t capturedAtMillis) {
  if (measurementQueue.full()) {
    Serial.println("[queue] full, dropping the oldest measurement");
  }
  measurementQueue.push({
      deviceId,
      reading,
      uptimeSeconds,
      wifiRssi,
      hasWifiRssi,
      capturedAtMillis,
  });
  Serial.printf(
      "[queue] queued %s, pending=%u/%u\n",
      deviceId,
      static_cast<unsigned>(measurementQueue.size()),
      static_cast<unsigned>(MeasurementQueue::kCapacity));
}

void captureDhtMeasurement(
    uint64_t uptimeSeconds,
    int32_t wifiRssi,
    bool hasWifiRssi,
    uint32_t capturedAtMillis) {
  SensorReading reading{};
  if (!dhtSensor.read(reading)) {
    Serial.println("[dht22] failed to read sensor");
    return;
  }

  Serial.printf(
      "[dht22] temperature=%.1f C humidity=%.1f %%\n",
      reading.temperature,
      reading.humidity);
  enqueueMeasurement(
      AppConfig::kDhtDeviceId,
      reading,
      uptimeSeconds,
      wifiRssi,
      hasWifiRssi,
      capturedAtMillis);
}

void captureDs18b20Measurements(
    uint64_t uptimeSeconds,
    int32_t wifiRssi,
    bool hasWifiRssi,
    uint32_t capturedAtMillis) {
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
    enqueueMeasurement(
        deviceId,
        reading,
        uptimeSeconds,
        wifiRssi,
        hasWifiRssi,
        capturedAtMillis);
  }
}

void captureMeasurements() {
  const uint32_t capturedAtMillis = millis();
  const uint64_t uptimeSeconds = static_cast<uint64_t>(esp_timer_get_time()) / 1000000ULL;
  const bool hasWifiRssi = WiFi.status() == WL_CONNECTED;
  const int32_t wifiRssi = hasWifiRssi ? WiFi.RSSI() : 0;
  captureDhtMeasurement(
      uptimeSeconds,
      wifiRssi,
      hasWifiRssi,
      capturedAtMillis);
  captureDs18b20Measurements(
      uptimeSeconds,
      wifiRssi,
      hasWifiRssi,
      capturedAtMillis);
}

void uploadNextMeasurement(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED || measurementQueue.empty()) {
    return;
  }
  if (uploadRetryPending &&
      !intervalElapsed(now, lastUploadFailureAt, AppConfig::kUploadRetryIntervalMs)) {
    return;
  }
  if (!clockIsSynchronized()) {
    return;
  }

  const QueuedMeasurement* measurement = measurementQueue.front();
  if (measurement == nullptr) {
    return;
  }

  char measuredAt[21];
  if (!formatMeasuredAt(measurement->capturedAtMillis, measuredAt, sizeof(measuredAt))) {
    return;
  }

  const bool accepted = apiClient.sendMeasurement(
      measurement->deviceId,
      measuredAt,
      measurement->reading,
      measurement->uptimeSeconds,
      measurement->wifiRssi,
      measurement->hasWifiRssi);
  if (!accepted) {
    uploadRetryPending = true;
    lastUploadFailureAt = millis();
    Serial.printf(
        "[queue] upload failed for %s, pending=%u; retry in %u seconds\n",
        measurement->deviceId,
        static_cast<unsigned>(measurementQueue.size()),
        static_cast<unsigned>(AppConfig::kUploadRetryIntervalMs / 1000UL));
    return;
  }

  const char* deliveredDeviceId = measurement->deviceId;
  measurementQueue.pop();
  uploadRetryPending = false;
  Serial.printf(
      "[queue] delivered %s, pending=%u\n",
      deliveredDeviceId,
      static_cast<unsigned>(measurementQueue.size()));
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("[system] ESP32 Weather starting");

  dhtSensor.begin();
  ds18b20Sensors.begin();
  connectWifi();
  startClockSync();
}

void loop() {
  uint32_t now = millis();

  if (WiFi.status() != WL_CONNECTED &&
      (lastWifiAttemptAt == 0 ||
       intervalElapsed(now, lastWifiAttemptAt, AppConfig::kWifiRetryIntervalMs))) {
    lastWifiAttemptAt = now;
    connectWifi();
  }

  startClockSync();
  now = millis();
  if (firstMeasurement ||
      intervalElapsed(now, lastMeasurementAt, AppConfig::kMeasurementIntervalMs)) {
    firstMeasurement = false;
    lastMeasurementAt = now;
    captureMeasurements();
  }

  uploadNextMeasurement(millis());
  delay(100);
}
