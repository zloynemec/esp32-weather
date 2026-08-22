#pragma once

#include <Arduino.h>
#include <DHT.h>

struct SensorReading {
  float temperature;
  float humidity;
};

class SensorReader {
 public:
  explicit SensorReader(uint8_t pin);

  void begin();
  bool read(SensorReading& reading);

 private:
  DHT sensor_;
};
