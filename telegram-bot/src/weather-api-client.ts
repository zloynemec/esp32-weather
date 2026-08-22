import type {
  ChartRange,
  Device,
  Measurement,
  MeasurementChart,
  NotificationEvent,
} from "./types.js";

type Fetch = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function isDevice(value: unknown): value is Device {
  return (
    isRecord(value) &&
    typeof value.device_id === "string" &&
    isNullableString(value.description) &&
    typeof value.temperature_delta_threshold === "number" &&
    typeof value.humidity_delta_threshold === "number" &&
    typeof value.notification_cooldown_seconds === "number" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    isNullableString(value.last_seen_at)
  );
}

function isNotificationEvent(value: unknown): value is NotificationEvent {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.device_id === "string" &&
    isNullableString(value.device_description) &&
    typeof value.measurement_id === "number" &&
    typeof value.measurement_timestamp === "string" &&
    typeof value.current_temperature === "number" &&
    typeof value.previous_temperature === "number" &&
    typeof value.temperature_delta === "number" &&
    typeof value.current_humidity === "number" &&
    typeof value.previous_humidity === "number" &&
    typeof value.humidity_delta === "number" &&
    typeof value.temperature_triggered === "boolean" &&
    typeof value.humidity_triggered === "boolean" &&
    typeof value.created_at === "string" &&
    isNullableString(value.delivered_at)
  );
}

function isMeasurement(value: unknown): value is Measurement {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.device_id === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.temperature === "number" &&
    typeof value.humidity === "number" &&
    isNullableNumber(value.uptime) &&
    isNullableNumber(value.wifi_rssi)
  );
}

function isChartPoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.timestamp === "string" &&
    typeof value.temperature === "number" &&
    typeof value.humidity === "number"
  );
}

function isMeasurementChart(value: unknown): value is MeasurementChart {
  return (
    isRecord(value) &&
    typeof value.device_id === "string" &&
    (value.range === "hour" ||
      value.range === "day" ||
      value.range === "week" ||
      value.range === "month") &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    typeof value.bucket_seconds === "number" &&
    Array.isArray(value.points) &&
    value.points.length <= 168 &&
    value.points.every(isChartPoint)
  );
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Weather API returned invalid JSON");
  }
}

export class WeatherApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: Fetch = fetch,
  ) {}

  async listDevices(): Promise<Device[]> {
    const payload = await this.get("/api/v1/devices");
    if (!isRecord(payload) || !Array.isArray(payload.devices) || !payload.devices.every(isDevice)) {
      throw new Error("Weather API returned an invalid devices response");
    }
    return payload.devices;
  }

  async getLatestMeasurement(deviceId: string): Promise<Measurement | null> {
    const query = new URLSearchParams({ device_id: deviceId, limit: "1" });
    const payload = await this.get(`/api/v1/measurements?${query.toString()}`);
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.measurements) ||
      !payload.measurements.every(isMeasurement)
    ) {
      throw new Error("Weather API returned an invalid measurements response");
    }
    return payload.measurements[0] ?? null;
  }

  async getMeasurementChart(deviceId: string, range: ChartRange): Promise<MeasurementChart> {
    const query = new URLSearchParams({ device_id: deviceId, range });
    const payload = await this.get(`/api/v1/measurements/chart?${query.toString()}`);
    if (!isRecord(payload) || !isMeasurementChart(payload.chart)) {
      throw new Error("Weather API returned an invalid chart response");
    }
    return payload.chart;
  }

  async listPendingNotifications(limit = 20): Promise<NotificationEvent[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    const payload = await this.request(`/api/v1/notifications/pending?${query.toString()}`);
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.notifications) ||
      !payload.notifications.every(isNotificationEvent)
    ) {
      throw new Error("Weather API returned an invalid notifications response");
    }
    return payload.notifications;
  }

  async markNotificationDelivered(notificationId: number): Promise<void> {
    const payload = await this.request(
      `/api/v1/notifications/${notificationId}/delivered`,
      { method: "POST" },
    );
    if (!isRecord(payload) || !isNotificationEvent(payload.notification)) {
      throw new Error("Weather API returned an invalid notification acknowledgement");
    }
  }

  private async get(path: string): Promise<unknown> {
    return this.request(path);
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
        ...init,
      });
    } catch (error) {
      throw new Error("Weather API is unavailable", { cause: error });
    }

    if (!response.ok) {
      throw new Error(`Weather API returned HTTP ${response.status}`);
    }
    return responseJson(response);
  }
}
