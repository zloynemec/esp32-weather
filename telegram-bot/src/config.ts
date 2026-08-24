import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const environmentFile = fileURLToPath(new URL("../../.env", import.meta.url));
dotenv.config({ path: environmentFile, quiet: true });

export interface BotConfig {
  telegramBotToken: string;
  telegramChatId: string;
  weatherApiUrl: string;
  defaultDeviceId?: string;
  timeZone: string;
}

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readUrl(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString().replace(/\/$/, "");
}

function readChatId(): string {
  const value = readRequired("TELEGRAM_CHAT_ID");
  if (!/^-?\d+$/.test(value)) {
    throw new Error("TELEGRAM_CHAT_ID must be an integer");
  }
  return value;
}

function readTimeZone(): string {
  const value = process.env.TELEGRAM_TIME_ZONE?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: value }).format();
  } catch {
    throw new Error(`TELEGRAM_TIME_ZONE is invalid: ${value}`);
  }
  return value;
}

export function loadConfig(): BotConfig {
  const defaultDeviceId = process.env.TELEGRAM_DEFAULT_DEVICE_ID?.trim();
  return {
    telegramBotToken: readRequired("TELEGRAM_BOT_TOKEN"),
    telegramChatId: readChatId(),
    weatherApiUrl: readUrl("WEATHER_API_URL", "http://127.0.0.1:3000"),
    ...(defaultDeviceId ? { defaultDeviceId } : {}),
    timeZone: readTimeZone(),
  };
}
