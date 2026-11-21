import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { defaultSettings } from "./types";
import type { Connection, SavedState, Settings } from "./types";

const CONNECTION_KEY = "opencode-pocket.connection";
const SETTINGS_KEY = "opencode-pocket.settings";
const PASSWORD_KEY = "opencode-pocket.password";

type StoredConnection = Omit<Connection, "password">;

export async function loadState(): Promise<SavedState> {
  const [connectionRaw, settingsRaw, password] = await Promise.all([
    AsyncStorage.getItem(CONNECTION_KEY),
    AsyncStorage.getItem(SETTINGS_KEY),
    SecureStore.getItemAsync(PASSWORD_KEY).catch(() => null),
  ]);

  let connection: Connection | null = null;
  if (connectionRaw && password) {
    try {
      const stored = JSON.parse(connectionRaw) as StoredConnection;
      if (stored?.url) connection = { ...stored, password };
    } catch {
      connection = null;
    }
  }

  let settings: Settings = defaultSettings;
  if (settingsRaw) {
    try {
      settings = { ...defaultSettings, ...(JSON.parse(settingsRaw) as Settings) };
    } catch {
      settings = defaultSettings;
    }
  }

  return { connection, settings };
}

export async function saveConnection(connection: Connection): Promise<void> {
  const { password, ...rest } = connection;
  await Promise.all([
    AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(rest)),
    SecureStore.setItemAsync(PASSWORD_KEY, password),
  ]);
}

export async function clearConnection(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(CONNECTION_KEY),
    SecureStore.deleteItemAsync(PASSWORD_KEY).catch(() => undefined),
  ]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
