export interface NotificationRuleInput {
  currentTemperature: number;
  currentHumidity: number;
  previousTemperature: number;
  previousHumidity: number;
  temperatureThreshold: number;
  humidityThreshold: number;
  cooldownSeconds: number;
  lastNotificationAt: string | null;
  measurementTimestamp: string;
}

export interface NotificationDecision {
  temperatureDelta: number;
  humidityDelta: number;
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
  const humidityDelta = input.currentHumidity - input.previousHumidity;
  const temperatureTriggered = Math.abs(temperatureDelta) >= input.temperatureThreshold;
  const humidityTriggered = Math.abs(humidityDelta) >= input.humidityThreshold;

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
