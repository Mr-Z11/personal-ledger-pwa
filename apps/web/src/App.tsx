import {
  DEFAULT_ACCOUNTS,
  DEFAULT_CATEGORIES,
  activeOnly,
  calculateAccountBalance,
  centsToYuan,
  monthKey,
  summarizeMonth,
  yuanToCents,
  type Account,
  type Budget,
  type Category,
  type Transaction,
  type TransactionType
} from "@ledger/shared";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CircleDollarSign,
  Download,
  Home,
  ListFilter,
  LogOut,
  PieChartIcon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Undo2,
  Upload
} from "lucide-react";
import Papa from "papaparse";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { clearOutbox, db, enqueue, readOutboxPayload, resetLocalData, saveSnapshot } from "./db";

type View = "overview" | "entry" | "transactions" | "accounts" | "budget" | "reports" | "trash";

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: "overview", label: "总览", icon: Home },
  { id: "entry", label: "记一笔", icon: Plus },
  { id: "transactions", label: "流水", icon: ListFilter },
  { id: "accounts", label: "账户", icon: Banknote },
  { id: "budget", label: "预算", icon: CalendarDays },
  { id: "reports", label: "报表", icon: PieChartIcon },
  { id: "trash", label: "回收站", icon: Trash2 }
];

const typeLabels: Record<TransactionType, string> = {
  expense: "支出",
  income: "收入",
  transfer: "转账"
};

