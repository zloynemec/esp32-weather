import type { FastifyInstance } from "fastify";

import type { WeatherRepository } from "../database.js";
import type { ChartRange, MeasurementQuery, NewMeasurement } from "../types.js";

interface ChartQuery {
  device_id: string;
  range?: ChartRange;
}

const maximumClockSkewMilliseconds = 5 * 60 * 1_000;

const chartRanges = {
  hour: { durationSeconds: 3_600, bucketSeconds: 60, maxPoints: 60 },
  day: { durationSeconds: 86_400, bucketSeconds: 900, maxPoints: 96 },
  week: { durationSeconds: 604_800, bucketSeconds: 3_600, maxPoints: 168 },
  month: { durationSeconds: 2_592_000, bucketSeconds: 21_600, maxPoints: 120 },
} as const;

const measurementBodySchema = {
  type: "object",
  description: "A single reading produced by an ESP32 sensor or the local emulator.",
  additionalProperties: false,
  required: ["device_id", "measured_at", "temperature"],
  properties: {
    device_id: {
      type: "string",
      description: "Stable identifier of the sensor device.",
      minLength: 1,
      maxLength: 64,
      pattern: "^[A-Za-z0-9._-]+$",
      example: "esp32-emulator-01",
    },
    measured_at: {
      type: "string",
      format: "date-time",
      description: "Time at which the sensor captured the reading, in UTC.",
      example: "2026-08-24T12:34:00Z",
    },
    temperature: {
      type: "number",
      description: "Temperature in degrees Celsius.",
      minimum: -80,
      maximum: 100,
      example: 23.7,
    },
    humidity: {
      type: "number",
      description: "Optional relative humidity in percentage points. Omit for temperature-only sensors.",
      minimum: 0,
      maximum: 100,
      example: 56.2,
    },
    uptime: {
      type: "integer",
      description: "Optional device uptime in seconds.",
      minimum: 0,
      example: 182340,
    },
    wifi_rssi: {
      type: "integer",
      description: "Optional Wi-Fi RSSI in dBm.",
      minimum: -120,
      maximum: 0,
      example: -61,
    },
  },
} as const;

const measurementQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    device_id: {
      type: "string",
      description: "Return measurements only for this device.",
      minLength: 1,
      maxLength: 64,
      pattern: "^[A-Za-z0-9._-]+$",
      example: "esp32-emulator-01",
    },
    limit: {
      type: "integer",
      description: "Maximum number of newest measurements to return.",
      minimum: 1,
      maximum: 1000,
      default: 100,
    },
  },
} as const;

const storedMeasurementSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "device_id",
    "measured_at",
    "timestamp",
    "temperature",
    "humidity",
    "uptime",
    "wifi_rssi",
  ],
  properties: {
    id: { type: "integer", minimum: 1, example: 1 },
    device_id: { type: "string", example: "esp32-emulator-01" },
    measured_at: {
      type: "string",
      format: "date-time",
      description: "Time at which the sensor captured the reading.",
      example: "2026-08-24T12:34:00.000Z",
    },
    timestamp: {
      type: "string",
      format: "date-time",
      description: "Time at which the server accepted the measurement.",
      example: "2026-08-22T12:34:56.000Z",
    },
    temperature: { type: "number", example: 23.7 },
    humidity: { type: "number", nullable: true, example: 56.2 },
    uptime: { type: "integer", nullable: true, minimum: 0, example: 182340 },
    wifi_rssi: { type: "integer", nullable: true, minimum: -120, maximum: 0, example: -61 },
  },
} as const;

const chartPointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["timestamp", "temperature", "humidity"],
  properties: {
    timestamp: { type: "string", format: "date-time" },
    temperature: { type: "number" },
    humidity: { type: "number", nullable: true },
  },
} as const;

