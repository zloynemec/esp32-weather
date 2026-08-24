#pragma once

#include <Arduino.h>

#include "sensor_reader.h"

struct QueuedMeasurement {
  const char* deviceId;
  SensorReading reading;
  uint64_t uptimeSeconds;
  int32_t wifiRssi;
  bool hasWifiRssi;
  uint32_t capturedAtMillis;
};

class MeasurementQueue {
 public:
  static constexpr size_t kCapacity = 180;

  MeasurementQueue();

  bool full() const;
  bool empty() const;
  size_t size() const;
  void push(const QueuedMeasurement& measurement);
  const QueuedMeasurement* front() const;
  void pop();

 private:
  QueuedMeasurement items_[kCapacity];
  size_t head_;
  size_t size_;
};
