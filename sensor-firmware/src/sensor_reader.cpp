#include "sensor_reader.h"

#include <cmath>

SensorReader::SensorReader(uint8_t pin) : sensor_(pin, DHT22) {}

void SensorReader::begin() {
  sensor_.begin();
}

bool SensorReader::read(SensorReading& reading) {
  const float humidity = sensor_.readHumidity();
  const float temperature = sensor_.readTemperature();

  if (std::isnan(temperature) || std::isnan(humidity)) {
    return false;
  }

  reading.temperature = temperature;
  reading.humidity = humidity;
  reading.hasHumidity = true;
  return true;
}
