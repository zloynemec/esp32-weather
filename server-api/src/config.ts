import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));
dotenv.config({ path: resolve(projectDirectory, ".env"), quiet: true });

function readPort(value: string | undefined): number {
  const port = Number(value ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, received: ${value}`);
  }
  return port;
}

export interface ServerConfig {
  host: string;
  port: number;
  databasePath: string;
  logLevel: string;
}

export function loadConfig(): ServerConfig {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: readPort(process.env.PORT),
    databasePath: resolve(projectDirectory, process.env.DATABASE_PATH ?? "data/weather.sqlite"),
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}
