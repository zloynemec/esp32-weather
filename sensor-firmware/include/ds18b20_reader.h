#pragma once

#include <Arduino.h>
#include <DallasTemperature.h>
#include <OneWire.h>

class Ds18b20Reader {
 public:
  explicit Ds18b20Reader(uint8_t pin);

  void begin();
  size_t sensorCount() const;
  void requestTemperatures();
  bool read(size_t index, float& temperature);

 private:
  uint8_t pin_;
  OneWire oneWire_;
  DallasTemperature sensors_;
  DeviceAddress addresses_[2];
  size_t sensorCount_;
};
