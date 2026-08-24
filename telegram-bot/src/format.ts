import type { Device, Measurement, NotificationEvent } from "./types.js";

export function formatMeasurement(
  measurement: Measurement,
  device: Device | undefined,
  timeZone: string,
): string {
  const title = device?.description
    ? `${device.description} (${measurement.device_id})`
    : measurement.device_id;
  const time = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone,
  }).format(new Date(measurement.measured_at));
  const valueFormatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const diagnostics: string[] = [];
  if (measurement.wifi_rssi !== null) {
    diagnostics.push(`Wi-Fi: ${measurement.wifi_rssi} dBm`);
  }
  if (measurement.uptime !== null) {
    diagnostics.push(`uptime: ${formatDuration(measurement.uptime)}`);
  }

  return [
    `🌤 ${title}`,
    `Температура: ${valueFormatter.format(measurement.temperature)} °C`,
    ...(measurement.humidity !== null
      ? [`Влажность: ${valueFormatter.format(measurement.humidity)} %`]
      : []),
    `Измерено: ${time}`,
    ...(diagnostics.length > 0 ? [diagnostics.join(" · ")] : []),
  ].join("\n");
}

export function formatDevices(devices: Device[], timeZone: string): string {
  if (devices.length === 0) {
    return "Устройства еще не зарегистрированы.";
  }

  const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  });
  const lines = devices.map((device) => {
    const description = device.description ? ` — ${device.description}` : "";
    const lastSeen = device.last_seen_at
      ? dateFormatter.format(new Date(device.last_seen_at))
      : "данных пока нет";
    return `• ${device.device_id}${description}\n  Последнее измерение: ${lastSeen}`;
  });
  return `Датчики:\n\n${lines.join("\n\n")}`;
}

export function formatChangeNotification(
  notification: NotificationEvent,
  timeZone: string,
): string {
  const title = notification.device_description
    ? `${notification.device_description} (${notification.device_id})`
    : notification.device_id;
  const number = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const signed = new Intl.NumberFormat("ru-RU", {
    signDisplay: "always",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const time = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone,
  }).format(new Date(notification.measurement_timestamp));
  const temperatureMarker = notification.temperature_triggered ? " ⚠️" : "";
  const lines = [
    `🔔 Значительное изменение — ${title}`,
    "",
    `🌡 Температура${temperatureMarker}: ${number.format(notification.current_temperature)} °C`,
    `   Было: ${number.format(notification.previous_temperature)} °C · Δ ${signed.format(notification.temperature_delta)} °C`,
  ];
  if (
    notification.current_humidity !== null &&
    notification.previous_humidity !== null &&
    notification.humidity_delta !== null
  ) {
    const humidityMarker = notification.humidity_triggered ? " ⚠️" : "";
    lines.push(
      `💧 Влажность${humidityMarker}: ${number.format(notification.current_humidity)} %`,
      `   Было: ${number.format(notification.previous_humidity)} % · Δ ${signed.format(notification.humidity_delta)} п.п.`,
    );
  }
  lines.push("", `Измерено: ${time}`);
  return lines.join("\n");
}

function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const parts = [
    ...(days > 0 ? [`${days} д`] : []),
    ...(hours > 0 ? [`${hours} ч`] : []),
    `${minutes} мин`,
  ];
  return parts.join(" ");
}
