#include "measurement_queue.h"

MeasurementQueue::MeasurementQueue() : head_(0), size_(0) {}

bool MeasurementQueue::full() const {
  return size_ == kCapacity;
}

bool MeasurementQueue::empty() const {
  return size_ == 0;
}

size_t MeasurementQueue::size() const {
  return size_;
}

void MeasurementQueue::push(const QueuedMeasurement& measurement) {
  if (full()) {
    head_ = (head_ + 1) % kCapacity;
    --size_;
  }

  const size_t tail = (head_ + size_) % kCapacity;
  items_[tail] = measurement;
  ++size_;
}

const QueuedMeasurement* MeasurementQueue::front() const {
  return empty() ? nullptr : &items_[head_];
}

void MeasurementQueue::pop() {
  if (empty()) {
    return;
  }
  head_ = (head_ + 1) % kCapacity;
  --size_;
}
