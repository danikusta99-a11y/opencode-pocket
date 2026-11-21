#!/usr/bin/env node
/**
 * OpenCode Pocket push relay.
 *
 * Subscribes to the OpenCode event stream and forwards "agent finished",
 * "permission requested" and "execution failed" events to Expo Push,
 * Telegram and/or ntfy.
 *
 * Config (env vars override relay.config.json):
 *   OPENCODE_URL        e.g. http://127.0.0.1:28894
 *   OPENCODE_USERNAME   default: opencode
 *   OPENCODE_PASSWORD   server password / pairing token
 *   PORT                default: 8787
 *   RELAY_TOKEN         optional shared secret required from the app
 *   TELEGRAM_BOT_TOKEN  Telegram bot token from @BotFather
 *   TELEGRAM_CHAT_ID    your chat id (see getUpdates)
 *   NTFY_TOPIC          ntfy topic, e.g. opencode-pocket-8f3a
 *   NTFY_URL            default: https://ntfy.sh
 *   NTFY_TOKEN          optional ntfy access token
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(DIR, "relay.config.json");
const SUBS_PATH = path.join(DIR, "relay-subscriptions.json");
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const fileConfig = readJson(CONFIG_PATH) ?? {};
const config = {
  opencodeUrl: (process.env.OPENCODE_URL || fileConfig.opencodeUrl || "http://127.0.0.1:28894").replace(/\/+$/, ""),
  username: process.env.OPENCODE_USERNAME || fileConfig.username || "opencode",
  password: process.env.OPENCODE_PASSWORD || fileConfig.password || "",
  port: Number(process.env.PORT || fileConfig.port || 8787),
  relayToken: process.env.RELAY_TOKEN ?? fileConfig.relayToken ?? "",
  notify: {
    idle: true,
    permission: true,
    failure: true,
    ...(fileConfig.notify || {}),
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || fileConfig.telegram?.token || "",
    chatId: String(process.env.TELEGRAM_CHAT_ID || fileConfig.telegram?.chatId || ""),
  },
  ntfy: {
    topic: process.env.NTFY_TOPIC || fileConfig.ntfy?.topic || "",
    url: (process.env.NTFY_URL || fileConfig.ntfy?.url || "https://ntfy.sh").replace(/\/+$/, ""),
    token: process.env.NTFY_TOKEN || fileConfig.ntfy?.token || "",
  },
};

/** @type {{token:string,serverUrl?:string,device?:string,addedAt:number}[]} */
let subscriptions = normalizeSubscriptions(readJson(SUBS_PATH));
const titleCache = new Map();
const idleSentAt = new Map();
let streamConnected = false;
let lastEventAt = 0;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeSubscriptions() {
  try {
    fs.writeFileSync(SUBS_PATH, JSON.stringify(subscriptions, null, 2));
  } catch (error) {
    log("Не удалось сохранить подписки:", error.message);
  }
}

function normalizeSubscriptions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item.token === "string" && item.token.length > 10);
}

const authHeader =
  "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64");

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(pathname) {
  const res = await fetch(config.opencodeUrl + pathname, {
    headers: { Accept: "application/json", Authorization: authHeader },
  });
  if (!res.ok) throw new Error(`OpenCode HTTP ${res.status} for ${pathname}`);
  return res.json();
}

async function sessionInfo(sessionID) {
  const cached = titleCache.get(sessionID);
  if (cached && Date.now() - cached.at < 60_000) return cached;
  try {
    const response = await api(`/api/session/${sessionID}`);
    const session = response?.data || response;
    const info = {
      title: session?.title?.trim() || "OpenCode",
      outcome: session?.outcome,
      at: Date.now(),
    };
    titleCache.set(sessionID, info);
    return info;
  } catch {
    return { title: "OpenCode", outcome: undefined, at: Date.now() };
  }
}

async function sessionTitle(sessionID) {
  return (await sessionInfo(sessionID)).title;
}

async function lastAssistantText(sessionID) {
  try {
    const data = await api(`/api/session/${sessionID}/message?order=desc&limit=8`);
    for (const message of data?.data || []) {
      if (message.type === "assistant") {
        const text = (message.content || [])
          .filter((part) => part.type === "text" && part.text)
          .map((part) => part.text)
          .join("\n\n")
          .trim();
        if (text) return text;
      }
      if (message.type === "idle" && message.outcome === "failed" && message.error?.message) {
        return message.error.message;
      }
    }
  } catch {
    /* the summary is best effort */
  }
  return "";
}

