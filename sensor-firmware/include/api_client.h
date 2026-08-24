#pragma once

#include <Arduino.h>

#include "sensor_reader.h"

class ApiClient {
 public:
  explicit ApiClient(const char* serverUrl);

  bool sendMeasurement(
      const char* deviceId,
      const char* measuredAt,
      const SensorReading& reading,
      uint64_t uptimeSeconds,
      int32_t wifiRssi,
      bool hasWifiRssi) const;

 private:
  const char* serverUrl_;
};
