import {
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
  Pencil,
  PieChartIcon,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  Upload,
  X
} from "lucide-react";
import Papa from "papaparse";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { clearOutbox, db, enqueue, readOutboxPayload, resetLocalData, saveSnapshot } from "./db";

type View = "overview" | "entry" | "transactions" | "accounts" | "budget" | "reports" | "trash";

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: "overview", label: "总览", icon: Home },
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

function categoryPath(category: Category | undefined, categories: Category[]) {
  if (!category) return "";
  const parent = category.parentId ? categories.find((item) => item.id === category.parentId) : undefined;
  if (parent) return `${parent.name} > ${category.name}`;
  return category.name === "其他" ? category.name : `其他 > ${category.name}`;
}

function selectableCategories(categories: Category[], kind: Category["kind"]) {
  const active = activeOnly(categories).filter((category) => category.kind === kind);
  const parentIds = new Set(active.map((category) => category.parentId).filter(Boolean));
  return active.filter((category) => category.parentId || !parentIds.has(category.id));
}

function makeCategory(input: {
  name: string;
  kind: Category["kind"];
  parentId?: string | null;
  color?: string;
  icon?: string;
}): Category {
  return {
    ...entityStamp(),
    name: input.name.trim(),
    kind: input.kind,
    parentId: input.parentId ?? null,
    icon: input.icon ?? "circle",
    color: input.color ?? (input.kind === "expense" ? "#d45b3f" : "#2f7d4f")
  };
}

function otherCategory(categories: Category[], kind: Category["kind"]) {
  return activeOnly(categories).find((category) => category.kind === kind && !category.parentId && category.name === "其他");
}

