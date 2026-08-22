#include "ds18b20_reader.h"

#include <cmath>

Ds18b20Reader::Ds18b20Reader(uint8_t pin)
    : pin_(pin), oneWire_(pin), sensors_(&oneWire_), sensorCount_(0) {}

void Ds18b20Reader::begin() {
  sensors_.begin();
  const size_t discovered = sensors_.getDeviceCount();
  sensorCount_ = discovered < 2 ? discovered : 2;

  for (size_t index = 0; index < sensorCount_; ++index) {
    if (!sensors_.getAddress(addresses_[index], index)) {
      sensorCount_ = index;
      break;
    }
    sensors_.setResolution(addresses_[index], 12);
  }

  Serial.printf(
      "[ds18b20] discovered %u sensor(s) on GPIO %u\n",
      static_cast<unsigned>(sensorCount_),
      pin_);
}

size_t Ds18b20Reader::sensorCount() const {
  return sensorCount_;
}

void Ds18b20Reader::requestTemperatures() {
  sensors_.requestTemperatures();
}

bool Ds18b20Reader::read(size_t index, float& temperature) {
  if (index >= sensorCount_) {
    return false;
  }

  temperature = sensors_.getTempC(addresses_[index]);
  return !std::isnan(temperature) && temperature != DEVICE_DISCONNECTED_C;
}