function entityStamp() {
  return { id: crypto.randomUUID(), version: 1, updatedAt: new Date().toISOString(), deletedAt: null };
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("ledger-token"));
  const [userName, setUserName] = useState(() => localStorage.getItem("ledger-user") ?? "");
  const [view, setView] = useState<View>("overview");
  const [message, setMessage] = useState("准备同步");
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [outboxCount, setOutboxCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | undefined>();

  const refreshLocal = useCallback(async () => {
    const [nextAccounts, nextCategories, nextTransactions, nextBudgets, nextOutboxCount, nextLastSync] = await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
      db.transactions.orderBy("occurredAt").reverse().toArray(),
      db.budgets.toArray(),
      db.outbox.count(),
      db.meta.get("lastSyncAt")
    ]);
    setAccounts(nextAccounts);
    setCategories(nextCategories);
    setTransactions(nextTransactions);
    setBudgets(nextBudgets);
    setOutboxCount(nextOutboxCount);
    setLastSync(nextLastSync?.value);
  }, []);

  const activeAccounts = activeOnly(accounts);
  const activeCategories = activeOnly(categories);
  const activeTransactions = activeOnly(transactions);
  const isLocalPreview = token?.startsWith("local-preview:") ?? false;
  const currentMonth = monthKey();
  const summary = summarizeMonth(activeTransactions, currentMonth);
  const totalAssets = activeAccounts.reduce((sum, account) => sum + calculateAccountBalance(account, activeTransactions), 0);

  async function hydrateFromServer(nextToken = token) {
    if (!nextToken) return;
    if (nextToken.startsWith("local-preview:")) {
      await refreshLocal();
      setMessage("本地预览模式");
      return;
    }
    setBusy(true);
    try {
      const snapshot = await api.bootstrap(nextToken);
      await saveSnapshot(snapshot);
      await refreshLocal();
      setMessage("云端数据已更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步失败，已保留本地数据");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    if (!token) return;
    if (isLocalPreview) {
      await refreshLocal();
      setMessage("本地预览数据已保存");
      return;
    }
    setBusy(true);
    try {
      const pending = await readOutboxPayload();
      if (
        (pending.accounts?.length ?? 0) +
          (pending.categories?.length ?? 0) +
          (pending.transactions?.length ?? 0) +
          (pending.budgets?.length ?? 0) >
        0
      ) {
        const pushed = await api.push(token, pending);
        await clearOutbox();
        await saveSnapshot(pushed);
      } else {
        const pulled = await api.pull(token);
        await saveSnapshot(pulled);
      }
      await refreshLocal();
      setMessage("同步完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "离线中，稍后自动同步");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshLocal();
    if (token) void hydrateFromServer(token);
  }, []);

  useEffect(() => {
    const onOnline = () => void syncNow();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [token]);

  async function signOut() {
    localStorage.removeItem("ledger-token");
    localStorage.removeItem("ledger-user");
    setToken(null);
    setUserName("");
    await resetLocalData();
    await refreshLocal();
  }

  async function saveLocalAndQueue(kind: keyof Pick<typeof db, "accounts" | "categories" | "transactions" | "budgets">, item: Account | Category | Transaction | Budget) {
    await db[kind].put(item as never);
    await enqueue({ [kind]: [item] });
    await refreshLocal();
    if (!isLocalPreview && navigator.onLine) void syncNow();
  }

  if (!token) {
    return <AuthScreen onAuth={async (result) => {
      localStorage.setItem("ledger-token", result.token);
      localStorage.setItem("ledger-user", result.user.name);
      setToken(result.token);
      setUserName(result.user.name);
      await hydrateFromServer(result.token);
    }} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">¥</div>
          <div>
            <strong>Ledger Box</strong>
            <span>{userName || "个人账本"}</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)} title={item.label}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sync-card">
          <span>{isLocalPreview ? "本地预览" : navigator.onLine ? "在线" : "离线"} · 待同步 {isLocalPreview ? 0 : outboxCount}</span>
          <small>{lastSync ? new Date(lastSync).toLocaleString() : message}</small>
          <button className="icon-button" onClick={syncNow} disabled={busy} title="立即同步">
            <RefreshCw size={18} className={busy ? "spin" : ""} />
          </button>
        </div>
        <button className="ghost danger" onClick={signOut}>
          <LogOut size={18} />
          退出
        </button>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">{currentMonth}</span>
            <h1>{navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" onClick={() => void exportCsv(token)} title="导出 CSV">
              <Download size={18} />
            </button>
            <label className="icon-button" title="导入 CSV">
              <Upload size={18} />
              <input type="file" accept=".csv,text/csv" hidden onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importCsv(file, activeAccounts, activeCategories, saveLocalAndQueue);
                event.currentTarget.value = "";
              }} />
            </label>
          </div>
        </header>

        {view === "overview" && (
          <Overview summary={summary} totalAssets={totalAssets} accounts={activeAccounts} transactions={activeTransactions} />
        )}
        {view === "entry" && (
          <EntryForm accounts={activeAccounts} categories={activeCategories} onSave={(item) => saveLocalAndQueue("transactions", item)} />
        )}
        {view === "transactions" && (
          <TransactionList transactions={activeTransactions} accounts={accounts} categories={categories} onDelete={async (item) => {
            const deleted = { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: item.version + 1 };
            await saveLocalAndQueue("transactions", deleted);
          }} />
        )}
        {view === "accounts" && (
          <AccountsPanel accounts={activeAccounts} transactions={activeTransactions} onSave={(item) => saveLocalAndQueue("accounts", item)} />
        )}
        {view === "budget" && (
          <BudgetPanel budgets={activeOnly(budgets)} categories={activeCategories} transactions={activeTransactions} onSave={(item) => saveLocalAndQueue("budgets", item)} />
        )}
        {view === "reports" && (
          <Reports transactions={activeTransactions} categories={activeCategories} />
        )}
        {view === "trash" && (
          <Trash transactions={transactions.filter((item) => item.deletedAt)} accounts={accounts} categories={categories} onRestore={async (item) => {
            const restored = { ...item, deletedAt: null, updatedAt: new Date().toISOString(), version: item.version + 1 };
            await saveLocalAndQueue("transactions", restored);
          }} />
        )}
        <CategoryQuickAdd categories={activeCategories} onSave={(item) => saveLocalAndQueue("categories", item)} />
      </main>
    </div>
  );
}

