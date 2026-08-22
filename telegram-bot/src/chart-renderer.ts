import sharp from "sharp";

import type { ChartRange, MeasurementChart } from "./types.js";

const width = 1_200;
const height = 720;
const plot = { left: 110, top: 145, width: 980, height: 455 };
const rangeTitles: Record<ChartRange, string> = {
  hour: "последний час",
  day: "последние сутки",
  week: "последние 7 дней",
  month: "последние 30 дней",
};

interface Domain {
  min: number;
  max: number;
}

export async function renderMeasurementChart(
  chart: MeasurementChart,
  deviceTitle: string,
  timeZone: string,
): Promise<Buffer> {
  if (chart.points.length === 0) {
    throw new Error("Cannot render a chart without points");
  }

  const temperatureDomain = createDomain(chart.points.map((point) => point.temperature), 1);
  const humidityValues = chart.points.flatMap((point) =>
    point.humidity === null ? [] : [point.humidity],
  );
  const humidityDomain =
    humidityValues.length > 0 ? createDomain(humidityValues, 5, 0, 100) : null;
  const fromMilliseconds = Date.parse(chart.from);
  const toMilliseconds = Date.parse(chart.to);
  const periodMilliseconds = Math.max(1, toMilliseconds - fromMilliseconds);
  const x = (timestamp: string): number => {
    const ratio = (Date.parse(timestamp) - fromMilliseconds) / periodMilliseconds;
    return plot.left + Math.max(0, Math.min(1, ratio)) * plot.width;
  };
  const y = (value: number, domain: Domain): number =>
    plot.top + plot.height - ((value - domain.min) / (domain.max - domain.min)) * plot.height;

  const temperaturePath = createPath(
    chart.points.map((point) => [x(point.timestamp), y(point.temperature, temperatureDomain)]),
  );
  const humidityPath = humidityDomain
    ? createPath(
        chart.points.flatMap((point): Array<[number, number]> =>
          point.humidity === null
            ? []
            : [[x(point.timestamp), y(point.humidity, humidityDomain)]],
        ),
      )
    : "";
  const grid = createGrid(temperatureDomain, humidityDomain, chart, timeZone);
  const lastPoint = chart.points.at(-1);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="28" fill="#f8fafc"/>
      <text x="${plot.left}" y="58" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#172033">${humidityDomain ? "Температура и влажность" : "Температура"}</text>
      <text x="${plot.left}" y="94" font-family="Arial, sans-serif" font-size="19" fill="#64748b">${escapeXml(deviceTitle)} · ${rangeTitles[chart.range]}</text>
      <circle cx="720" cy="55" r="7" fill="#ef5b5b"/>
      <text x="736" y="62" font-family="Arial, sans-serif" font-size="18" fill="#334155">Температура${lastPoint ? ` ${formatNumber(lastPoint.temperature)} °C` : ""}</text>
      ${humidityDomain ? `<circle cx="940" cy="55" r="7" fill="#3182ce"/>
      <text x="956" y="62" font-family="Arial, sans-serif" font-size="18" fill="#334155">Влажность${lastPoint?.humidity !== null && lastPoint?.humidity !== undefined ? ` ${formatNumber(lastPoint.humidity)} %` : ""}</text>` : ""}
      ${grid}
      <path d="${temperaturePath}" fill="none" stroke="#ef5b5b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      ${humidityDomain ? `<path d="${humidityPath}" fill="none" stroke="#3182ce" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
      <text x="${plot.left}" y="680" font-family="Arial, sans-serif" font-size="15" fill="#94a3b8">Усреднение: ${formatBucket(chart.bucket_seconds)} · точек: ${chart.points.length}</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

function createDomain(
  values: number[],
  minimumPadding: number,
  lowerBound?: number,
  upperBound?: number,
): Domain {
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(minimumPadding, (rawMax - rawMin) * 0.12);
  let min = rawMin - padding;
  let max = rawMax + padding;
  if (lowerBound !== undefined) min = Math.max(lowerBound, min);
  if (upperBound !== undefined) max = Math.min(upperBound, max);
  if (max === min) {
    max = min + minimumPadding * 2;
  }
  return { min, max };
}

function createPath(points: Array<[number, number]>): string {
  return points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
}

function createGrid(
  temperature: Domain,
  humidity: Domain | null,
  chart: MeasurementChart,
  timeZone: string,
): string {
  const horizontal = Array.from({ length: 6 }, (_, index) => {
    const ratio = index / 5;
    const y = plot.top + ratio * plot.height;
    const temperatureValue = temperature.max - ratio * (temperature.max - temperature.min);
    const humidityValue = humidity
      ? humidity.max - ratio * (humidity.max - humidity.min)
      : null;
    return `
      <line x1="${plot.left}" y1="${y}" x2="${plot.left + plot.width}" y2="${y}" stroke="#dbe3ed" stroke-width="1"/>
      <text x="${plot.left - 15}" y="${y + 6}" text-anchor="end" font-family="Arial, sans-serif" font-size="16" fill="#ef5b5b">${formatNumber(temperatureValue)}°</text>
      ${humidityValue !== null ? `<text x="${plot.left + plot.width + 15}" y="${y + 6}" font-family="Arial, sans-serif" font-size="16" fill="#3182ce">${formatNumber(humidityValue)}%</text>` : ""}
    `;
  }).join("");
  const from = Date.parse(chart.from);
  const to = Date.parse(chart.to);
  const vertical = Array.from({ length: 7 }, (_, index) => {
    const ratio = index / 6;
    const x = plot.left + ratio * plot.width;
    const timestamp = new Date(from + ratio * (to - from));
    return `
      <line x1="${x}" y1="${plot.top}" x2="${x}" y2="${plot.top + plot.height}" stroke="#edf1f6" stroke-width="1"/>
      <text x="${x}" y="${plot.top + plot.height + 34}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#64748b">${formatTime(timestamp, chart.range, timeZone)}</text>
    `;
  }).join("");
  return `${horizontal}${vertical}`;
}

function formatTime(date: Date, range: ChartRange, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions =
    range === "hour" || range === "day"
      ? { hour: "2-digit", minute: "2-digit", timeZone }
      : { day: "2-digit", month: "2-digit", timeZone };
  return new Intl.DateTimeFormat("ru-RU", options).format(date);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatBucket(seconds: number): string {
  if (seconds < 3_600) return `${seconds / 60} мин`;
  return `${seconds / 3_600} ч`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character] ?? character;
  });
}
