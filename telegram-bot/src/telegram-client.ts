import type { TelegramUpdate, TelegramUser } from "./types.js";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface BotCommand {
  command: string;
  description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseApiResponse<T>(value: unknown): TelegramApiResponse<T> {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new Error("Telegram API returned an invalid response");
  }
  return value as unknown as TelegramApiResponse<T>;
}

export class TelegramClient {
  readonly #apiUrl: string;

  constructor(
    token: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.#apiUrl = `https://api.telegram.org/bot${token}`;
  }

  getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe", {});
  }

  setMyCommands(commands: BotCommand[]): Promise<boolean> {
    return this.call<boolean>("setMyCommands", { commands });
  }

  sendMessage(chatId: string, text: string): Promise<unknown> {
    return this.call("sendMessage", { chat_id: chatId, text });
  }

  async sendPhoto(chatId: string, photo: Buffer, caption: string): Promise<unknown> {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", caption);
    form.set(
      "photo",
      new Blob([new Uint8Array(photo)], { type: "image/png" }),
      "weather-chart.png",
    );
    const response = await this.fetchImplementation(`${this.#apiUrl}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    const payload = parseApiResponse<unknown>(await response.json());
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(payload.description ?? `Telegram API returned HTTP ${response.status}`);
    }
    return payload.result;
  }

  getUpdates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(
      "getUpdates",
      {
        offset,
        timeout: 30,
        allowed_updates: ["message"],
      },
      signal,
    );
  }

  private async call<T>(method: string, body: object, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImplementation(`${this.#apiUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

    let payload: TelegramApiResponse<T>;
    try {
      payload = parseApiResponse<T>(await response.json());
    } catch (error) {
      if (!response.ok) {
        throw new Error(`Telegram API returned HTTP ${response.status}`, { cause: error });
      }
      throw error;
    }

    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(payload.description ?? `Telegram API returned HTTP ${response.status}`);
    }
    return payload.result;
  }
}