const validationErrorSchema = {
  type: "object",
  required: ["statusCode", "code", "error", "message"],
  properties: {
    statusCode: { type: "integer", example: 400 },
    code: { type: "string", example: "FST_ERR_VALIDATION" },
    error: { type: "string", example: "Bad Request" },
    message: { type: "string" },
  },
} as const;

export function registerMeasurementRoutes(
  app: FastifyInstance,
  repository: WeatherRepository,
  now: () => Date,
): void {
  app.post<{ Body: NewMeasurement }>(
    "/api/v1/measurements",
    {
      schema: {
        tags: ["Measurements"],
        summary: "Store a sensor measurement",
        description: "Validates a sensor reading, stores its device capture time, assigns server receipt time, and persists it in SQLite. Humidity is optional for temperature-only sensors.",
        body: measurementBodySchema,
        response: {
          201: {
            description: "Measurement accepted and stored.",
            type: "object",
            additionalProperties: false,
            required: ["measurement"],
            properties: { measurement: storedMeasurementSchema },
          },
          400: validationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const receivedAt = now();
      const measuredAt = new Date(request.body.measured_at);
      if (measuredAt.getTime() > receivedAt.getTime() + maximumClockSkewMilliseconds) {
        return reply.code(400).send({
          statusCode: 400,
          code: "MEASUREMENT_TIME_IN_FUTURE",
          error: "Bad Request",
          message: "measured_at must not be more than 5 minutes in the future",
        });
      }
      const measurement = repository.insert(
        { ...request.body, measured_at: measuredAt.toISOString() },
        receivedAt.toISOString(),
      );
      return reply.code(201).send({ measurement });
    },
  );

  app.get<{ Querystring: MeasurementQuery }>(
    "/api/v1/measurements",
    {
      schema: {
        tags: ["Measurements"],
        summary: "List recent measurements",
        description: "Returns measurements newest by sensor capture time, optionally filtered by device.",
        querystring: measurementQuerySchema,
        response: {
          200: {
            description: "Recent measurements.",
            type: "object",
            additionalProperties: false,
            required: ["measurements"],
            properties: {
              measurements: { type: "array", items: storedMeasurementSchema },
            },
          },
          400: validationErrorSchema,
        },
      },
    },
    async (request) => ({ measurements: repository.list(request.query) }),
  );

  app.get<{ Querystring: ChartQuery }>(
    "/api/v1/measurements/chart",
    {
      schema: {
        tags: ["Measurements"],
        summary: "Get an aggregated chart series",
        description: "Returns temperature averages and optional humidity averages with at most 168 points.",
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["device_id"],
          properties: {
            device_id: measurementQuerySchema.properties.device_id,
            range: {
              type: "string",
              enum: ["hour", "day", "week", "month"],
              default: "day",
            },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["chart"],
            properties: {
              chart: {
                type: "object",
                additionalProperties: false,
                required: ["device_id", "range", "from", "to", "bucket_seconds", "points"],
                properties: {
                  device_id: { type: "string" },
                  range: { type: "string", enum: ["hour", "day", "week", "month"] },
                  from: { type: "string", format: "date-time" },
                  to: { type: "string", format: "date-time" },
                  bucket_seconds: { type: "integer", minimum: 60 },
                  points: { type: "array", maxItems: 168, items: chartPointSchema },
                },
              },
            },
          },
          400: validationErrorSchema,
        },
      },
    },
    async (request) => {
      const range = request.query.range ?? "day";
      const definition = chartRanges[range];
      const to = now();
      const from = new Date(to.getTime() - definition.durationSeconds * 1_000);
      return {
        chart: {
          device_id: request.query.device_id,
          range,
          from: from.toISOString(),
          to: to.toISOString(),
          bucket_seconds: definition.bucketSeconds,
          points: repository.getChartPoints(
            request.query.device_id,
            from.toISOString(),
            to.toISOString(),
            definition.bucketSeconds,
            definition.maxPoints,
          ),
        },
      };
    },
  );
}
