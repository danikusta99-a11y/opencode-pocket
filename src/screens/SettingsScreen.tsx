import React, { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ping } from "../api";
import {
  describePushError,
  ensureNotificationPermission,
  expoProjectId,
  getPushToken,
  sendTestPush,
  subscribeToRelay,
  unsubscribeFromRelay,
} from "../push";
import type { Connection, Settings } from "../types";
import { colors, radii } from "../theme";
import { ErrorText, Field, GhostButton, PrimaryButton } from "../components/ui";

export default function SettingsScreen({
  connection,
  settings,
  onChange,
  onChangeServer,
  onDisconnect,
  onBack,
}: {
  connection: Connection;
  settings: Settings;
  onChange: (settings: Settings) => void;
  onChangeServer: () => void;
  onDisconnect: () => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [relayUrl, setRelayUrl] = useState(settings.relayUrl);
  const [relaySecret, setRelaySecret] = useState(settings.relaySecret);
  const [pushBusy, setPushBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const projectId = expoProjectId();

  async function saveAndEnablePush() {
    setPushBusy(true);
    setPushError(null);
    setPushStatus(null);
    try {
      const next: Settings = { ...settings, relayUrl: relayUrl.trim(), relaySecret };
      if (!next.relayUrl) throw new Error("Укажите адрес релея, например http://192.168.1.20:8787");
      const token = await getPushToken();
      await subscribeToRelay(
        next.relayUrl,
        {
          token,
          serverUrl: connection.url,
          device: Device.deviceName ?? "iPhone",
        },
        next.relaySecret || undefined,
      );
      onChange({ ...next, pushEnabled: true, pushToken: token });
      setPushStatus("Готово: этот iPhone подписан на уведомления.");
    } catch (e) {
      setPushError(describePushError(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function testNotification() {
    setTestBusy(true);
    setPushError(null);
    setPushStatus(null);
    try {
      await sendTestPush(
        relayUrl || settings.relayUrl,
        settings.pushToken,
        relaySecret || undefined,
      );
      setPushStatus("Тест отправлен. Пуш должен прийти в течение нескольких секунд.");
    } catch (e) {
      setPushError(describePushError(e));
    } finally {
      setTestBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    setPushError(null);
    setPushStatus(null);
    try {
      if (settings.pushToken) {
        await unsubscribeFromRelay(settings.relayUrl, settings.pushToken, settings.relaySecret || undefined);
      }
    } finally {
      onChange({ ...settings, pushEnabled: false });
      setPushBusy(false);
      setPushStatus("Уведомления выключены.");
    }
  }

  async function checkConnection() {    setCheckBusy(true);
    setCheckResult(null);
    const started = Date.now();
    try {
      const info = await ping(connection);
      setCheckResult(
        `Сервер ${info.version}${info.hostname ? ` · ${info.hostname}` : ""} · ${Date.now() - started} мс`,
      );
    } catch (e) {
      setCheckResult(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckBusy(false);
    }
  }

  function confirmDisconnect() {
    Alert.alert("Отключиться?", "Пароль и адрес сервера будут удалены с телефона.", [
      { text: "Отмена", style: "cancel" },
      { text: "Отключиться", style: "destructive", onPress: onDisconnect },
    ]);
  }

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Настройки</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Section title="Сервер">
          <Text style={styles.value}>{connection.url}</Text>
          <Text style={styles.muted}>
            {connection.label ? `${connection.label} · ` : ""}пользователь {connection.username}
          </Text>
          <View style={styles.row}>
            <GhostButton title="Проверить связь" onPress={checkConnection} style={styles.flex} />
            <GhostButton title="Сменить" onPress={onChangeServer} style={styles.flex} />
          </View>
          {checkBusy ? <Text style={styles.muted}>Проверяем…</Text> : null}
          {checkResult ? <Text style={styles.value}>{checkResult}</Text> : null}
        </Section>

        <Section title="Push-уведомления">
          <Text style={styles.muted}>
            Релей слушает события OpenCode на компьютере и отправляет пуши через Expo. Он должен
            быть запущен, пока вы ждёте уведомления.
          </Text>
          <Field
            label="Адрес релея"
            placeholder="http://192.168.1.20:8787"
            value={relayUrl}
            onChangeText={setRelayUrl}
            keyboardType="url"
          />
          <Field
            label="Секрет релея (необязательно)"
            placeholder="RELAY_TOKEN"
            value={relaySecret}
            onChangeText={setRelaySecret}
            secureTextEntry
          />

          <View style={styles.row}>
            <GhostButton title="Проверить разрешение" onPress={() => ensureNotificationPermission()} style={styles.flex} />
            <GhostButton
              title={settings.pushEnabled ? "Обновить" : "Включить"}
              onPress={saveAndEnablePush}
              style={styles.flex}
            />
          </View>
          {settings.pushEnabled ? (
            <GhostButton title="Выключить уведомления" danger onPress={disablePush} />
          ) : null}
          {settings.pushEnabled ? (
            <GhostButton
              title={testBusy ? "Отправляем…" : "Отправить тестовый пуш"}
              onPress={testNotification}
            />
          ) : null}

          {pushBusy ? <Text style={styles.muted}>Регистрируем…</Text> : null}
          {pushStatus ? <Text style={[styles.value, { color: colors.ok }]}>{pushStatus}</Text> : null}
          <ErrorText>{pushError}</ErrorText>

          {settings.pushToken ? (
            <Text style={styles.token} numberOfLines={1}>
              token: {settings.pushToken}
            </Text>
          ) : null}
          {!projectId ? (
            <Text style={styles.warning}>
              EAS projectId не задан. Для удалённых пушей соберите приложение через EAS
              (`eas init`, затем `eas build`). В Expo Go пуши на iOS могут не регистрироваться.
            </Text>
          ) : null}
        </Section>

        <Section title="О приложении">
          <Text style={styles.muted}>
            OpenCode Pocket {Constants.expoConfig?.version ?? "1.0.0"} · неофициальный клиент.
            Работает с OpenCode 2 по HTTP API.
          </Text>
        </Section>

        <GhostButton title="Отключиться от сервера" danger onPress={confirmDisconnect} />
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  back: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.textDim, fontSize: 32, marginTop: -4 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  content: { padding: 16, gap: 22 },
  section: { gap: 8 },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radii.lg,
    padding: 14,
    gap: 12,
  },
  row: { flexDirection: "row", gap: 8 },
  value: { color: colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  warning: { color: colors.warn, fontSize: 12, lineHeight: 17 },
  token: { color: colors.textFaint, fontSize: 10 },
});
