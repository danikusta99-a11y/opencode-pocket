import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createSession, isBusy, listSessions } from "../api";
import { basename, timeAgo } from "../format";
import type { Connection, SessionLite, Settings } from "../types";
import { colors, radii } from "../theme";

export default function SessionsScreen({
  connection,
  settings,
  onOpenSession,
  onOpenSettings,
  onPushBanner,
}: {
  connection: Connection;
  settings: Settings;
  onOpenSession: (session: SessionLite) => void;
  onOpenSettings: () => void;
  onPushBanner: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (options: { silent?: boolean; search?: string } = {}) => {
      const id = ++requestId.current;
      if (!options.silent) setLoading(true);
      try {
        const data = await listSessions(connection, options.search ?? search);
        if (id === requestId.current) {
          setSessions(data);
          setError(null);
        }
      } catch (e) {
        if (id === requestId.current) {
          const message = e instanceof Error ? e.message : String(e);
          setError(
            /aborted|Network request failed/i.test(message)
              ? "Нет связи с сервером. Проверьте Wi-Fi и адрес."
              : message,
          );
        }
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [connection, search],
  );

  useEffect(() => {
    load();
    const timer = setInterval(() => load({ silent: true }), 6000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => load({ search }), 300);
    return () => clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function newSession() {
    setCreating(true);
    setError(null);
    try {
      const directory =
        sessions.find((s) => s.location?.directory)?.location?.directory ?? undefined;
      const session = await createSession(connection, directory);
      onOpenSession(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const host = connection.url.replace(/^https?:\/\//, "");

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.flex}>
            <Text style={styles.title}>Сессии</Text>
            <View style={styles.hostRow}>
              <View style={styles.dot} />
              <Text style={styles.host} numberOfLines={1}>
                {host}
              </Text>
            </View>
          </View>
          <Pressable onPress={onOpenSettings} style={styles.iconButton} hitSlop={8}>
            <Text style={styles.iconText}>⚙</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Поиск по сессиям"
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      {!settings.pushEnabled ? (
        <Pressable onPress={onPushBanner} style={styles.pushBanner}>
          <Text style={styles.pushBannerIcon}>🔔</Text>
          <View style={styles.flex}>
            <Text style={styles.pushBannerTitle}>Включить уведомления</Text>
            <Text style={styles.pushBannerText}>
              Узнавайте, когда агент закончил или ждёт подтверждения
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : null}

      {error ? (
        <Pressable onPress={() => load()} style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorRetry}>Повторить</Text>
        </Pressable>
      ) : null}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.textDim}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Пока пусто</Text>
              <Text style={styles.emptyText}>
                Запустите сессию в OpenCode на компьютере или создайте новую здесь.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const busy = isBusy(item);
          return (
            <Pressable
              onPress={() => onOpenSession(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.rowTop}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title?.trim() || "Без названия"}
                </Text>
                <Text style={styles.rowTime}>{timeAgo(item.time?.updated)}</Text>
              </View>
              <View style={styles.rowBottom}>
                <Text style={styles.rowDir} numberOfLines={1}>
                  {basename(item.location?.directory) || "OpenCode"}
                </Text>
                {busy ? (
                  <View style={styles.busyPill}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={styles.busyText}>работает</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />

      <Pressable
        onPress={newSession}
        disabled={creating}
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 20 },
          pressed && styles.rowPressed,
        ]}
      >
        {creating ? (
          <ActivityIndicator color="#04211b" />
        ) : (
          <Text style={styles.fabText}>＋</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 18, paddingTop: 12, gap: 14 },
  headerTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { color: colors.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.6 },
  hostRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok },
  host: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { color: colors.textDim, fontSize: 18 },
  search: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  pushBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 18,
    marginTop: 12,
    padding: 14,
    borderRadius: radii.md,
    backgroundColor: colors.accentDark,
    borderWidth: 1,
    borderColor: "#1e5c50",
  },
  pushBannerIcon: { fontSize: 20 },
  pushBannerTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  pushBannerText: { color: colors.textDim, fontSize: 12, marginTop: 2, lineHeight: 16 },
  chevron: { color: colors.textDim, fontSize: 22 },
  errorBanner: {
    marginHorizontal: 18,
    marginTop: 12,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: "#4b2529",
    gap: 4,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  errorRetry: { color: colors.text, fontSize: 12, fontWeight: "700" },
  list: { padding: 18, paddingBottom: 120, gap: 10 },
  row: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radii.lg,
    padding: 15,
    gap: 10,
  },
  rowPressed: { opacity: 0.65 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "600", flex: 1, lineHeight: 21 },
  rowTime: { color: colors.textFaint, fontSize: 11, marginTop: 3 },
  rowBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowDir: { color: colors.textDim, fontSize: 12, flex: 1 },
  rowIdle: { color: colors.textFaint, fontSize: 11 },
  busyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accentDark,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  busyText: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 70, paddingHorizontal: 30, gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  emptyText: { color: colors.textDim, fontSize: 14, lineHeight: 20, textAlign: "center" },
  fab: {
    position: "absolute",
    right: 22,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabText: { color: "#04211b", fontSize: 28, fontWeight: "700", marginTop: -2 },
});
