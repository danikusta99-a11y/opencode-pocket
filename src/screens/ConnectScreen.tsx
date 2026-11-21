import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  connectWithPairingLink,
  normalizeConnection,
  ping,
} from "../api";
import type { Connection } from "../types";
import { colors, radii } from "../theme";
import { ErrorText, Field, GhostButton, PrimaryButton } from "../components/ui";

type Mode = "pair" | "manual";

export default function ConnectScreen({
  initial,
  onConnected,
  onCancel,
}: {
  initial?: Connection | null;
  onConnected: (connection: Connection) => void;
  onCancel?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>(initial ? "manual" : "pair");
  const [link, setLink] = useState("");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const scanHandled = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();

  async function finish(connection: Connection) {
    setBusy(true);
    setError(null);
    try {
      const normalized = normalizeConnection(connection);
      await ping(normalized);
      onConnected(normalized);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        /aborted|Network request failed/i.test(message)
          ? "Сервер не отвечает. Проверьте, что телефон и компьютер в одной сети и сервер слушает 0.0.0.0."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function connectByLink(value: string) {
    if (!value.trim()) {
      setError("Вставьте ссылку из `opencode pair`.");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const connection = await connectWithPairingLink(value);
      await finish(connection);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function connectManual() {
    if (!url.trim() || !password.trim()) {
      setError("Нужны адрес сервера и пароль (или токен).");
      return;
    }
    await finish({
      url,
      username: "opencode",
      password: password.trim(),
      label: url.replace(/^https?:\/\//, ""),
    });
  }

  async function openScanner() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    scanHandled.current = false;
    setScannerVisible(true);
  }
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logo}>
          <Text style={styles.logoText}>{"</>"}</Text>
        </View>
        <Text style={styles.title}>OpenCode Pocket</Text>
        <Text style={styles.subtitle}>
          Пульт для OpenCode на вашем компьютере: сессии, ответы и push-уведомления.
        </Text>

        <View style={styles.tabs}>
          <Tab title="По QR / ссылке" active={mode === "pair"} onPress={() => setMode("pair")} />
          <Tab title="URL + пароль" active={mode === "manual"} onPress={() => setMode("manual")} />
        </View>

        {mode === "pair" ? (
          <View style={styles.block}>
            <Field
              label="Ссылка подключения"
              placeholder="http://192.168.1.20:4096/auth/connect/…"
              value={link}
              onChangeText={setLink}
              multiline
              hint={
                "На компьютере выполните `opencode pair`. Ссылка одноразовая и живёт 5 минут.\n" +
                "Чтобы телефон её открыл, сервер должен слушать 0.0.0.0: `opencode service set hostname 0.0.0.0`."
              }
            />
            <PrimaryButton
              title="Подключиться"
              onPress={() => connectByLink(link)}
              loading={busy}
            />
            <GhostButton title="Сканировать QR-код" onPress={openScanner} />
          </View>
        ) : (
          <View style={styles.block}>
            <Field
              label="Адрес сервера"
              placeholder="http://192.168.1.20:4096"
              value={url}
              onChangeText={setUrl}
              keyboardType="url"
              hint="Порт и адрес видны в `opencode service status` или в QR-ссылке."
            />
            <Field
              label="Пароль"
              placeholder="OPENCODE_SERVER_PASSWORD"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <PrimaryButton title="Подключиться" onPress={connectManual} loading={busy} />
          </View>
        )}

        <ErrorText>{error}</ErrorText>

        {onCancel ? (
          <GhostButton title="Отмена" onPress={onCancel} style={styles.cancel} />
        ) : (
          <Text style={styles.footnote}>
            Подключение хранится только на этом iPhone (пароль — в Keychain).
          </Text>
        )}
      </ScrollView>

      <Modal
        visible={scannerVisible}
        animationType="slide"
        onRequestClose={() => setScannerVisible(false)}
      >
        <View style={styles.scanner}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (scanHandled.current) return;
              scanHandled.current = true;
              setScannerVisible(false);
              setLink(data);
              connectByLink(data);
            }}
          />
          <View style={[styles.scannerOverlay, { paddingTop: insets.top + 16 }]}>
            <Text style={styles.scannerTitle}>Наведите камеру на QR-код</Text>
            <Text style={styles.scannerHint}>
              Код печатает `opencode pair` на компьютере
            </Text>
          </View>
          <Pressable
            style={[styles.scannerClose, { bottom: insets.bottom + 28 }]}
            onPress={() => setScannerVisible(false)}
          >
            <Text style={styles.scannerCloseText}>Закрыть</Text>
          </Pressable>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Tab({
  title,
  active,
  onPress,
}: {
  title: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: 24, gap: 16 },
  logo: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: colors.accentDark,
    borderWidth: 1,
    borderColor: "#1e5c50",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: colors.accent, fontSize: 23, fontWeight: "800" },
  title: { color: colors.text, fontSize: 32, fontWeight: "800", letterSpacing: -0.6 },
  subtitle: { color: colors.textDim, fontSize: 15, lineHeight: 22, marginBottom: 6 },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.panel,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: colors.panelSoft },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: colors.text },
  block: { gap: 14, marginTop: 4 },
  cancel: { marginTop: 8 },
  footnote: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginTop: 10 },
  scanner: { flex: 1, backgroundColor: "#000" },
  scannerOverlay: { paddingHorizontal: 24, gap: 6 },
  scannerTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  scannerHint: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  scannerClose: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  scannerCloseText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
