#include "api_client.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClient.h>

ApiClient::ApiClient(const char* serverUrl) : serverUrl_(serverUrl) {}

bool ApiClient::sendMeasurement(
    const char* deviceId,
    const SensorReading& reading,
    uint64_t uptimeSeconds,
    int32_t wifiRssi) const {
  JsonDocument document;
  document["device_id"] = deviceId;
  document["temperature"] = reading.temperature;
  if (reading.hasHumidity) {
    document["humidity"] = reading.humidity;
  }
  document["uptime"] = uptimeSeconds;
  document["wifi_rssi"] = wifiRssi;

  String payload;
  serializeJson(document, payload);

  WiFiClient networkClient;
  HTTPClient httpClient;
  if (!httpClient.begin(networkClient, serverUrl_)) {
    Serial.println("[api] could not initialize HTTP client");
    return false;
  }

  httpClient.addHeader("Content-Type", "application/json");
  const int statusCode = httpClient.POST(payload);
  const bool accepted = statusCode >= 200 && statusCode < 300;

  Serial.printf("[api] POST %s -> %d\n", serverUrl_, statusCode);
  Serial.printf("[api] payload: %s\n", payload.c_str());
  if (!accepted && statusCode > 0) {
    Serial.printf("[api] response: %s\n", httpClient.getString().c_str());
  }

  httpClient.end();
  return accepted;
}
