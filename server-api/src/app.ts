import scalarApiReference from "@scalar/fastify-api-reference";
import fastifySwagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";

import { WeatherRepository } from "./database.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerMeasurementRoutes } from "./routes/measurements.js";
import { registerNotificationRoutes } from "./routes/notifications.js";

export interface BuildAppOptions {
  databasePath: string;
  logger?: boolean | { level: string };
  now?: () => Date;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: {
      customOptions: {
        removeAdditional: false,
        keywords: ["example"],
      },
    },
  });
  const repository = new WeatherRepository(options.databasePath);
  const now = options.now ?? (() => new Date());

  app.register(fastifySwagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "ESP32 Weather API",
        description: "HTTP API for receiving and reading weather sensor measurements.",
        version: "0.1.0",
      },
      tags: [
        { name: "System", description: "Service health and diagnostics." },
        { name: "Devices", description: "Sensor devices and their notification settings." },
        { name: "Measurements", description: "Weather sensor measurements." },
        { name: "Notifications", description: "Durable notification delivery events." },
      ],
    },
  });

  app.register(scalarApiReference, {
    routePrefix: "/docs",
    configuration: {
      pageTitle: "ESP32 Weather API",
      theme: "purple",
    },
  });

  app.register(async (routes) => {
    routes.get(
      "/health",
      {
        schema: {
          tags: ["System"],
          summary: "Check API health",
          response: {
            200: {
              type: "object",
              additionalProperties: false,
              required: ["status"],
              properties: { status: { type: "string", example: "ok" } },
            },
          },
        },
      },
      async () => ({ status: "ok" }),
    );

    routes.get(
      "/openapi.json",
      { schema: { hide: true } },
      async () => routes.swagger(),
    );

    registerDeviceRoutes(routes, repository, now);
    registerMeasurementRoutes(routes, repository, now);
    registerNotificationRoutes(routes, repository, now);
  });

  app.addHook("onClose", async () => {
    repository.close();
  });

  return app;
}
