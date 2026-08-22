import type { FastifyInstance } from "fastify";

import type { WeatherRepository } from "../database.js";

interface PendingNotificationQuery {
  limit?: number;
}

interface NotificationParams {
  notification_id: number;
}

const notificationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "device_id",
    "device_description",
    "measurement_id",
    "measurement_timestamp",
    "current_temperature",
    "previous_temperature",
    "temperature_delta",
    "current_humidity",
    "previous_humidity",
    "humidity_delta",
    "temperature_triggered",
    "humidity_triggered",
    "created_at",
    "delivered_at",
  ],
  properties: {
    id: { type: "integer", minimum: 1 },
    device_id: { type: "string" },
    device_description: { type: "string", nullable: true },
    measurement_id: { type: "integer", minimum: 1 },
    measurement_timestamp: { type: "string", format: "date-time" },
    current_temperature: { type: "number" },
    previous_temperature: { type: "number" },
    temperature_delta: { type: "number" },
    current_humidity: { type: "number", nullable: true },
    previous_humidity: { type: "number", nullable: true },
    humidity_delta: { type: "number", nullable: true },
    temperature_triggered: { type: "boolean" },
    humidity_triggered: { type: "boolean" },
    created_at: { type: "string", format: "date-time" },
    delivered_at: { type: "string", format: "date-time", nullable: true },
  },
} as const;

const notFoundSchema = {
  type: "object",
  additionalProperties: false,
  required: ["statusCode", "error", "message"],
  properties: {
    statusCode: { type: "integer", example: 404 },
    error: { type: "string", example: "Not Found" },
    message: { type: "string", example: "Notification 42 was not found" },
  },
} as const;

export function registerNotificationRoutes(
  app: FastifyInstance,
  repository: WeatherRepository,
  now: () => Date,
): void {
  app.get<{ Querystring: PendingNotificationQuery }>(
    "/api/v1/notifications/pending",
    {
      schema: {
        tags: ["Notifications"],
        summary: "List notification events awaiting delivery",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["notifications"],
            properties: {
              notifications: { type: "array", items: notificationSchema },
            },
          },
        },
      },
    },
    async (request) => ({
      notifications: repository.listPendingNotifications(request.query.limit ?? 20),
    }),
  );

  app.post<{ Params: NotificationParams }>(
    "/api/v1/notifications/:notification_id/delivered",
    {
      schema: {
        tags: ["Notifications"],
        summary: "Mark a notification event as delivered",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["notification_id"],
          properties: {
            notification_id: { type: "integer", minimum: 1 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["notification"],
            properties: { notification: notificationSchema },
          },
          404: notFoundSchema,
        },
      },
    },
    async (request, reply) => {
      const notification = repository.markNotificationDelivered(
        request.params.notification_id,
        now().toISOString(),
      );
      if (notification === null) {
        return reply.code(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Notification ${request.params.notification_id} was not found`,
        });
      }
      return { notification };
    },
  );
}
