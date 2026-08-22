import { formatDevices, formatMeasurement } from "./format.js";
import { renderMeasurementChart } from "./chart-renderer.js";
import type {
  BotLogger,
  ChartRange,
  Device,
  Measurement,
  MeasurementChart,
  TelegramUpdate,
} from "./types.js";

interface WeatherDataSource {
  listDevices(): Promise<Device[]>;
  getLatestMeasurement(deviceId: string): Promise<Measurement | null>;
  getMeasurementChart(deviceId: string, range: ChartRange): Promise<MeasurementChart>;
}

interface TelegramMessenger {
  sendMessage(chatId: string, text: string): Promise<unknown>;
  sendPhoto(chatId: string, photo: Buffer, caption: string): Promise<unknown>;
}

interface BotOptions {
  chatId: string;
  defaultDeviceId?: string;
  timeZone: string;
}

interface ParsedCommand {
  name: string;
  argument: string;
}

const helpText = [
  "Команды погодной станции:",
  "/weather — последнее измерение",
  "/weather <device_id> — измерение выбранного датчика",
  "/devices — список датчиков",
  "/chart [hour|day|week|month] — общий график (по умолчанию day)",
  "/chart <period> <device_id> — график выбранного датчика",
  "/help — эта справка",
].join("\n");

function parseCommand(text: string): ParsedCommand | null {
  const match = /^\/([a-z][a-z0-9_]*)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match?.[1]) {
    return null;
  }
  return { name: match[1].toLowerCase(), argument: match[2]?.trim() ?? "" };
}

export class WeatherBot {
  constructor(
    private readonly telegram: TelegramMessenger,
    private readonly weatherApi: WeatherDataSource,
    private readonly options: BotOptions,
    private readonly logger: BotLogger,
  ) {}

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text) {
      return;
    }

    const incomingChatId = String(message.chat.id);
    if (incomingChatId !== this.options.chatId) {
      this.logger.info(`Ignoring update from unconfigured chat ${incomingChatId}`);
      return;
    }

    const command = parseCommand(message.text);
    if (command === null) {
      return;
    }

    try {
      switch (command.name) {
        case "start":
        case "help":
          await this.reply(helpText);
          return;
        case "devices":
          await this.sendDevices();
          return;
        case "weather":
          await this.sendWeather(command.argument);
          return;
        case "chart":
          await this.sendChart(command.argument);
          return;
        default:
          await this.reply(`Неизвестная команда.\n\n${helpText}`);
      }
    } catch (error) {
      this.logger.error(`Failed to handle /${command.name}`, error);
      await this.reply("Не удалось получить данные погодной станции. Проверьте Server API.");
    }
  }

  private async sendDevices(): Promise<void> {
    const devices = await this.weatherApi.listDevices();
    await this.reply(formatDevices(devices, this.options.timeZone));
  }

  private async sendWeather(argument: string): Promise<void> {
    if (argument && !/^[A-Za-z0-9._-]{1,64}$/.test(argument)) {
      await this.reply("Некорректный device_id. Используйте команду /devices для выбора датчика.");
      return;
    }

    const devices = await this.weatherApi.listDevices();
    const deviceId = argument || this.options.defaultDeviceId || this.onlyDeviceId(devices);
    if (!deviceId) {
      const message = devices.length === 0
        ? "Устройства еще не зарегистрированы."
        : "Укажите датчик: /weather <device_id>\n\n" + formatDevices(devices, this.options.timeZone);
      await this.reply(message);
      return;
    }

    const device = devices.find((candidate) => candidate.device_id === deviceId);
    if (!device) {
      await this.reply(`Датчик ${deviceId} не найден. Используйте /devices.`);
      return;
    }

    const measurement = await this.weatherApi.getLatestMeasurement(deviceId);
    if (measurement === null) {
      await this.reply(`Для датчика ${deviceId} еще нет измерений.`);
      return;
    }
    await this.reply(formatMeasurement(measurement, device, this.options.timeZone));
  }

  private async sendChart(argument: string): Promise<void> {
    const parsed = this.parseChartArguments(argument);
    if (parsed === null) {
      await this.reply(
        "Использование: /chart [hour|day|week|month] [device_id]\nПо умолчанию строятся сутки.",
      );
      return;
    }
    if (parsed.deviceId && !/^[A-Za-z0-9._-]{1,64}$/.test(parsed.deviceId)) {
      await this.reply("Некорректный device_id. Используйте команду /devices для выбора датчика.");
      return;
    }

    const devices = await this.weatherApi.listDevices();
    const deviceId = parsed.deviceId || this.options.defaultDeviceId || this.onlyDeviceId(devices);
    if (!deviceId) {
      const message = devices.length === 0
        ? "Устройства еще не зарегистрированы."
        : "Укажите датчик: /chart day <device_id>\n\n" + formatDevices(devices, this.options.timeZone);
      await this.reply(message);
      return;
    }
    const device = devices.find((candidate) => candidate.device_id === deviceId);
    if (!device) {
      await this.reply(`Датчик ${deviceId} не найден. Используйте /devices.`);
      return;
    }

    const chart = await this.weatherApi.getMeasurementChart(deviceId, parsed.range);
    if (chart.points.length === 0) {
      await this.reply(`Для датчика ${deviceId} нет данных за выбранный период.`);
      return;
    }
    const deviceTitle = device.description
      ? `${device.description} (${device.device_id})`
      : device.device_id;
    const photo = await renderMeasurementChart(chart, deviceTitle, this.options.timeZone);
    await this.telegram.sendPhoto(
      this.options.chatId,
      photo,
      `Температура и влажность: ${this.rangeTitle(parsed.range)} · ${deviceTitle}`,
    );
  }

  private parseChartArguments(
    argument: string,
  ): { range: ChartRange; deviceId?: string } | null {
    const parts = argument.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return { range: "day" };
    }
    if (parts.length > 2) {
      return null;
    }
    const first = parts[0];
    if (this.isChartRange(first)) {
      return { range: first, ...(parts[1] ? { deviceId: parts[1] } : {}) };
    }
    return parts.length === 1 && first ? { range: "day", deviceId: first } : null;
  }

  private isChartRange(value: string | undefined): value is ChartRange {
    return value === "hour" || value === "day" || value === "week" || value === "month";
  }

  private rangeTitle(range: ChartRange): string {
    return {
      hour: "последний час",
      day: "последние сутки",
      week: "последние 7 дней",
      month: "последние 30 дней",
    }[range];
  }

  private onlyDeviceId(devices: Device[]): string | undefined {
    return devices.length === 1 ? devices[0]?.device_id : undefined;
  }

  private reply(text: string): Promise<unknown> {
    return this.telegram.sendMessage(this.options.chatId, text);
  }
}
