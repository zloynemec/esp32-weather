#pragma once

#include <Arduino.h>

#include "sensor_reader.h"

class ApiClient {
 public:
  ApiClient(const char* serverUrl, const char* deviceId);

  bool sendMeasurement(
      const SensorReading& reading,
      uint64_t uptimeSeconds,
      int32_t wifiRssi) const;

 private:
  const char* serverUrl_;
  const char* deviceId_;
};
