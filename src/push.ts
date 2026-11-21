import * as Device from "expo-device";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "OpenCode",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export function expoProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId ?? (Constants as any)?.easConfig?.projectId ?? undefined;
}

export async function getPushToken(): Promise<string> {
  if (!Device.isDevice) {
    throw new Error("Push-уведомления работают только на реальном устройстве.");
  }

  const granted = await ensureNotificationPermission();
  if (!granted) {
    throw new Error("Разрешение на уведомления не выдано. Включите его в Настройках iOS.");
  }

  const projectId = expoProjectId();
  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return token.data;
}

export type PushSubscription = {
  token: string;
  serverUrl: string;
  device?: string;
};

export async function subscribeToRelay(
  relayUrl: string,
  subscription: PushSubscription,
  relaySecret?: string,
): Promise<void> {
  const base = relayUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) {
    throw new Error("Адрес релея должен начинаться с http:// или https://");
  }
  const res = await fetch(base + "/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(relaySecret ? { "X-Relay-Token": relaySecret } : {}),
    },
    body: JSON.stringify(subscription),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Релей ответил HTTP ${res.status}`);
  }
}

export async function unsubscribeFromRelay(
  relayUrl: string,
  token: string,
  relaySecret?: string,
): Promise<void> {
  const base = relayUrl.trim().replace(/\/+$/, "");
  if (!base) return;
  await fetch(base + "/unsubscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(relaySecret ? { "X-Relay-Token": relaySecret } : {}),
    },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}

export async function sendTestPush(
  relayUrl: string,
  token?: string,
  relaySecret?: string,
): Promise<void> {
  const base = relayUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("Укажите адрес релея.");
  const res = await fetch(base + "/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(relaySecret ? { "X-Relay-Token": relaySecret } : {}),
    },
    body: JSON.stringify(token ? { token } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Релей ответил HTTP ${res.status}`);
  }
}

export function describePushError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/projectId/i.test(message)) {
    return "Нужен EAS projectId: выполните `eas init` и пересоберите приложение (в Expo Go удалённые пуши не регистрируются).";
  }
  return message;
}
