import type {
  ChatMessage,
  Connection,
  PermissionDecision,
  PermissionRequest,
  SessionLite,
} from "./types";

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function base64(input: string): string {
  const bytes = utf8Bytes(input);
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : NaN;
    const c = i + 2 < bytes.length ? bytes[i + 2] : NaN;
    const triplet = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
    output += BASE64_CHARS[(triplet >> 18) & 63];
    output += BASE64_CHARS[(triplet >> 12) & 63];
    output += isNaN(b) ? "=" : BASE64_CHARS[(triplet >> 6) & 63];
    output += isNaN(c) ? "=" : BASE64_CHARS[triplet & 63];
  }
  return output;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function normalizeUrl(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = "http://" + value;
  return value.replace(/\/+$/, "");
}

export function normalizeConnection(conn: Connection): Connection {
  return {
    ...conn,
    url: normalizeUrl(conn.url),
    username: conn.username.trim() || "opencode",
  };
}

function authHeader(conn: Connection): string {
  return "Basic " + base64(`${conn.username || "opencode"}:${conn.password}`);
}

async function request<T>(
  conn: Connection,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(normalizeUrl(conn.url) + path, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: authHeader(conn),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      const raw = await res.text().catch(() => "");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.message) message = String(parsed.message);
          else if (parsed?._tag) message = String(parsed._tag);
          else if (parsed?.errors) message = String(JSON.stringify(parsed.errors));
        } catch {
          message = raw.slice(0, 200);
        }
      }
      throw new ApiError(message, res.status);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Accepts either a full pairing link printed by `opencode pair`
 * (http://host:port/auth/connect/<code>) or an already known base URL.
 */
export async function connectWithPairingLink(input: string): Promise<Connection> {
  const link = input.trim();
  const match = link.match(/^(https?:\/\/[^/\s]+)(\/[^\s]*)?$/i);
  if (!match) {
    throw new Error(
      "Это не похоже на ссылку для подключения. Вставьте ссылку из `opencode pair`.",
    );
  }

  const origin = match[1].replace(/\/+$/, "");
  const path = match[2] || "";
  const codeMatch = path.match(/\/auth\/connect\/([^/?#]+)/);
  if (!codeMatch) {
    throw new Error("В ссылке нет кода подключения /auth/connect/<code>.");
  }

  const res = await fetch(`${origin}/auth/connect/${codeMatch[1]}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(raw || `Не удалось обменять код подключения (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data?.token) throw new Error("Сервер не вернул токен подключения.");

  return {
    url: origin,
    username: "opencode",
    password: data.token,
    label: origin.replace(/^https?:\/\//, ""),
  };
}

export async function ping(conn: Connection): Promise<{ version: string; hostname?: string }> {
  return request<{ version: string; hostname?: string }>(conn, "/api/info");
}

export async function listSessions(
  conn: Connection,
  search?: string,
): Promise<SessionLite[]> {
  const params = ["limit=60", "order=desc"];
  if (search?.trim()) params.push(`search=${encodeURIComponent(search.trim())}`);
  const data = await request<{ data: SessionLite[] }>(conn, `/api/session?${params.join("&")}`);
  return data.data || [];
}

export async function getSession(
  conn: Connection,
  sessionID: string,
): Promise<SessionLite> {
  const data = await request<{ data: SessionLite }>(conn, `/api/session/${sessionID}`);
  return data.data;
}

export async function getMessages(
  conn: Connection,
  sessionID: string,
): Promise<ChatMessage[]> {
  const data = await request<{ data: ChatMessage[] }>(
    conn,
    `/api/session/${sessionID}/message?order=desc&limit=100`,
  );
  return (data.data || []).slice().reverse();
}

export async function getPermissions(
  conn: Connection,
  sessionID: string,
): Promise<PermissionRequest[]> {
  const data = await request<{ data: PermissionRequest[] }>(
    conn,
    `/api/session/${sessionID}/permission`,
  );
  return data.data || [];
}

export async function replyPermission(
  conn: Connection,
  sessionID: string,
  requestID: string,
  decision: PermissionDecision,
): Promise<void> {
  await request<void>(
    conn,
    `/api/session/${sessionID}/permission/${requestID}/reply`,
    { method: "POST", body: JSON.stringify({ decision }) },
  );
}

export async function sendPrompt(
  conn: Connection,
  sessionID: string,
  text: string,
): Promise<void> {
  await request(conn, `/api/session/${sessionID}/prompt`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function interruptSession(
  conn: Connection,
  sessionID: string,
): Promise<void> {
  await request(conn, `/api/session/${sessionID}/interrupt`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function createSession(
  conn: Connection,
  directory?: string,
): Promise<SessionLite> {
  const body = directory ? { location: { directory } } : {};
  const data = await request<{ data: SessionLite }>(conn, "/api/session", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.data;
}

export function isBusy(session: SessionLite): boolean {
  return Boolean(session.time?.busy && session.time.busy > (session.time.idle ?? 0));
}
