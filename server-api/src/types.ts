export interface NewMeasurement {
  device_id: string;
  temperature: number;
  humidity?: number;
  uptime?: number;
  wifi_rssi?: number;
}

export interface Measurement {
  id: number;
  device_id: string;
  timestamp: string;
  temperature: number;
  humidity: number | null;
  uptime: number | null;
  wifi_rssi: number | null;
}

export interface MeasurementQuery {
  device_id?: string;
  limit?: number;
}

export type ChartRange = "hour" | "day" | "week" | "month";

export interface ChartPoint {
  timestamp: string;
  temperature: number;
  humidity: number | null;
}

export interface MeasurementChart {
  device_id: string;
  range: ChartRange;
  from: string;
  to: string;
  bucket_seconds: number;
  points: ChartPoint[];
}

export interface Device {
  device_id: string;
  description: string | null;
  temperature_delta_threshold: number;
  humidity_delta_threshold: number;
  notification_cooldown_seconds: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface UpdateDevice {
  description?: string | null;
  temperature_delta_threshold?: number;
  humidity_delta_threshold?: number;
  notification_cooldown_seconds?: number;
}

export interface NotificationEvent {
  id: number;
  device_id: string;
  device_description: string | null;
  measurement_id: number;
  measurement_timestamp: string;
  current_temperature: number;
  previous_temperature: number;
  temperature_delta: number;
  current_humidity: number | null;
  previous_humidity: number | null;
  humidity_delta: number | null;
  temperature_triggered: boolean;
  humidity_triggered: boolean;
  created_at: string;
  delivered_at: string | null;
}
