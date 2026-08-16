import type { Account, Budget, Category, LedgerSnapshot, SyncPayload, Transaction } from "@ledger/shared";

const STORAGE_KEY = "ledger_api_base";
const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const REQUEST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 4_000; // shorter timeout for non-last endpoint attempts

// ---------------------------------------------------------------------------
// Fallback endpoints — baked in at build time via VITE_FALLBACK_API_BASES
// (comma-separated).  When the primary (cloud) API is unreachable, apiFetch
// automatically retries against these local endpoints so new transactions
// still land in the local PostgreSQL and get picked up by the daily backup.
// ---------------------------------------------------------------------------
const FALLBACK_BASES: string[] = ((import.meta.env.VITE_FALLBACK_API_BASES as string) ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Failover health state (persisted in localStorage)
const ACTIVE_EP_KEY = "ledger_failover_active"; // "primary" | "fb0" | "fb1" | ...
const COOLDOWN_KEY = "ledger_failover_cooldown"; // epoch ms — don't retry primary until this time
const COOLDOWN_MS = 120_000; // 2 minutes

export function getApiBase(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_API_BASE;
  } catch {
    return DEFAULT_API_BASE;
  }
}

export function setApiBase(url: string | null): void {
  try {
    if (url && url.trim()) {
      localStorage.setItem(STORAGE_KEY, url.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function getDefaultApiBase(): string {
  return DEFAULT_API_BASE;
}

export interface AuthResult {
  token: string;
  user: { id: string; email: string; name: string };
  ledgerId: string;
}

// ---------------------------------------------------------------------------
// Failover helpers
// ---------------------------------------------------------------------------

interface Endpoint {
  url: string;
  id: string;
}

function allEndpoints(): Endpoint[] {
  return [{ url: getApiBase(), id: "primary" }, ...FALLBACK_BASES.map((url, i) => ({ url, id: `fb${i}` }))];
}

function getActiveId(): string {
  try {
    return localStorage.getItem(ACTIVE_EP_KEY) ?? "primary";
  } catch {
    return "primary";
  }
}

function setActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_EP_KEY, id);
  } catch {
    /* ignore */
  }
}

function primaryInCooldown(): boolean {
  try {
    return Date.now() < Number(localStorage.getItem(COOLDOWN_KEY) ?? 0);
  } catch {
    return false;
  }
}

function setPrimaryCooldown(): void {
  try {
    localStorage.setItem(COOLDOWN_KEY, String(Date.now() + COOLDOWN_MS));
  } catch {
    /* ignore */
  }
}

function clearPrimaryCooldown(): void {
  try {
    localStorage.removeItem(COOLDOWN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Build the ordered list of endpoints to try.
 *
 * - If primary is healthy & active → primary first, then fallbacks.
 * - If primary just failed (in cooldown) → fallbacks first, primary last
 *   (so we still occasionally re-probe primary to detect recovery).
 * - The currently-active fallback is tried first among fallbacks.
 */
function endpointOrder(): Endpoint[] {
  const all = allEndpoints();
  if (all.length <= 1) return all;

  const activeId = getActiveId();
  const cooldown = primaryInCooldown();

  // Primary in cooldown → demote it to the end
  if (cooldown) {
    const primary = all[0];
    const fallbacks = all.slice(1);
    // Active fallback first
    const activeIdx = fallbacks.findIndex((e) => e.id === activeId);
    if (activeIdx > 0) {
      const [active] = fallbacks.splice(activeIdx, 1);
      return [active, ...fallbacks, primary];
    }
    return [...fallbacks, primary];
  }

  // Primary not in cooldown → primary first
  const active = all.find((e) => e.id === activeId);
  if (active && active.id !== "primary") {
    // Active is a fallback but primary is not in cooldown — try active first
    // (it's known-good), then primary (re-probe), then remaining fallbacks.
    const rest = all.filter((e) => e.id !== active.id);
    return [active, ...rest];
  }
  return all; // primary first, then fallbacks
}

/** Get the URL of the currently-active endpoint (for export URLs etc). */
function activeBaseUrl(): string {
  const all = allEndpoints();
  const active = all.find((e) => e.id === getActiveId());
  return (active ?? all[0]).url;
}

// ---------------------------------------------------------------------------
// Core fetch with automatic failover
// ---------------------------------------------------------------------------

export async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const ordered = endpointOrder();
  let lastError: Error | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const ep = ordered[i];
    const isLast = i === ordered.length - 1;
    const timeoutMs = isLast ? REQUEST_TIMEOUT_MS : PROBE_TIMEOUT_MS;

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      response = await fetch(`${ep.url}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...options.headers
        }
      });
      window.clearTimeout(timer);
    } catch {
      // Network error or timeout — endpoint unreachable, try next
      lastError = new Error("无法连接服务器，请检查网络");
      if (ep.id === "primary" && !isLast) setPrimaryCooldown();
      continue;
    }

    // We got an HTTP response — endpoint is reachable
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      // 5xx = server error → try next endpoint (server up but broken)
      // 4xx = client error → throw immediately (wrong token, bad request, etc.)
      if (response.status >= 500 && !isLast) {
        lastError = new Error(error.message ?? "服务器错误");
        if (ep.id === "primary") setPrimaryCooldown();
        continue;
      }
      throw new Error(error.message ?? "请求失败");
    }

    // Success — remember which endpoint worked
    if (getActiveId() !== ep.id) setActiveId(ep.id);
    if (ep.id === "primary") clearPrimaryCooldown();
    return response.json() as Promise<T>;
  }

  throw lastError ?? new Error("所有服务器均不可达，请检查网络");
}

export const api = {
  register(input: { email: string; password: string; name?: string }) {
    return apiFetch<AuthResult>("/auth/register", { method: "POST", body: JSON.stringify(input) });
  },
  login(input: { email: string; password: string }) {
    return apiFetch<AuthResult>("/auth/login", { method: "POST", body: JSON.stringify(input) });
  },
  bootstrap(token: string) {
    return apiFetch<LedgerSnapshot>("/bootstrap", {}, token);
  },
  createAccount(token: string, account: Omit<Account, "id" | "version" | "updatedAt" | "deletedAt">) {
    return apiFetch<Account>("/accounts", { method: "POST", body: JSON.stringify(account) }, token);
  },
  createCategory(token: string, category: Omit<Category, "id" | "version" | "updatedAt" | "deletedAt">) {
    return apiFetch<Category>("/categories", { method: "POST", body: JSON.stringify(category) }, token);
  },
  createBudget(token: string, budget: Omit<Budget, "id" | "version" | "updatedAt" | "deletedAt">) {
    return apiFetch<Budget>("/budgets", { method: "POST", body: JSON.stringify(budget) }, token);
  },
  createTransaction(token: string, transaction: Omit<Transaction, "id" | "version" | "updatedAt" | "deletedAt">) {
    return apiFetch<Transaction>("/transactions", { method: "POST", body: JSON.stringify(transaction) }, token);
  },
  updateTransaction(token: string, id: string, transaction: Partial<Omit<Transaction, "id" | "version" | "updatedAt">>) {
    return apiFetch<Transaction>(`/transactions/${id}`, { method: "PUT", body: JSON.stringify(transaction) }, token);
  },
  deleteTransaction(token: string, id: string) {
    return apiFetch<Transaction>(`/transactions/${id}`, { method: "DELETE" }, token);
  },
  restoreTransaction(token: string, id: string) {
    return apiFetch<Transaction>(`/transactions/${id}/restore`, { method: "POST" }, token);
  },
  push(token: string, payload: Partial<SyncPayload>) {
    return apiFetch<LedgerSnapshot>("/sync/push", { method: "POST", body: JSON.stringify(payload) }, token);
  },
  pull(token: string) {
    return apiFetch<LedgerSnapshot>("/sync/pull", {}, token);
  },
  exportUrl(format = "ledger") {
    return `${activeBaseUrl()}/export/csv?format=${encodeURIComponent(format)}`;
  },
  notificationVapidKey() {
    return apiFetch<{ publicKey: string }>("/notifications/vapid-key");
  },
  notificationSettings(token: string) {
    return apiFetch<NotificationSettings>("/notifications/settings", {}, token);
  },
  saveNotificationSettings(token: string, settings: NotificationSettings) {
    return apiFetch<NotificationSettings>("/notifications/settings", { method: "PUT", body: JSON.stringify(settings) }, token);
  },
  subscribeNotifications(token: string, subscription: PushSubscriptionJSON) {
    return apiFetch<{ id: string }>("/notifications/subscribe", { method: "POST", body: JSON.stringify(subscription) }, token);
  },
  unsubscribeNotifications(token: string, endpoint: string) {
    return apiFetch<{ ok: boolean }>("/notifications/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }, token);
  },
  testNotifications(token: string) {
    return apiFetch<{ delivered: boolean }>("/notifications/test", { method: "POST" }, token);
  },

  async testConnection(url: string): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(8000),
        headers: { ...(url.startsWith("http:") ? {} : {}) }
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return { ok: true, message: data.ok ? "连接成功" : response.statusText };
      }
      return { ok: false, message: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "连接失败" };
    }
  }
};

export interface NotificationSettings {
  salaryDay: number;
  remindHour: number;
  content: string;
  enabled: boolean;
}
