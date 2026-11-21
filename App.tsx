import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { configureNotifications } from "./src/push";
import { clearConnection, loadState, saveConnection, saveSettings } from "./src/store";
import type { Connection, SessionLite, Settings } from "./src/types";
import { colors } from "./src/theme";
import ConnectScreen from "./src/screens/ConnectScreen";
import SessionsScreen from "./src/screens/SessionsScreen";
import ChatScreen from "./src/screens/ChatScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

configureNotifications();

type Route =
  | { name: "sessions" }
  | { name: "chat"; sessionID: string; title?: string }
  | { name: "settings" }
  | { name: "connect" };

function Root() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [route, setRoute] = useState<Route>({ name: "sessions" });

  useEffect(() => {
    let alive = true;
    loadState().then((state) => {
      if (!alive) return;
      setConnection(state.connection);
      setSettings(state.settings);
    });
    return () => {
      alive = false;
    };
  }, []);

  const openFromNotification = useCallback((data: unknown) => {
    const payload = data as { sessionID?: string; title?: string } | undefined;
    if (!payload?.sessionID) return;
    setRoute({ name: "chat", sessionID: payload.sessionID, title: payload.title });
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromNotification(response.notification.request.content.data);
    });
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) openFromNotification(response.notification.request.content.data);
        return (Notifications as any).clearLastNotificationResponseAsync?.();
      })
      .catch(() => undefined);
    return () => subscription.remove();
  }, [openFromNotification]);

  async function handleConnected(next: Connection) {
    await saveConnection(next);
    setConnection(next);
    setRoute({ name: "sessions" });
  }

  async function handleSettingsChange(next: Settings) {
    setSettings(next);
    await saveSettings(next);
  }

  async function handleDisconnect() {
    await clearConnection();
    setConnection(null);
    setSettings((current) => (current ? { ...current, pushEnabled: false } : current));
    setRoute({ name: "sessions" });
  }

  function openSession(session: SessionLite) {
    setRoute({ name: "chat", sessionID: session.id, title: session.title });
  }

  if (!settings) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!connection) {
    return (
      <>
        <StatusBar style="light" />
        <ConnectScreen onConnected={handleConnected} />
      </>
    );
  }

  if (route.name === "connect") {
    return (
      <>
        <StatusBar style="light" />
        <ConnectScreen
          initial={connection}
          onConnected={handleConnected}
          onCancel={() => setRoute({ name: "settings" })}
        />
      </>
    );
  }

  if (route.name === "settings") {
    return (
      <>
        <StatusBar style="light" />
        <SettingsScreen
          connection={connection}
          settings={settings}
          onChange={handleSettingsChange}
          onChangeServer={() => setRoute({ name: "connect" })}
          onDisconnect={handleDisconnect}
          onBack={() => setRoute({ name: "sessions" })}
        />
      </>
    );
  }

  if (route.name === "chat") {
    return (
      <>
        <StatusBar style="light" />
        <ChatScreen
          connection={connection}
          session={{ id: route.sessionID, title: route.title }}
          onBack={() => setRoute({ name: "sessions" })}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <SessionsScreen
        connection={connection}
        settings={settings}
        onOpenSession={openSession}
        onOpenSettings={() => setRoute({ name: "settings" })}
        onPushBanner={() => setRoute({ name: "settings" })}
      />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
});
