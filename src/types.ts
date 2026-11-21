export type Connection = {
  url: string;
  username: string;
  password: string;
  label?: string;
};

export type Settings = {
  relayUrl: string;
  relaySecret: string;
  pushEnabled: boolean;
  pushToken?: string;
};

export const defaultSettings: Settings = {
  relayUrl: "",
  relaySecret: "",
  pushEnabled: false,
};

export type SessionLite = {
  id: string;
  projectID?: string;
  title?: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  time: { created: number; updated: number; busy?: number; idle?: number };
  outcome?: "succeeded" | "failed" | "interrupted";
  location?: { directory?: string };
};

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      state?: { status?: string; input?: unknown; content?: unknown };
      time?: { created?: number; ran?: number; completed?: number };
    };

export type ChatMessage = {
  id: string;
  type: string;
  time?: { created?: number; completed?: number };
  text?: string;
  content?: ContentPart[];
  outcome?: "succeeded" | "failed" | "interrupted";
  error?: { message?: string };
};

export type PermissionRequest = {
  id: string;
  sessionID: string;
  action: string;
  resources?: string[];
  message?: string;
  metadata?: Record<string, unknown>;
};

export type PermissionDecision = "once" | "always" | "reject";

export type SavedState = {
  connection: Connection | null;
  settings: Settings;
};
