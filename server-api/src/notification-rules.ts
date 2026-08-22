export interface NotificationRuleInput {
  currentTemperature: number;
  currentHumidity: number | null;
  previousTemperature: number;
  previousHumidity: number | null;
  temperatureThreshold: number;
  humidityThreshold: number;
  cooldownSeconds: number;
  lastNotificationAt: string | null;
  measurementTimestamp: string;
}

export interface NotificationDecision {
  temperatureDelta: number;
  humidityDelta: number | null;
  temperatureTriggered: boolean;
  humidityTriggered: boolean;
}

export function evaluateNotification(input: NotificationRuleInput): NotificationDecision | null {
  if (input.lastNotificationAt !== null) {
    const elapsedMilliseconds =
      Date.parse(input.measurementTimestamp) - Date.parse(input.lastNotificationAt);
    if (elapsedMilliseconds < input.cooldownSeconds * 1_000) {
      return null;
    }
  }

  const temperatureDelta = input.currentTemperature - input.previousTemperature;
  const humidityDelta =
    input.currentHumidity !== null && input.previousHumidity !== null
      ? input.currentHumidity - input.previousHumidity
      : null;
  const temperatureTriggered = Math.abs(temperatureDelta) >= input.temperatureThreshold;
  const humidityTriggered =
    humidityDelta !== null && Math.abs(humidityDelta) >= input.humidityThreshold;

  if (!temperatureTriggered && !humidityTriggered) {
    return null;
  }

  return {
    temperatureDelta,
    humidityDelta,
    temperatureTriggered,
    humidityTriggered,
  };
}