function AuthScreen({ onAuth }: { onAuth: (result: Awaited<ReturnType<typeof api.login>>) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = mode === "login" ? await api.login({ email, password }) : await api.register({ email, password, name });
      onAuth(result);
    } catch (caught) {
      if (isLocalhost()) {
        const localResult = await createLocalPreviewAccount(email, name || "本地预览账本");
        onAuth(localResult);
        return;
      }
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <section className="auth-panel">
        <div className="brand large">
          <div className="brand-mark">¥</div>
          <div>
            <strong>Ledger Box</strong>
            <span>云端优先的个人记账本</span>
          </div>
        </div>
        <form onSubmit={submit} className="form-stack">
          {mode === "register" && <input value={name} onChange={(event) => setName(event.target.value)} placeholder="昵称" />}
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱" type="email" required />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码，至少 8 位" type="password" required minLength={8} />
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>{busy ? "处理中" : mode === "login" ? "登录" : "创建账本"}</button>
          <button type="button" className="ghost" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "第一次使用，创建账号" : "已有账号，返回登录"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Overview({ summary, totalAssets, accounts, transactions }: {
  summary: { incomeCents: number; expenseCents: number; netCents: number };
  totalAssets: number;
  accounts: Account[];
  transactions: Transaction[];
}) {
  return (
    <section className="grid overview-grid">
      <Metric title="本月收入" value={summary.incomeCents} icon={ArrowDownLeft} tone="good" />
      <Metric title="本月支出" value={summary.expenseCents} icon={ArrowUpRight} tone="warn" />
      <Metric title="本月结余" value={summary.netCents} icon={CircleDollarSign} tone="ink" />
      <Metric title="总资产" value={totalAssets} icon={Banknote} tone="blue" />
      <div className="panel wide">
        <h2>账户余额</h2>
        <div className="account-strip">
          {accounts.map((account) => (
            <div className="mini-card" key={account.id} style={{ borderColor: account.color }}>
              <span>{account.name}</span>
              <strong>¥{centsToYuan(calculateAccountBalance(account, transactions))}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>最近流水</h2>
        <TransactionRows transactions={transactions.slice(0, 6)} accounts={accounts} categories={[]} compact />
      </div>
    </section>
  );
}

function Metric({ title, value, icon: Icon, tone }: { title: string; value: number; icon: typeof Home; tone: string }) {
  return (
    <div className={`metric ${tone}`}>
      <Icon size={22} />
      <span>{title}</span>
      <strong>¥{centsToYuan(value)}</strong>
    </div>
  );
}

function EntryForm({ accounts, categories, onSave }: { accounts: Account[]; categories: Category[]; onSave: (item: Transaction) => Promise<void> }) {
  const [type, setType] = useState<TransactionType>("expense");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));

  const filteredCategories = categories.filter((category) => category.kind === (type === "income" ? "income" : "expense"));

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
    if (!categoryId && filteredCategories[0]) setCategoryId(filteredCategories[0].id);
  }, [accounts, filteredCategories, accountId, categoryId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const item: Transaction = {
      ...entityStamp(),
      type,
      accountId,
      toAccountId: type === "transfer" ? toAccountId : null,
      categoryId: type === "transfer" ? null : categoryId,
      amountCents: yuanToCents(amount),
      occurredAt: new Date(occurredAt).toISOString(),
      merchant,
      note,
      tags: []
    };
    await onSave(item);
    setAmount("");
    setMerchant("");
    setNote("");
  }

  return (
    <section className="panel entry-panel">
      <div className="segmented">
        {(["expense", "income", "transfer"] as TransactionType[]).map((item) => (
          <button key={item} className={type === item ? "active" : ""} onClick={() => setType(item)} type="button">{typeLabels[item]}</button>
        ))}
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label>金额<input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" inputMode="decimal" required /></label>
        <label>付款账户<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        {type === "transfer" ? (
          <label>转入账户<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>{accounts.filter((item) => item.id !== accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        ) : (
          <label>分类<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{filteredCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        )}
        <label>时间<input value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} type="datetime-local" /></label>
        <label>商户<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="超市、餐厅、客户..." /></label>
        <label className="full">备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充说明" /></label>
        <button className="primary full">保存流水</button>
      </form>
    </section>
  );
}

function TransactionList({ transactions, accounts, categories, onDelete }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onDelete: (item: Transaction) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TransactionType | "all">("all");
  const filtered = transactions.filter((item) => {
    const haystack = [item.note, item.merchant, accounts.find((account) => account.id === item.accountId)?.name, categories.find((category) => category.id === item.categoryId)?.name].join(" ");
    return (type === "all" || item.type === type) && haystack.toLowerCase().includes(query.toLowerCase());
  });
  return (
    <section className="panel">
      <div className="filters">
        <label className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索流水" /></label>
        <select value={type} onChange={(event) => setType(event.target.value as TransactionType | "all")}>
          <option value="all">全部</option>
          <option value="expense">支出</option>
          <option value="income">收入</option>
          <option value="transfer">转账</option>
        </select>
      </div>
      <TransactionRows transactions={filtered} accounts={accounts} categories={categories} onDelete={onDelete} />
    </section>
  );
}

function TransactionRows({ transactions, accounts, categories, onDelete, onRestore, compact = false }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onDelete?: (item: Transaction) => Promise<void>;
  onRestore?: (item: Transaction) => Promise<void>;
  compact?: boolean;
}) {
  if (transactions.length === 0) return <p className="empty">暂无记录</p>;
  return (
    <div className="rows">
      {transactions.map((item) => {
        const account = accounts.find((entry) => entry.id === item.accountId);
        const category = categories.find((entry) => entry.id === item.categoryId);
        const sign = item.type === "expense" ? "-" : item.type === "income" ? "+" : "";
        return (
          <article className="row" key={item.id}>
            <div className={`row-icon ${item.type}`}>{item.type === "transfer" ? <ArrowRightLeft size={18} /> : item.type === "income" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</div>
            <div>
              <strong>{item.merchant || category?.name || typeLabels[item.type]}</strong>
              <span>{new Date(item.occurredAt).toLocaleDateString()} · {account?.name}{category ? ` · ${category.name}` : ""}</span>
            </div>
            <b>{sign}¥{centsToYuan(item.amountCents)}</b>
            {!compact && onDelete && <button className="icon-button" onClick={() => onDelete(item)} title="删除"><Trash2 size={16} /></button>}
            {!compact && onRestore && <button className="icon-button" onClick={() => onRestore(item)} title="恢复"><Undo2 size={16} /></button>}
          </article>
        );
      })}
    </div>
  );
}

function AccountsPanel({ accounts, transactions, onSave }: { accounts: Account[]; transactions: Transaction[]; onSave: (item: Account) => Promise<void> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("bank");
  const [opening, setOpening] = useState("0");
  return (
    <section className="grid two">
      <div className="panel">
        <h2>账户</h2>
        <div className="account-list">
          {accounts.map((account) => (
            <div className="account-line" key={account.id}>
              <i style={{ background: account.color }} />
              <span>{account.name}</span>
              <strong>¥{centsToYuan(calculateAccountBalance(account, transactions))}</strong>
            </div>
          ))}
        </div>
      </div>
      <form className="panel form-stack" onSubmit={async (event) => {
        event.preventDefault();
        await onSave({ ...entityStamp(), name, type, openingBalanceCents: yuanToCents(opening), color: "#1f5f74" });
        setName("");
        setOpening("0");
      }}>
        <h2>新增账户</h2>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="账户名称" required />
        <select value={type} onChange={(event) => setType(event.target.value as Account["type"])}>
          <option value="bank">银行卡</option>
          <option value="cash">现金</option>
          <option value="credit">信用卡</option>
          <option value="alipay">支付宝</option>
          <option value="wechat">微信</option>
          <option value="investment">投资</option>
          <option value="other">其他</option>
        </select>
        <input value={opening} onChange={(event) => setOpening(event.target.value)} placeholder="初始余额" inputMode="decimal" />
        <button className="primary">保存账户</button>
      </form>
    </section>
  );
}

function BudgetPanel({ budgets, categories, transactions, onSave }: {
  budgets: Budget[];
  categories: Category[];
  transactions: Transaction[];
  onSave: (item: Budget) => Promise<void>;
}) {
  const [month, setMonth] = useState(monthKey());
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const expenseCategories = categories.filter((item) => item.kind === "expense");
  const monthExpenses = transactions.filter((item) => item.type === "expense" && item.occurredAt.startsWith(month));
  return (
    <section className="grid two">
      <div className="panel">
        <h2>预算执行</h2>
        <div className="budget-list">
          {budgets.filter((budget) => budget.month === month).map((budget) => {
            const spent = monthExpenses.filter((item) => !budget.categoryId || item.categoryId === budget.categoryId).reduce((sum, item) => sum + item.amountCents, 0);
            const ratio = Math.min(100, Math.round((spent / budget.amountCents) * 100));
            return (
              <div className="budget-line" key={budget.id}>
                <span>{budget.categoryId ? categories.find((item) => item.id === budget.categoryId)?.name : "全部支出"}</span>
                <strong>¥{centsToYuan(spent)} / ¥{centsToYuan(budget.amountCents)}</strong>
                <div className="bar"><i style={{ width: `${ratio}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
      <form className="panel form-stack" onSubmit={async (event) => {
        event.preventDefault();
        await onSave({ ...entityStamp(), month, categoryId: categoryId || null, amountCents: yuanToCents(amount) });
        setAmount("");
      }}>
        <h2>新增预算</h2>
        <input value={month} onChange={(event) => setMonth(event.target.value)} type="month" />
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">全部支出</option>
          {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="预算金额" inputMode="decimal" required />
        <button className="primary">保存预算</button>
      </form>
    </section>
  );
}

function Reports({ transactions, categories }: { transactions: Transaction[]; categories: Category[] }) {
  const categoryData = useMemo(() => {
    return categories.filter((category) => category.kind === "expense").map((category) => ({
      name: category.name,
      value: transactions.filter((item) => item.type === "expense" && item.categoryId === category.id).reduce((sum, item) => sum + item.amountCents, 0),
      color: category.color
    })).filter((item) => item.value > 0);
  }, [transactions, categories]);

  const trendData = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index));
    const month = monthKey(date);
    const summary = summarizeMonth(transactions, month);
    return { month, income: summary.incomeCents / 100, expense: summary.expenseCents / 100 };
  });

  return (
    <section className="grid two">
      <div className="panel chart-panel">
        <h2>分类占比</h2>
        <div className="donut-list">
          {categoryData.map((entry) => (
            <div className="budget-line" key={entry.name}>
              <span><i className="dot" style={{ background: entry.color }} />{entry.name}</span>
              <strong>¥{centsToYuan(entry.value)}</strong>
              <div className="bar"><i style={{ width: `${Math.round((entry.value / Math.max(1, categoryData.reduce((sum, item) => sum + item.value, 0))) * 100)}%`, background: entry.color }} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel chart-panel">
        <h2>半年趋势</h2>
        <div className="trend-bars">
          {trendData.map((item) => {
            const max = Math.max(1, ...trendData.map((entry) => Math.max(entry.income, entry.expense)));
            return (
              <div className="trend-month" key={item.month}>
                <div className="trend-stack">
                  <i className="income-bar" style={{ height: `${(item.income / max) * 100}%` }} />
                  <i className="expense-bar" style={{ height: `${(item.expense / max) * 100}%` }} />
                </div>
                <span>{item.month.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Trash({ transactions, accounts, categories, onRestore }: { transactions: Transaction[]; accounts: Account[]; categories: Category[]; onRestore: (item: Transaction) => Promise<void> }) {
  return (
    <section className="panel">
      <TransactionRows transactions={transactions} accounts={accounts} categories={categories} onRestore={onRestore} />
    </section>
  );
}

function CategoryQuickAdd({ categories, onSave }: { categories: Category[]; onSave: (item: Category) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("expense");
  if (!open) return <button className="floating" onClick={() => setOpen(true)} title="新增分类"><Settings2 size={20} /></button>;
  return (
    <form className="floating-form" onSubmit={async (event) => {
      event.preventDefault();
      await onSave({ ...entityStamp(), name, kind, icon: "circle", color: kind === "expense" ? "#d45b3f" : "#2f7d4f" });
      setName("");
      setOpen(false);
    }}>
      <strong>新增分类</strong>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="分类名称" required />
      <select value={kind} onChange={(event) => setKind(event.target.value as Category["kind"])}>
        <option value="expense">支出</option>
        <option value="income">收入</option>
      </select>
      <button className="primary">保存</button>
      <button type="button" className="ghost" onClick={() => setOpen(false)}>取消</button>
      <small>当前 {categories.length} 个分类</small>
    </form>
  );
}

async function importCsv(
  file: File,
  accounts: Account[],
  categories: Category[],
  saveLocalAndQueue: (kind: "transactions", item: Transaction) => Promise<void>
) {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  for (const row of parsed.data) {
    const account = accounts.find((item) => item.name === row["账户"]) ?? accounts[0];
    if (!account) continue;
    const category = categories.find((item) => item.name === row["分类"]);
    const amount = row["金额"] ?? "0";
    await saveLocalAndQueue("transactions", {
      ...entityStamp(),
      type: (row["类型"] as TransactionType) || "expense",
      accountId: account.id,
      toAccountId: null,
      categoryId: category?.id ?? null,
      amountCents: yuanToCents(amount),
      occurredAt: row["日期"] ? new Date(row["日期"]).toISOString() : new Date().toISOString(),
      merchant: row["商户"] ?? "",
      note: row["备注"] ?? "",
      tags: row["标签"] ? row["标签"].split("|").filter(Boolean) : []
    });
  }
}

async function exportCsv(token: string | null) {
  if (!token) return;
  const response = await fetch(api.exportUrl(), { headers: authHeaders(token) });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function isLocalhost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

async function createLocalPreviewAccount(email: string, name: string): Promise<Awaited<ReturnType<typeof api.login>>> {
  const now = new Date().toISOString();
  const existingAccounts = await db.accounts.count();

  if (existingAccounts === 0) {
    await db.accounts.bulkPut(DEFAULT_ACCOUNTS.map((account) => ({ ...entityStamp(), ...account, updatedAt: now })));
    await db.categories.bulkPut(DEFAULT_CATEGORIES.map((category) => ({ ...entityStamp(), ...category, updatedAt: now })));
  }

  await db.meta.put({ key: "lastSyncAt", value: now });

  return {
    token: `local-preview:${crypto.randomUUID()}`,
    user: {
      id: "local-preview",
      email: email || "preview@local.test",
      name
    },
    ledgerId: "local-preview"
  };
}
