import type { FastifyInstance } from "fastify";

import type { WeatherRepository } from "../database.js";
import type { UpdateDevice } from "../types.js";

interface DeviceParams {
  device_id: string;
}

const deviceIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: "^[A-Za-z0-9._-]+$",
  example: "esp32-wokwi-01",
} as const;

const deviceParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["device_id"],
  properties: { device_id: deviceIdSchema },
} as const;

const deviceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "device_id",
    "description",
    "temperature_delta_threshold",
    "humidity_delta_threshold",
    "notification_cooldown_seconds",
    "created_at",
    "updated_at",
    "last_seen_at",
  ],
  properties: {
    device_id: deviceIdSchema,
    description: {
      type: "string",
      nullable: true,
      maxLength: 200,
      description: "Short human-readable description of the device.",
      example: "Wokwi sensor in the study room",
    },
    temperature_delta_threshold: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 180,
      description: "Notify when the absolute temperature delta reaches this value in degrees Celsius.",
      example: 1,
    },
    humidity_delta_threshold: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 100,
      description: "Notify when the absolute humidity delta reaches this many percentage points.",
      example: 5,
    },
    notification_cooldown_seconds: {
      type: "integer",
      minimum: 0,
      maximum: 86400,
      description: "Minimum interval between change notifications in seconds.",
      example: 600,
    },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    last_seen_at: { type: "string", format: "date-time", nullable: true },
  },
} as const;

const updateDeviceSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    description: {
      type: "string",
      nullable: true,
      maxLength: 200,
      description: "Short human-readable description, or null to clear it.",
      example: "Wokwi sensor in the study room",
    },
    temperature_delta_threshold: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 180,
      description: "Absolute temperature delta in degrees Celsius.",
      example: 1,
    },
    humidity_delta_threshold: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 100,
      description: "Absolute humidity delta in percentage points.",
      example: 5,
    },
    notification_cooldown_seconds: {
      type: "integer",
      minimum: 0,
      maximum: 86400,
      description: "Minimum interval between change notifications in seconds.",
      example: 600,
    },
  },
} as const;

const notFoundSchema = {
  type: "object",
  additionalProperties: false,
  required: ["statusCode", "error", "message"],
  properties: {
    statusCode: { type: "integer", example: 404 },
    error: { type: "string", example: "Not Found" },
    message: { type: "string", example: "Device esp32-wokwi-01 was not found" },
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

export function registerDeviceRoutes(
  app: FastifyInstance,
  repository: WeatherRepository,
  now: () => Date,
): void {
  app.get(
    "/api/v1/devices",
    {
      schema: {
        tags: ["Devices"],
        summary: "List registered devices",
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["devices"],
            properties: { devices: { type: "array", items: deviceSchema } },
          },
        },
      },
    },
    async () => ({ devices: repository.listDevices() }),
  );

  app.get<{ Params: DeviceParams }>(
    "/api/v1/devices/:device_id",
    {
      schema: {
        tags: ["Devices"],
        summary: "Get device configuration",
        params: deviceParamsSchema,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["device"],
            properties: { device: deviceSchema },
          },
          400: validationErrorSchema,
          404: notFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const device = repository.getDevice(request.params.device_id);
      if (device === null) {
        return reply.code(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Device ${request.params.device_id} was not found`,
        });
      }
      return { device };
    },
  );

  app.patch<{ Params: DeviceParams; Body: UpdateDevice }>(
    "/api/v1/devices/:device_id",
    {
      schema: {
        tags: ["Devices"],
        summary: "Update device description and notification thresholds",
        description:
          "Thresholds use absolute deltas relative to the values associated with the last notification.",
        params: deviceParamsSchema,
        body: updateDeviceSchema,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["device"],
            properties: { device: deviceSchema },
          },
          400: validationErrorSchema,
          404: notFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const device = repository.updateDevice(
        request.params.device_id,
        request.body,
        now().toISOString(),
      );
      if (device === null) {
        return reply.code(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Device ${request.params.device_id} was not found`,
        });
      }
      return { device };
    },
  );
}
