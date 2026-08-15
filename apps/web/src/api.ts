import type { Account, Budget, Category, LedgerSnapshot, SyncPayload, Transaction } from "@ledger/shared";

const STORAGE_KEY = "ledger_api_base";
const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const REQUEST_TIMEOUT_MS = 10_000;

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

export async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error("无法连接云服务器，请检查网络或服务器状态");
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message ?? "请求失败");
  }
  return response.json() as Promise<T>;
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
    return `${getApiBase()}/export/csv?format=${encodeURIComponent(format)}`;
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