function short(text, max = 180) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

async function sendExpoPush(messages) {
  if (messages.length === 0) return;
  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));

  for (const chunk of chunks) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });
      const data = await res.json().catch(() => null);
      const errors = (data?.data || []).filter((ticket) => ticket.status === "error");
      log(`push: ${chunk.length} → HTTP ${res.status}${errors.length ? `, ошибок: ${errors.length}` : ""}`);
      if (errors.length) log(JSON.stringify(errors.slice(0, 3)));
    } catch (error) {
      log("push error:", error.message);
    }
  }
}

async function sendTelegram(payload) {
  if (!config.telegram.token || !config.telegram.chatId) return;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegram.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: `🔔 ${payload.title}\n${payload.body}`,
          disable_web_page_preview: true,
        }),
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      log("telegram:", data?.description || `HTTP ${res.status}`);
    } else {
      log("telegram: отправлено");
    }
  } catch (error) {
    log("telegram error:", error.message);
  }
}

async function sendNtfy(payload) {
  if (!config.ntfy.topic) return;
  try {
    const res = await fetch(
      `${config.ntfy.url}/${encodeURIComponent(config.ntfy.topic)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          Title: "OpenCode Pocket",
          Tags: "bell",
          ...(config.ntfy.token ? { Authorization: `Bearer ${config.ntfy.token}` } : {}),
        },
        body: `${payload.title}\n${payload.body}`,
      },
    );
    if (!res.ok) {
      log("ntfy: HTTP", res.status, (await res.text()).slice(0, 160));
    } else {
      log("ntfy: отправлено");
    }
  } catch (error) {
    log("ntfy error:", error.message);
  }
}

function sendExternal(payload) {
  return [sendTelegram(payload), sendNtfy(payload)];
}

function hasExternalChannel() {
  return Boolean(config.telegram.token && config.telegram.chatId) || Boolean(config.ntfy.topic);
}

async function broadcast(payload) {
  const tasks = [];
  if (subscriptions.length > 0) {
    const messages = subscriptions.map((sub) => ({
      to: sub.token,
      sound: "default",
      priority: "high",
      title: payload.title,
      body: payload.body,
      data: payload.data,
    }));
    tasks.push(sendExpoPush(messages));
  } else if (!hasExternalChannel()) {
    log("событие есть, но каналы уведомлений не настроены:", payload.title);
    return;
  }
  tasks.push(...sendExternal(payload));
  await Promise.allSettled(tasks);
}

async function handleEvent(event) {
  const type = event?.type;
  const data = event?.data || {};
  const sessionID = data.sessionID;
  if (!sessionID) return;
  lastEventAt = Date.now();

  if (type === "session.idle" && config.notify.idle) {
    const last = idleSentAt.get(sessionID) || 0;
    if (Date.now() - last < 4000) return;
    idleSentAt.set(sessionID, Date.now());

    const [info, summary] = await Promise.all([
      sessionInfo(sessionID),
      lastAssistantText(sessionID),
    ]);
    const failed = info.outcome === "failed";
    await broadcast({
      title: info.title,
      body:
        short(summary) ||
        (failed ? "Выполнение завершилось ошибкой" : "Агент закончил работу"),
      data: { sessionID, title: info.title, kind: "idle" },
    });
    return;
  }

  if (type === "permission.asked" && config.notify.permission) {
    const title = await sessionTitle(sessionID);
    const resource = (data.resources || [])[0];
    await broadcast({
      title,
      body: short(`Нужно подтверждение: ${data.action}${resource ? ` · ${resource}` : ""}`, 160),
      data: { sessionID, title, kind: "permission" },
    });
    return;
  }

  if (type === "session.execution.failed" && config.notify.failure) {
    const title = await sessionTitle(sessionID);
    await broadcast({
      title,
      body: short(data.error?.message || "Выполнение завершилось ошибкой"),
      data: { sessionID, title, kind: "error" },
    });
  }
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  let eventName = "";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.type && eventName) parsed.type = eventName;
    return parsed;
  } catch {
    return null;
  }
}

async function eventLoop() {
  const types = ["session.idle", "permission.asked", "session.execution.failed"];
  const url =
    config.opencodeUrl +
    "/api/event?" +
    types.map((type) => `types=${encodeURIComponent(type)}`).join("&");

  while (true) {
    try {
      log("подключаюсь к", url);
      const res = await fetch(url, {
        headers: { Accept: "text/event-stream", Authorization: authHeader },
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      streamConnected = true;
      log("поток событий открыт");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const event = parseSseBlock(block);
          if (event) handleEvent(event).catch((error) => log("handleEvent:", error.message));
        }
      }
    } catch (error) {
      log("поток прерван:", error.message);
    }
    streamConnected = false;
    await sleep(3000);
  }
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Relay-Token");
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function authorized(req) {
  if (!config.relayToken) return true;
  return req.headers["x-relay-token"] === config.relayToken;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    json(res, 200, {
      ok: true,
      service: "opencode-pocket-relay",
      opencodeUrl: config.opencodeUrl,
      streamConnected,
      subscriptions: subscriptions.length,
      lastEventAt: lastEventAt || null,
      channels: {
        expo: subscriptions.length > 0,
        telegram: Boolean(config.telegram.token && config.telegram.chatId),
        ntfy: Boolean(config.ntfy.topic),
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/subscribe") {
    if (!authorized(req)) return json(res, 401, { error: "invalid relay token" });
    try {
      const body = await readBody(req);
      const token = String(body.token || "").trim();
      if (!/^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(token)) {
        return json(res, 400, { error: "invalid Expo push token" });
      }
      subscriptions = [
        ...subscriptions.filter((item) => item.token !== token),
        {
          token,
          serverUrl: body.serverUrl,
          device: body.device,
          addedAt: Date.now(),
        },
      ];
      writeSubscriptions();
      log(`подписка: ${body.device || "устройство"} (всего ${subscriptions.length})`);
      return json(res, 200, { ok: true, subscriptions: subscriptions.length });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/unsubscribe") {
    if (!authorized(req)) return json(res, 401, { error: "invalid relay token" });
    try {
      const body = await readBody(req);
      const before = subscriptions.length;
      subscriptions = subscriptions.filter((item) => item.token !== body.token);
      if (subscriptions.length !== before) writeSubscriptions();
      return json(res, 200, { ok: true, subscriptions: subscriptions.length });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/test") {
    if (!authorized(req)) return json(res, 401, { error: "invalid relay token" });
    try {
      const body = await readBody(req);
      const targets = body.token ? [{ token: body.token }] : subscriptions;
      const payload = {
        title: "OpenCode Pocket",
        body: "Тестовое уведомление: связка работает.",
        data: { kind: "test" },
      };
      const tasks = [];
      if (targets.length > 0) {
        tasks.push(
          sendExpoPush(
            targets.map((item) => ({
              to: item.token,
              sound: "default",
              title: payload.title,
              body: payload.body,
              data: payload.data,
            })),
          ),
        );
      }
      if (hasExternalChannel()) tasks.push(...sendExternal(payload));
      if (tasks.length === 0) return json(res, 400, { error: "no notification channels configured" });
      await Promise.allSettled(tasks);
      return json(res, 200, {
        ok: true,
        sent: targets.length,
        telegram: Boolean(config.telegram.token && config.telegram.chatId),
        ntfy: Boolean(config.ntfy.topic),
      });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  json(res, 404, { error: "not found" });
});

if (!config.password) {
  log("ВНИМАНИЕ: OPENCODE_PASSWORD не задан. Если сервер требует пароль, релей не сможет подключиться.");
}

server.listen(config.port, "0.0.0.0", () => {
  log(`релей слушает http://0.0.0.0:${config.port}`);
  log(`OpenCode: ${config.opencodeUrl}`);
  log(`подписок в файле: ${subscriptions.length}`);
  const channels = [
    subscriptions.length > 0 ? `expo (${subscriptions.length})` : null,
    config.telegram.token && config.telegram.chatId ? "telegram" : null,
    config.ntfy.topic ? `ntfy (${config.ntfy.topic})` : null,
  ].filter(Boolean);
  log(`каналы: ${channels.length ? channels.join(", ") : "не настроены"}`);
  eventLoop();
});
