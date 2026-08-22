import { WeatherBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { NotificationDispatcher } from "./notification-dispatcher.js";
import { TelegramClient } from "./telegram-client.js";
import type { BotLogger } from "./types.js";
import { WeatherApiClient } from "./weather-api-client.js";

const config = loadConfig();
const telegram = new TelegramClient(config.telegramBotToken);
const weatherApi = new WeatherApiClient(config.weatherApiUrl);
const logger: BotLogger = {
  info: (message) => console.info(message),
  error: (message, error) => console.error(message, error),
};
const bot = new WeatherBot(
  telegram,
  weatherApi,
  {
    chatId: config.telegramChatId,
    ...(config.defaultDeviceId ? { defaultDeviceId: config.defaultDeviceId } : {}),
    timeZone: config.timeZone,
  },
  logger,
);
const notificationDispatcher = new NotificationDispatcher(
  telegram,
  weatherApi,
  config.telegramChatId,
  config.timeZone,
  logger,
);
const abortController = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info(`Received ${signal}, stopping Telegram bot`);
    abortController.abort();
  });
}

async function runTelegramPolling(): Promise<void> {
  let offset = 0;
  while (!abortController.signal.aborted) {
    try {
      const updates = await telegram.getUpdates(offset, abortController.signal);
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        await bot.handleUpdate(update);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        break;
      }
      logger.error("Telegram polling failed; retrying in 2 seconds", error);
      await delay(2_000, abortController.signal);
    }
  }
}

async function runNotificationPolling(): Promise<void> {
  while (!abortController.signal.aborted) {
    try {
      await notificationDispatcher.runOnce();
    } catch (error) {
      logger.error("Notification delivery failed; retrying", error);
    }
    await delay(2_000, abortController.signal);
  }
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function run(): Promise<void> {
  const me = await telegram.getMe();
  await telegram.setMyCommands([
    { command: "weather", description: "Последнее измерение" },
    { command: "devices", description: "Список датчиков" },
    { command: "chart", description: "График температуры и влажности" },
    { command: "help", description: "Справка" },
  ]);
  logger.info(`Telegram bot @${me.username ?? me.id} started for chat ${config.telegramChatId}`);
  await Promise.all([runTelegramPolling(), runNotificationPolling()]);
}

try {
  await run();
} catch (error) {
  logger.error("Telegram bot failed to start", error);
  process.exitCode = 1;
}
