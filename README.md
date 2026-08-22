# ESP32 Weather

Учебный IoT-проект: ESP32 измеряет температуру и влажность, сервер сохраняет данные,
а Telegram-бот уведомляет группу о значимых изменениях и прикладывает график за 7 дней.

## Компоненты

1. `sensor-firmware/` — C++/Arduino-прошивка для Wokwi и физической ESP32.
2. `server-api/` — HTTP API, база данных, хранение и анализ измерений.
3. `telegram-bot/` — отправка уведомлений и графиков в Telegram.
4. `docs/` — архитектура и техническое задание.

## Общая схема

ESP32 Sensor -> HTTP API -> SQLite -> Event Rules -> Telegram Bot -> Telegram Group

## MVP

- температура + влажность;
- измерение каждую минуту;
- отправка результата в API;
- хранение истории;
- Telegram-уведомление при значимом изменении параметров;
- график последних 7 дней с почасовой детализацией;
- уведомление, если датчик не передает данные более 5 минут;
- на первом этапе прошивка запускается на виртуальной ESP32 в Wokwi.

## Предлагаемый стек

### ESP32
- ESP32
- DHT22 для первого эмулируемого и физического прототипа
- C++ / Arduino framework
- PlatformIO
- Wokwi
- Wi-Fi
- HTTP/JSON

### Server API
- Node.js
- TypeScript
- Fastify
- SQLite

### Telegram Bot
- Node.js
- TypeScript
- Telegram Bot API

## Реализованный поток: Wokwi ESP32 -> API -> SQLite -> Telegram Bot

Требования:

- Node.js 22.13 или новее и npm;
- VS Code с расширениями PlatformIO IDE и Wokwi.

### 1. Запуск Server API

```bash
npm install
cp .env.example .env
npm run dev
```

SQLite-база по умолчанию создается в `data/weather.sqlite`.

### 2. Сборка прошивки

```bash
pio run --project-dir sensor-firmware
```

То же действие доступно через PlatformIO IDE: откройте `sensor-firmware/` как
PlatformIO-проект и выполните **Build**.

### 3. Запуск виртуальной ESP32

1. Откройте `sensor-firmware/diagram.json` в VS Code.
2. Нажмите зеленую кнопку запуска Wokwi.
3. В симуляторе нажмите на DHT22, чтобы менять температуру и влажность ползунками.
4. Следите за Wi-Fi, показаниями и HTTP-ответами в Serial Monitor.

Wokwi for VS Code использует локальный IoT Gateway. Из прошивки локальный API
доступен как `http://host.wokwi.internal:3000`. Первое измерение отправляется после
подключения к Wi-Fi, следующие — каждые 60 секунд.

Проверить сохраненные измерения можно через Scalar или командой:

```bash
curl 'http://127.0.0.1:3000/api/v1/measurements?device_id=esp32-wokwi-01&limit=10'
```

Интерактивная документация и тестовые формы Scalar доступны после запуска API:

- `http://127.0.0.1:3000/docs`
- OpenAPI JSON: `http://127.0.0.1:3000/openapi.json`

### Настройка устройства

Устройство автоматически регистрируется при первом принятом измерении. Посмотреть
зарегистрированные устройства:

```bash
curl 'http://127.0.0.1:3000/api/v1/devices'
```

Задать краткое описание и пороги уведомлений:

```bash
curl -X PATCH 'http://127.0.0.1:3000/api/v1/devices/esp32-wokwi-01' \
  -H 'content-type: application/json' \
  -d '{
    "description": "Датчик в рабочем кабинете",
    "temperature_delta_threshold": 1.0,
    "humidity_delta_threshold": 5.0,
    "notification_cooldown_seconds": 600
  }'
```

Правила используют абсолютную дельту относительно значения последнего
уведомления:

```text
abs(current_temperature - last_notified_temperature) >= temperature_delta_threshold
abs(current_humidity - last_notified_humidity) >= humidity_delta_threshold
```

По умолчанию пороги равны `1.0 °C` и `5` процентным пунктам, cooldown — 600 секунд.
Первое принятое измерение становится базовым и не отправляет уведомление. При
достижении одного или обоих порогов Server API атомарно сохраняет единое событие,
а бот доставляет его в группу. Во время cooldown новые события не создаются;
следующее сравнение по-прежнему выполняется со значениями последнего уведомления.

### 4. Запуск Telegram Bot

Добавьте созданного в BotFather бота в нужную группу и заполните Telegram-настройки
в корневом `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=token-from-botfather
TELEGRAM_CHAT_ID=-1001234567890
WEATHER_API_URL=http://127.0.0.1:3000
TELEGRAM_DEFAULT_DEVICE_ID=esp32-wokwi-01
TELEGRAM_TIME_ZONE=Europe/Simferopol
```

Токен нельзя коммитить. Как получить `TELEGRAM_CHAT_ID`, подробно описано в
[`telegram-bot/README.md`](telegram-bot/README.md).

Запустите бот во втором терминале, не останавливая Server API:

```bash
npm run dev:bot
```

Доступные команды в Telegram:

- `/weather` — последнее измерение датчика по умолчанию;
- `/weather <device_id>` — последнее измерение конкретного датчика;
- `/devices` — список датчиков и время последнего измерения;
- `/chart` — общий график температуры и влажности за сутки;
- `/chart hour|day|week|month` — график за час, сутки, неделю или 30 дней;
- `/chart <period> <device_id>` — график выбранного датчика;
- `/help` — справка.

Бот принимает команды только из `TELEGRAM_CHAT_ID`; бизнес-правила остаются на
стороне сервера. Помимо команд, бот каждые 2 секунды проверяет сохраненные события,
доставляет уведомление с текущими и предыдущими значениями и подтверждает доставку.
Недоставленные события остаются в SQLite для повторной попытки. График строится
локально в PNG с двумя шкалами и обеими сериями на одном временном поле. Контроль
пропажи данных будет добавлен следующим этапом.

Полезные команды:

```bash
npm test
npm run build
npm run firmware:build
```

Настройки Server API и Telegram Bot описаны в `.env.example`. Настройки прошивки и значения для
Wokwi находятся в `sensor-firmware/include/app_config.h`. Для физической платы их
можно переопределить build-флагами `WEATHER_WIFI_SSID`, `WEATHER_WIFI_PASSWORD`,
`WEATHER_SERVER_URL` и `WEATHER_DEVICE_ID`: скопируйте
`sensor-firmware/platformio_override.example.ini` в `platformio_override.ini` и
измените значения. Локальный файл исключен из Git.

Проверка на физической ESP32 на этом этапе намеренно не реализована.
