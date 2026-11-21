import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ApiError,
  getMessages,
  getPermissions,
  getSession,
  interruptSession,
  isBusy,
  replyPermission,
  sendPrompt,
} from "../api";
import { basename, clock } from "../format";
import type {
  ChatMessage,
  Connection,
  ContentPart,
  PermissionDecision,
  PermissionRequest,
  SessionLite,
} from "../types";
import { colors, radii } from "../theme";

const POLL_MS = 1800;

export default function ChatScreen({
  connection,
  session,
  onBack,
}: {
  connection: Connection;
  session: { id: string; title?: string };
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<SessionLite | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const atBottom = useRef(true);
  const pollBusy = useRef(false);
  const pollTick = useRef(0);

  const refresh = useCallback(
    async (initial = false) => {
      if (pollBusy.current) return;
      pollBusy.current = true;
      try {
        const [nextMessages, nextPermissions] = await Promise.all([
          getMessages(connection, session.id),
          getPermissions(connection, session.id).catch(() => []),
        ]);
        setMessages(nextMessages);
        setPermissions(nextPermissions);
        setError(null);
        if (initial || pollTick.current++ % 5 === 0) {
          getSession(connection, session.id)
            .then(setInfo)
            .catch(() => undefined);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setError("Сессия не найдена на сервере.");
        } else {
          const message = e instanceof Error ? e.message : String(e);
          setError(
            /aborted|Network request failed/i.test(message)
              ? "Нет связи с сервером."
              : message,
          );
        }
      } finally {
        pollBusy.current = false;
        if (initial) setLoading(false);
      }
    },
    [connection, session.id],
  );

  useEffect(() => {
    refresh(true);
    const timer = setInterval(() => refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const working = Boolean(info && isBusy(info));

  async function submit() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    setError(null);
    try {
      await sendPrompt(connection, session.id, text);
      atBottom.current = true;
      setTimeout(() => refresh(), 250);
    } catch (e) {
      setInput(text);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    try {
      await interruptSession(connection, session.id);
      setTimeout(() => refresh(), 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function decide(request: PermissionRequest, decision: PermissionDecision) {
    setPermissions((current) => current.filter((item) => item.id !== request.id));
    try {
      await replyPermission(connection, session.id, request.id, decision);
      setTimeout(() => refresh(), 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      refresh();
    }
  }

  const title = info?.title?.trim() || session.title?.trim() || "Сессия";
  const subtitle = basename(info?.location?.directory) || info?.agent || "";

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onBack} style={styles.back} hitSlop={10}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {working ? "работает…" : subtitle}
          </Text>
        </View>
        {working ? (
          <Pressable onPress={stop} style={styles.stop} hitSlop={8}>
            <View style={styles.stopSquare} />
          </Pressable>
        ) : (
          <View style={styles.stopPlaceholder} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item, index) => item.id || String(index)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (atBottom.current) listRef.current?.scrollToEnd({ animated: false });
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            atBottom.current =
              contentSize.height - (contentOffset.y + layoutMeasurement.height) < 90;
          }}
          scrollEventThrottle={80}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                Отправьте сообщение, чтобы запустить агента.
              </Text>
            </View>
          }
          renderItem={({ item }) => <MessageRow message={item} />}
          ListFooterComponent={
            working ? (
              <View style={styles.typing}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.typingText}>агент работает</Text>
              </View>
            ) : undefined
          }
        />
      )}

      {error ? (
        <Pressable onPress={() => refresh()} style={styles.errorBanner}>
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
          <Text style={styles.retry}>Повторить</Text>
        </Pressable>
      ) : null}

      {permissions.map((request) => (
        <PermissionCard
          key={request.id}
          request={request}
          onDecide={(decision) => decide(request, decision)}
        />
      ))}

      <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          style={styles.input}
          placeholder="Сообщение агенту…"
          placeholderTextColor={colors.textFaint}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={20000}
        />
        <Pressable
          onPress={submit}
          disabled={!input.trim() || sending}
          style={({ pressed }) => [
            styles.send,
            (!input.trim() || sending) && styles.sendDisabled,
            pressed && { opacity: 0.7 },
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#04211b" />
          ) : (
            <Text style={styles.sendText}>↑</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.type === "user") {
    return (
      <View style={[styles.bubble, styles.userBubble]}>
        <Text style={styles.userText} selectable>
          {message.text}
        </Text>
        <Text style={styles.bubbleTime}>{clock(message.time?.created)}</Text>
      </View>
    );
  }

  if (message.type === "assistant") {
    const parts = message.content || [];
    const texts = parts.filter((part) => part.type === "text") as Extract<
      ContentPart,
      { type: "text" }
    >[];
    const tools = parts.filter((part) => part.type === "tool") as Extract<
      ContentPart,
      { type: "tool" }
    >[];
    const text = texts
      .map((part) => part.text)
      .join("\n\n")
      .trim();

    if (!text && tools.length === 0) return null;
    return (
      <View style={styles.assistantBlock}>
        {text ? (
          <View style={[styles.bubble, styles.assistantBubble]}>
            <Text style={styles.assistantText} selectable>
              {text}
            </Text>
            {message.time?.completed ? (
              <Text style={styles.bubbleTime}>{clock(message.time.completed)}</Text>
            ) : null}
          </View>
        ) : null}

        {tools.map((tool) => {
          const status = tool.state?.status || "running";
          return (
            <View key={tool.id} style={styles.toolRow}>
              <Text
                style={[
                  styles.toolIcon,
                  status === "error" && { color: colors.danger },
                  status === "completed" && { color: colors.ok },
                ]}
              >
                {status === "running" || status === "streaming" ? "◌" : status === "error" ? "✕" : "✓"}
              </Text>
              <Text style={styles.toolName} numberOfLines={1}>
                {tool.name}
              </Text>
              <Text style={styles.toolStatus}>{statusText(status)}</Text>
            </View>
          );
        })}

        {message.error?.message ? (
          <Text style={styles.assistantError}>{message.error.message}</Text>
        ) : null}
      </View>
    );
  }

  if (message.type === "idle") {
    const failed = message.outcome === "failed";
    const interrupted = message.outcome === "interrupted";
    return (
      <Text
        style={[
          styles.idle,
          failed && { color: colors.danger },
          interrupted && { color: colors.warn },
        ]}
      >
        {failed
          ? message.error?.message || "Выполнение завершилось ошибкой"
          : interrupted
            ? "Остановлено"
            : "Готово"}
      </Text>
    );
  }

  if (message.type === "system" || message.type === "synthetic") {
    return null;
  }

  return null;
}

function statusText(status: string): string {
  switch (status) {
    case "completed":
      return "готово";
    case "error":
      return "ошибка";
    case "running":
      return "выполняется";
    default:
      return "";
  }
}

function PermissionCard({
  request,
  onDecide,
}: {
  request: PermissionRequest;
  onDecide: (decision: PermissionDecision) => void;
}) {
  const resource = request.resources?.join(", ");
  return (
    <View style={styles.permission}>
      <Text style={styles.permissionTitle}>Нужно подтверждение</Text>
      <Text style={styles.permissionAction} numberOfLines={2}>
        {request.action}
        {resource ? ` · ${resource}` : ""}
      </Text>
      {request.message ? (
        <Text style={styles.permissionMessage} numberOfLines={2}>
          {request.message}
        </Text>
      ) : null}
      <View style={styles.permissionButtons}>
        <Pressable
          onPress={() => onDecide("once")}
          style={[styles.permissionButton, styles.permissionAllow]}
        >
          <Text style={styles.permissionAllowText}>Разрешить</Text>
        </Pressable>
        <Pressable
          onPress={() => onDecide("always")}
          style={[styles.permissionButton, styles.permissionGhost]}
        >
          <Text style={styles.permissionGhostText}>Всегда</Text>
        </Pressable>
        <Pressable
          onPress={() => onDecide("reject")}
          style={[styles.permissionButton, styles.permissionReject]}
        >
          <Text style={styles.permissionRejectText}>Отклонить</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.bg,
  },
  back: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.textDim, fontSize: 32, marginTop: -4 },
  headerText: { flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  subtitle: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
  stop: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#4b2529",
    backgroundColor: colors.dangerSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  stopSquare: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.danger },
  stopPlaceholder: { width: 34 },
  center: { paddingVertical: 60, alignItems: "center" },
  emptyText: { color: colors.textFaint, fontSize: 13 },
  list: { padding: 14, paddingBottom: 24, gap: 12 },
  bubble: {
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 11,
    maxWidth: "92%",
  },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.userBubble },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  userText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  assistantText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  assistantBlock: { gap: 7, alignItems: "flex-start" },
  assistantError: { color: colors.danger, fontSize: 13, paddingHorizontal: 4 },
  bubbleTime: { color: colors.textFaint, fontSize: 10, marginTop: 6, alignSelf: "flex-end" },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    maxWidth: "92%",
  },
  toolIcon: { color: colors.textDim, fontSize: 12 },
  toolName: { color: colors.textDim, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  toolStatus: { color: colors.textFaint, fontSize: 10 },
  idle: { color: colors.textFaint, fontSize: 11, alignSelf: "center", marginTop: 2 },
  typing: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  typingText: { color: colors.textDim, fontSize: 12 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 14,
    marginBottom: 8,
    padding: 11,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: "#4b2529",
  },
  errorText: { color: colors.danger, fontSize: 12, flex: 1 },
  retry: { color: colors.text, fontSize: 12, fontWeight: "700" },
  permission: {
    marginHorizontal: 14,
    marginBottom: 8,
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: "#201c12",
    borderWidth: 1,
    borderColor: "#4a3a16",
    gap: 6,
  },
  permissionTitle: { color: colors.warn, fontSize: 12, fontWeight: "800", letterSpacing: 0.3 },
  permissionAction: { color: colors.text, fontSize: 14, fontWeight: "600" },
  permissionMessage: { color: colors.textDim, fontSize: 12 },
  permissionButtons: { flexDirection: "row", gap: 8, marginTop: 6 },
  permissionButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: "center",
    borderWidth: 1,
  },
  permissionAllow: { backgroundColor: colors.accent, borderColor: colors.accent },
  permissionAllowText: { color: "#04211b", fontSize: 13, fontWeight: "700" },
  permissionGhost: { backgroundColor: colors.panelSoft, borderColor: colors.border },
  permissionGhostText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  permissionReject: { backgroundColor: colors.dangerSoft, borderColor: "#4b2529" },
  permissionRejectText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 15,
    paddingTop: 11,
    paddingBottom: 11,
    maxHeight: 120,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.28 },
  sendText: { color: "#04211b", fontSize: 22, fontWeight: "800", marginTop: -2 },
});