function viewTitle(view: View) {
  if (view === "entry") return "记一笔";
  return navItems.find((item) => item.id === view)?.label ?? "总览";
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
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

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
            <h1>{viewTitle(view)}</h1>
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
          <EntryForm accounts={activeAccounts} categories={activeCategories} onSave={(item) => saveLocalAndQueue("transactions", item)} onSaveCategory={(item) => saveLocalAndQueue("categories", item)} />
        )}
        {view === "transactions" && (
          <TransactionList transactions={activeTransactions} accounts={accounts} categories={categories} onDelete={async (item) => {
            const deleted = { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: item.version + 1 };
            await saveLocalAndQueue("transactions", deleted);
          }} onEdit={(item) => setEditingTransaction(item)} editingTransaction={editingTransaction} onCancelEdit={() => setEditingTransaction(null)} onSaveEdit={async (item) => {
            await saveLocalAndQueue("transactions", item);
            setEditingTransaction(null);
          }} onSaveCategory={(item) => saveLocalAndQueue("categories", item)} />
        )}
        {view === "accounts" && (
          <ManagementPanel accounts={activeAccounts} categories={activeCategories} transactions={activeTransactions} onSaveAccount={(item) => saveLocalAndQueue("accounts", item)} onSaveCategory={(item) => saveLocalAndQueue("categories", item)} />
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
        <button className="floating entry-fab" onClick={() => setView("entry")} title="记一笔"><Plus size={30} /></button>
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

function toDatetimeLocal(value: string) {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function EntryForm({ accounts, categories, onSave, onSaveCategory, editing, onCancel }: {
  accounts: Account[];
  categories: Category[];
  onSave: (item: Transaction) => Promise<void>;
  onSaveCategory: (item: Category) => Promise<void>;
  editing?: Transaction | null;
  onCancel?: () => void;
}) {
  const [type, setType] = useState<TransactionType>(editing?.type ?? "expense");
  const [accountId, setAccountId] = useState(editing?.accountId ?? accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(editing?.toAccountId ?? accounts[1]?.id ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [amount, setAmount] = useState(editing ? centsToYuan(editing.amountCents) : "");
  const [merchant, setMerchant] = useState(editing?.merchant ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [occurredAt, setOccurredAt] = useState(() => editing ? toDatetimeLocal(editing.occurredAt) : new Date().toISOString().slice(0, 16));

  const categoryKind = type === "income" ? "income" : "expense";
  const filteredCategories = selectableCategories(categories, categoryKind);

  useEffect(() => {
    if (!editing) return;
    setType(editing.type);
    setAccountId(editing.accountId);
    setToAccountId(editing.toAccountId ?? "");
    setCategoryId(editing.categoryId ?? "");
    setAmount(centsToYuan(editing.amountCents));
    setMerchant(editing.merchant ?? "");
    setNote(editing.note ?? "");
    setOccurredAt(toDatetimeLocal(editing.occurredAt));
  }, [editing]);

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
    if (type !== "transfer" && !filteredCategories.some((category) => category.id === categoryId)) {
      setCategoryId(filteredCategories[0]?.id ?? "");
    }
  }, [accounts, filteredCategories, accountId, categoryId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const item: Transaction = {
      ...(editing ?? entityStamp()),
      type,
      accountId,
      toAccountId: type === "transfer" ? toAccountId : null,
      categoryId: type === "transfer" ? null : categoryId,
      amountCents: yuanToCents(amount),
      occurredAt: new Date(occurredAt).toISOString(),
      merchant,
      note,
      tags: editing?.tags ?? [],
      version: editing ? editing.version + 1 : 1,
      updatedAt: new Date().toISOString(),
      deletedAt: null
    };
    await onSave(item);
    if (!editing) {
      setAmount("");
      setMerchant("");
      setNote("");
    }
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
        <label>{type === "income" ? "收款账户" : "付款账户"}<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        {type === "transfer" ? (
          <label>转入账户<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>{accounts.filter((item) => item.id !== accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        ) : (
          <CategoryPicker categories={categories} kind={categoryKind} value={categoryId} onChange={setCategoryId} onCreate={onSaveCategory} />
        )}
        <label>时间<input value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} type="datetime-local" /></label>
        <label>商户<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="超市、餐厅、客户..." /></label>
        <label className="full">备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充说明" /></label>
        <button className="primary full">{editing ? "保存修改" : "保存流水"}</button>
        {editing && onCancel && <button type="button" className="ghost full" onClick={onCancel}><X size={16} />取消编辑</button>}
      </form>
    </section>
  );
}

function CategoryPicker({ categories, kind, value, onChange, onCreate }: {
  categories: Category[];
  kind: Category["kind"];
  value: string;
  onChange: (id: string) => void;
  onCreate: (item: Category) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const options = selectableCategories(categories, kind);
  const normalizedQuery = query.trim().toLowerCase();
  const selectedCategory = options.find((category) => category.id === value);
  const matches = normalizedQuery
    ? options.filter((category) => categoryPath(category, categories).toLowerCase().includes(normalizedQuery))
    : [];
  const canCreate = query.trim().length > 0 && !options.some((category) => category.name.toLowerCase() === normalizedQuery);

  async function createQuickCategory() {
    const name = query.trim();
    if (!name) return;
    let parent = otherCategory(categories, kind);
    if (!parent) {
      parent = makeCategory({ name: "其他", kind, parentId: null, icon: "folder", color: kind === "expense" ? "#6b6f3f" : "#2f7d4f" });
      await onCreate(parent);
    }
    const child = makeCategory({ name, kind, parentId: parent.id });
    await onCreate(child);
    onChange(child.id);
    setQuery("");
  }

  return (
    <label className="category-picker full">
      分类
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索或新增分类" />
      <div className="category-chip-list">
        {!normalizedQuery && selectedCategory && (
          <button type="button" className="category-chip active" onClick={() => onChange(selectedCategory.id)}>
            {categoryPath(selectedCategory, categories)}
          </button>
        )}
        {matches.map((category) => (
          <button type="button" className={value === category.id ? "category-chip active" : "category-chip"} key={category.id} onClick={() => onChange(category.id)}>
            {categoryPath(category, categories)}
          </button>
        ))}
        {canCreate && (
          <button type="button" className="category-chip create" onClick={() => void createQuickCategory()}>
            新增：其他 &gt; {query.trim()}
          </button>
        )}
      </div>
    </label>
  );
}

function TransactionList({ transactions, accounts, categories, onDelete, onEdit, editingTransaction, onCancelEdit, onSaveEdit, onSaveCategory }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onDelete: (item: Transaction) => Promise<void>;
  onEdit: (item: Transaction) => void;
  editingTransaction: Transaction | null;
  onCancelEdit: () => void;
  onSaveEdit: (item: Transaction) => Promise<void>;
  onSaveCategory: (item: Category) => Promise<void>;
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
      {editingTransaction && (
        <div className="edit-panel">
          <h2>编辑流水</h2>
          <EntryForm accounts={activeOnly(accounts)} categories={activeOnly(categories)} editing={editingTransaction} onSave={onSaveEdit} onSaveCategory={onSaveCategory} onCancel={onCancelEdit} />
        </div>
      )}
      <TransactionRows transactions={filtered} accounts={accounts} categories={categories} onDelete={onDelete} onEdit={onEdit} />
    </section>
  );
}

function TransactionRows({ transactions, accounts, categories, onDelete, onEdit, onRestore, compact = false }: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onDelete?: (item: Transaction) => Promise<void>;
  onEdit?: (item: Transaction) => void;
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
            {!compact && onEdit && <button className="icon-button" onClick={() => onEdit(item)} title="编辑"><Pencil size={16} /></button>}
            {!compact && onDelete && <button className="icon-button" onClick={() => onDelete(item)} title="删除"><Trash2 size={16} /></button>}
            {!compact && onRestore && <button className="icon-button" onClick={() => onRestore(item)} title="恢复"><Undo2 size={16} /></button>}
          </article>
        );
      })}
    </div>
  );
}

function ManagementPanel({ accounts, categories, transactions, onSaveAccount, onSaveCategory }: {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  onSaveAccount: (item: Account) => Promise<void>;
  onSaveCategory: (item: Category) => Promise<void>;
}) {
  return (
    <section className="grid two">
      <AccountsPanel accounts={accounts} transactions={transactions} onSave={onSaveAccount} />
      <CategoriesPanel categories={categories} onSave={onSaveCategory} />
    </section>
  );
}

function AccountsPanel({ accounts, transactions, onSave }: { accounts: Account[]; transactions: Transaction[]; onSave: (item: Account) => Promise<void> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("bank");
  const [opening, setOpening] = useState("0");
  const [color, setColor] = useState("#1f5f74");
  const [editing, setEditing] = useState<Account | null>(null);

  function editAccount(account: Account) {
    setEditing(account);
    setName(account.name);
    setType(account.type);
    setOpening(centsToYuan(account.openingBalanceCents));
    setColor(account.color);
  }

  return (
    <>
      <div className="panel management-panel">
        <h2>账户</h2>
        <div className="account-list">
          {accounts.map((account) => (
            <div className="account-line" key={account.id}>
              <i style={{ background: account.color }} />
              <span>{account.name}</span>
              <strong>¥{centsToYuan(calculateAccountBalance(account, transactions))}</strong>
              <button className="icon-button" onClick={() => editAccount(account)} title="编辑账户"><Pencil size={16} /></button>
            </div>
          ))}
        </div>
      </div>
      <form className="panel form-stack" onSubmit={async (event) => {
        event.preventDefault();
        await onSave({
          ...(editing ?? entityStamp()),
          name,
          type,
          openingBalanceCents: yuanToCents(opening),
          color,
          version: editing ? editing.version + 1 : 1,
          updatedAt: new Date().toISOString(),
          deletedAt: null
        });
        setName("");
        setOpening("0");
        setColor("#1f5f74");
        setEditing(null);
      }}>
        <h2>{editing ? "编辑账户" : "新增账户"}</h2>
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
        <input value={color} onChange={(event) => setColor(event.target.value)} type="color" />
        <button className="primary">保存账户</button>
        {editing && <button type="button" className="ghost" onClick={() => {
          setEditing(null);
          setName("");
          setOpening("0");
          setColor("#1f5f74");
        }}>取消编辑</button>}
      </form>
    </>
  );
}

function CategoriesPanel({ categories, onSave }: { categories: Category[]; onSave: (item: Category) => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [parentId, setParentId] = useState("__other__");
  const [editing, setEditing] = useState<Category | null>(null);
  const activeCategories = activeOnly(categories);
  const topCategories = activeCategories.filter((category) => !category.parentId && category.kind === kind);
  const groupedParents = activeCategories.filter((category) => !category.parentId);

  function editCategory(category: Category) {
    setEditing(category);
    setName(category.name);
    setKind(category.kind);
    setParentId(category.parentId ?? "");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    let nextParentId: string | null = parentId || null;
    if (!editing && parentId === "__other__") {
      let parent = otherCategory(activeCategories, kind);
      if (!parent) {
        parent = makeCategory({ name: "其他", kind, parentId: null, icon: "folder", color: kind === "expense" ? "#6b6f3f" : "#2f7d4f" });
        await onSave(parent);
      }
      nextParentId = parent.id;
    }
    await onSave({
      ...(editing ?? makeCategory({ name, kind, parentId: nextParentId })),
      name,
      kind,
      parentId: nextParentId,
      version: editing ? editing.version + 1 : 1,
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });
    setName("");
    setParentId("__other__");
    setEditing(null);
  }

  return (
    <>
      <div className="panel management-panel">
        <h2>分类</h2>
        <div className="category-tree">
          {groupedParents.map((parent) => {
            const children = activeCategories.filter((category) => category.parentId === parent.id);
            return (
              <div className="category-group" key={parent.id}>
                <div className="category-line">
                  <strong>{parent.kind === "income" ? "收入" : "支出"} · {parent.name}</strong>
                  <button className="icon-button" onClick={() => editCategory(parent)} title="编辑一级分类"><Pencil size={16} /></button>
                </div>
                {children.map((child) => (
                  <div className="category-line child" key={child.id}>
                    <span>{child.name}</span>
                    <button className="icon-button" onClick={() => editCategory(child)} title="编辑二级分类"><Pencil size={16} /></button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <form className="panel form-stack" onSubmit={submit}>
        <h2>{editing ? "编辑分类" : "新增分类"}</h2>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="分类名称" required />
        <select value={kind} onChange={(event) => setKind(event.target.value as Category["kind"])}>
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
        <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
          <option value="">作为一级分类</option>
          {!editing && <option value="__other__">放入其他（默认）</option>}
          {topCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <button className="primary">保存分类</button>
        {editing && <button type="button" className="ghost" onClick={() => {
          setEditing(null);
          setName("");
          setParentId("__other__");
        }}>取消编辑</button>}
      </form>
    </>
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
  const [month, setMonth] = useState(monthKey());
  const [categoryKind, setCategoryKind] = useState<Category["kind"]>("expense");
  const reportTransactions = transactions.filter((item) => item.occurredAt.startsWith(month));
  const monthSummary = summarizeMonth(transactions, month);
  const categoryTotal = Math.max(1, reportTransactions
    .filter((item) => item.type === categoryKind)
    .reduce((sum, item) => sum + item.amountCents, 0));

  const categoryData = useMemo(() => {
    const totals = new Map<string, { id: string; name: string; value: number; color: string }>();
    reportTransactions.filter((item) => item.type === categoryKind).forEach((item) => {
      const category = categories.find((entry) => entry.id === item.categoryId);
      const id = category?.id ?? "uncategorized";
      const current = totals.get(id) ?? {
        id,
        name: category ? categoryPath(category, categories) : "未分类",
        value: 0,
        color: category?.color ?? "#8a7154"
      };
      current.value += item.amountCents;
      totals.set(id, current);
    });
    return Array.from(totals.values()).sort((left, right) => right.value - left.value);
  }, [reportTransactions, categories, categoryKind]);

  const donutGradient = categoryData.length
    ? `conic-gradient(${categoryData.map((entry, index) => {
      const start = categoryData.slice(0, index).reduce((sum, item) => sum + item.value, 0) / categoryTotal * 100;
      const end = (categoryData.slice(0, index).reduce((sum, item) => sum + item.value, 0) + entry.value) / categoryTotal * 100;
      return `${entry.color} ${start}% ${end}%`;
    }).join(", ")})`
    : "conic-gradient(rgba(49, 71, 58, 0.12) 0 100%)";

  const trendData = Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (11 - index));
    const key = monthKey(date);
    const summary = summarizeMonth(transactions, key);
    return {
      month: key,
      income: summary.incomeCents,
      expense: summary.expenseCents,
      net: summary.netCents
    };
  });
  const maxTrend = Math.max(1, ...trendData.map((entry) => Math.max(entry.income, entry.expense, Math.abs(entry.net))));

  return (
    <section className="report-page">
      <div className="panel report-toolbar">
        <div>
          <h2>分析报表</h2>
          <span>{month} · 收入支出与分类结构</span>
        </div>
        <input value={month} onChange={(event) => setMonth(event.target.value)} type="month" />
      </div>

      <div className="report-metrics">
        <Metric title="月收入" value={monthSummary.incomeCents} icon={ArrowDownLeft} tone="good" />
        <Metric title="月支出" value={monthSummary.expenseCents} icon={ArrowUpRight} tone="warn" />
        <Metric title={monthSummary.netCents >= 0 ? "净流入" : "净流出"} value={monthSummary.netCents} icon={CircleDollarSign} tone={monthSummary.netCents >= 0 ? "good" : "warn"} />
      </div>

      <section className="grid two report-grid">
        <div className="panel chart-panel category-analysis">
          <div className="chart-heading">
            <h2>分类统计</h2>
            <div className="segmented compact">
              {(["expense", "income"] as Category["kind"][]).map((item) => (
                <button key={item} type="button" className={categoryKind === item ? "active" : ""} onClick={() => setCategoryKind(item)}>
                  {item === "expense" ? "支出" : "收入"}
                </button>
              ))}
            </div>
          </div>
          <div className="donut-wrap">
            <div className="donut-chart" style={{ background: donutGradient }}>
              <div>
                <strong>¥{centsToYuan(categoryTotal === 1 && categoryData.length === 0 ? 0 : categoryTotal)}</strong>
                <span>{categoryKind === "expense" ? "分类支出" : "分类收入"}</span>
              </div>
            </div>
          </div>
          <div className="donut-list">
            {categoryData.length === 0 && <p className="empty">本月暂无{categoryKind === "expense" ? "支出" : "收入"}分类数据</p>}
            {categoryData.map((entry) => {
              const ratio = Math.round((entry.value / categoryTotal) * 100);
              return (
                <div className="budget-line" key={entry.id}>
                  <span><i className="dot" style={{ background: entry.color }} />{entry.name}</span>
                  <strong>¥{centsToYuan(entry.value)} · {ratio}%</strong>
                  <div className="bar"><i style={{ width: `${ratio}%`, background: entry.color }} /></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel chart-panel trend-panel">
          <h2>月度收入 / 支出 / 净流向</h2>
          <div className="trend-legend">
            <span><i className="legend income-bar" />收入</span>
            <span><i className="legend expense-bar" />支出</span>
            <span><i className="legend net-positive" />净流入/流出</span>
          </div>
          <div className="trend-bars monthly-flow">
          {trendData.map((item) => {
            return (
              <div className="trend-month" key={item.month}>
                <div className="trend-stack">
                    <i className="income-bar" title={`收入 ¥${centsToYuan(item.income)}`} style={{ height: `${Math.max(4, (item.income / maxTrend) * 100)}%` }} />
                    <i className="expense-bar" title={`支出 ¥${centsToYuan(item.expense)}`} style={{ height: `${Math.max(4, (item.expense / maxTrend) * 100)}%` }} />
                    <i className={item.net >= 0 ? "net-line net-positive" : "net-line net-negative"} title={`${item.net >= 0 ? "净流入" : "净流出"} ¥${centsToYuan(Math.abs(item.net))}`} style={{ height: `${Math.max(4, (Math.abs(item.net) / maxTrend) * 100)}%` }} />
                </div>
                <span>{item.month.slice(5)}</span>
                <small className={item.net >= 0 ? "net-positive-text" : "net-negative-text"}>{item.net >= 0 ? "+" : "-"}{centsToYuan(Math.abs(item.net))}</small>
              </div>
            );
          })}
          </div>
        </div>
      </section>
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
