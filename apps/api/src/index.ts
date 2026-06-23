import "./types.js";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, centsToYuan, type SyncPayload } from "@ledger/shared";
import bcrypt from "bcryptjs";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { prisma } from "./prisma.js";
import { serializeAccount, serializeAnalysisNote, serializeBudget, serializeCategory, serializeSnapshot, serializeTransaction } from "./serializers.js";

type ExportFormat = "ledger" | "portable" | "suishouji" | "qianji";

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(40).optional()
});

const accountSchema = z.object({
  name: z.string().min(1).max(40),
  type: z.string().min(1),
  openingBalanceCents: z.number().int().default(0),
  color: z.string().min(1).default("#31473a")
});

const categorySchema = z.object({
  name: z.string().min(1).max(40),
  kind: z.enum(["expense", "income"]),
  parentId: z.string().uuid().nullable().optional(),
  icon: z.string().min(1).default("circle"),
  color: z.string().min(1).default("#31473a")
});

const transactionSchema = z.object({
  type: z.enum(["expense", "income", "transfer"]),
  accountId: z.string().uuid(),
  toAccountId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  amountCents: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  note: z.string().max(500).nullable().optional(),
  merchant: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().min(1).max(24)).default([])
});

const budgetSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amountCents: z.number().int().positive()
});

const analysisNoteSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  subjectType: z.enum(["month", "anomaly"]),
  subjectKey: z.string().min(1).max(160),
  content: z.string().max(2000)
});

async function getLedgerForUser(userId: string) {
  const ledger = await prisma.ledger.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: "asc" } });
  if (!ledger) throw Object.assign(new Error("账本不存在"), { statusCode: 404 });
  return ledger;
}

async function touchLedger(ledgerId: string) {
  return prisma.ledger.update({
    where: { id: ledgerId },
    data: { serverVersion: { increment: 1 } },
    select: { serverVersion: true }
  });
}

async function loadSnapshot(ledgerId: string) {
  const [ledger, accounts, categories, transactions, budgets, analysisNotes] = await Promise.all([
    prisma.ledger.findUniqueOrThrow({ where: { id: ledgerId }, select: { serverVersion: true } }),
    prisma.account.findMany({ where: { ledgerId }, orderBy: { createdAt: "asc" } }),
    prisma.category.findMany({ where: { ledgerId }, orderBy: { createdAt: "asc" } }),
    prisma.transaction.findMany({ where: { ledgerId }, orderBy: { occurredAt: "desc" } }),
    prisma.budget.findMany({ where: { ledgerId }, orderBy: { month: "desc" } }),
    prisma.analysisNote.findMany({ where: { ledgerId }, orderBy: [{ month: "desc" }, { updatedAt: "desc" }] })
  ]);
  return serializeSnapshot({ accounts, categories, transactions, budgets, analysisNotes, serverVersion: ledger.serverVersion });
}

function csvEscape(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function typeLabel(type: string) {
  if (type === "income") return "收入";
  if (type === "transfer") return "转账";
  return "支出";
}

function datePart(value: Date) {
  return value.toISOString().slice(0, 10);
}

function timePart(value: Date) {
  return value.toISOString().slice(11, 19);
}

function categoryParts(category?: { name: string; parentId?: string | null } | null) {
  return { primary: category?.parentId ? "" : category?.name ?? "", secondary: category?.parentId ? category.name : "" };
}

function exportRow(format: ExportFormat, item: {
  occurredAt: Date;
  type: string;
  account: { name: string };
  toAccount?: { name: string } | null;
  category?: { name: string; parentId?: string | null } | null;
  amountCents: number;
  merchant?: string | null;
  note?: string | null;
  tags: string[];
}) {
  const category = categoryParts(item.category);
  const signedAmount = item.type === "expense" ? `-${centsToYuan(item.amountCents)}` : centsToYuan(item.amountCents);
  if (format === "portable") {
    return [
      datePart(item.occurredAt),
      timePart(item.occurredAt),
      typeLabel(item.type),
      category.primary,
      category.secondary || item.category?.name,
      item.account.name,
      item.toAccount?.name,
      signedAmount,
      item.merchant,
      item.note,
      item.tags.join("|")
    ];
  }
  if (format === "suishouji") {
    return [
      typeLabel(item.type),
      datePart(item.occurredAt),
      timePart(item.occurredAt),
      category.primary || "其他",
      category.secondary || item.category?.name || "其他",
      item.account.name,
      item.toAccount?.name,
      centsToYuan(item.amountCents),
      item.merchant,
      item.note
    ];
  }
  if (format === "qianji") {
    return [
      datePart(item.occurredAt),
      typeLabel(item.type),
      item.category?.name ?? "其他",
      item.account.name,
      centsToYuan(item.amountCents),
      item.merchant,
      item.note
    ];
  }
  return [
    item.occurredAt.toISOString(),
    item.type,
    item.account.name,
    item.toAccount?.name,
    item.category?.name,
    centsToYuan(item.amountCents),
    item.merchant,
    item.note,
    item.tags.join("|")
  ];
}

function exportHeaders(format: ExportFormat) {
  if (format === "portable") return ["日期", "时间", "类型", "一级分类", "二级分类", "账户", "转入账户", "金额", "商户", "备注", "标签"];
  if (format === "suishouji") return ["交易类型", "日期", "时间", "一级分类", "二级分类", "账户1", "账户2", "金额", "商家", "备注"];
  if (format === "qianji") return ["日期", "类型", "分类", "账户", "金额", "商户", "备注"];
  return ["日期", "类型", "账户", "转入账户", "分类", "金额", "商户", "备注", "标签"];
}

function parseExportFormat(value: unknown): ExportFormat {
  return value === "portable" || value === "suishouji" || value === "qianji" ? value : "ledger";
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.NODE_ENV !== "test" });

  await app.register(cors, { origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(jwt, { secret: config.JWT_SECRET });

  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    await request.jwtVerify();
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/register", async (request, reply) => {
    const input = authSchema.parse(request.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (existing) return reply.code(409).send({ message: "邮箱已注册" });

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name ?? "我的账本",
        passwordHash,
        ledgers: {
          create: {
            name: "个人账本",
            accounts: { create: DEFAULT_ACCOUNTS },
            categories: { create: DEFAULT_CATEGORIES }
          }
        }
      },
      include: { ledgers: true }
    });

    const token = await reply.jwtSign({ sub: user.id });
    return { token, user: { id: user.id, email: user.email, name: user.name }, ledgerId: user.ledgers[0]?.id };
  });

  app.post("/auth/login", async (request, reply) => {
    const input = authSchema.omit({ name: true }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return reply.code(401).send({ message: "邮箱或密码不正确" });
    }
    const ledger = await getLedgerForUser(user.id);
    const token = await reply.jwtSign({ sub: user.id });
    return { token, user: { id: user.id, email: user.email, name: user.name }, ledgerId: ledger.id };
  });

  app.get("/bootstrap", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    return loadSnapshot(ledger.id);
  });

  app.post("/accounts", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const input = accountSchema.parse(request.body);
    const account = await prisma.account.create({ data: { ...input, ledgerId: ledger.id } });
    await touchLedger(ledger.id);
    return serializeAccount(account);
  });

  app.post("/categories", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const input = categorySchema.parse(request.body);
    const category = await prisma.category.create({ data: { ...input, ledgerId: ledger.id } });
    await touchLedger(ledger.id);
    return serializeCategory(category);
  });

  app.post("/transactions", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const input = transactionSchema.parse(request.body);
    const transaction = await prisma.transaction.create({
      data: {
        ...input,
        ledgerId: ledger.id,
        occurredAt: new Date(input.occurredAt)
      }
    });
    await touchLedger(ledger.id);
    return serializeTransaction(transaction);
  });

  app.put("/transactions/:id", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = transactionSchema.partial().parse(request.body);
    const transaction = await prisma.transaction.update({
      where: { id, ledgerId: ledger.id },
      data: {
        ...input,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        version: { increment: 1 },
        deletedAt: null
      }
    });
    await touchLedger(ledger.id);
    return serializeTransaction(transaction);
  });

  app.delete("/transactions/:id", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const transaction = await prisma.transaction.update({
      where: { id, ledgerId: ledger.id },
      data: { deletedAt: new Date(), version: { increment: 1 } }
    });
    await touchLedger(ledger.id);
    return serializeTransaction(transaction);
  });

  app.post("/transactions/:id/restore", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const transaction = await prisma.transaction.update({
      where: { id, ledgerId: ledger.id },
      data: { deletedAt: null, version: { increment: 1 } }
    });
    await touchLedger(ledger.id);
    return serializeTransaction(transaction);
  });

  app.post("/budgets", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const input = budgetSchema.parse(request.body);
    const budget = await prisma.budget.create({ data: { ...input, ledgerId: ledger.id } });
    await touchLedger(ledger.id);
    return serializeBudget(budget);
  });

  app.post("/analysis-notes", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const input = analysisNoteSchema.parse(request.body);
    const note = await prisma.analysisNote.create({ data: { ...input, ledgerId: ledger.id } });
    await touchLedger(ledger.id);
    return serializeAnalysisNote(note);
  });

  app.get("/sync/pull", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    return loadSnapshot(ledger.id);
  });

  app.post("/sync/push", { preHandler: [app.authenticate] }, async (request) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const payload = request.body as Partial<SyncPayload>;

    for (const item of payload.accounts ?? []) {
      const { id, updatedAt, deletedAt, version: _version, ...data } = item;
      await prisma.account.upsert({
        where: { id },
        create: { id, ...data, ledgerId: ledger.id, deletedAt: deletedAt ? new Date(deletedAt) : null },
        update: { ...data, ledgerId: ledger.id, deletedAt: deletedAt ? new Date(deletedAt) : null, version: { increment: 1 } }
      });
    }
    for (const item of payload.categories ?? []) {
      const { id, updatedAt, deletedAt, version: _version, ...data } = item;
      await prisma.category.upsert({
        where: { id },
        create: { id, ...data, ledgerId: ledger.id, deletedAt: deletedAt ? new Date(deletedAt) : null },
        update: { ...data, ledgerId: ledger.id, deletedAt: deletedAt ? new Date(deletedAt) : null, version: { increment: 1 } }
      });
    }
    for (const item of payload.transactions ?? []) {
      const { id, updatedAt, deletedAt, version: _version, occurredAt, ...data } = item;
      await prisma.transaction.upsert({
        where: { id },
        create: {
          id,
          ...data,
          ledgerId: ledger.id,
          occurredAt: new Date(occurredAt),
          deletedAt: deletedAt ? new Date(deletedAt) : null
        },
        update: {
          ...data,
          ledgerId: ledger.id,
          occurredAt: new Date(occurredAt),
          deletedAt: deletedAt ? new Date(deletedAt) : null,
          version: { increment: 1 }
        }
      });
    }
    for (const item of payload.budgets ?? []) {
      const { id, updatedAt, deletedAt, version: _version, ...data } = item;
      await prisma.budget.upsert({
        where: { id },
        create: { id, ...data, ledgerId: ledger.id, deletedAt: deletedAt ? new Date(deletedAt) : null },
        update: { ...data, ledgerId: ledger.id, deletedAt: deletedAt ? new Date(deletedAt) : null, version: { increment: 1 } }
      });
    }
    for (const item of payload.analysisNotes ?? []) {
      const { id, updatedAt, deletedAt, version: _version, ...data } = item;
      await prisma.analysisNote.upsert({
        where: { id },
        create: { id, ...data, ledgerId: ledger.id, deletedAt: deletedAt ? new Date(deletedAt) : null },
        update: { ...data, ledgerId: ledger.id, deletedAt: deletedAt ? new Date(deletedAt) : null, version: { increment: 1 } }
      });
    }

    await touchLedger(ledger.id);
    return loadSnapshot(ledger.id);
  });

  app.get("/export/csv", { preHandler: [app.authenticate] }, async (request, reply) => {
    const ledger = await getLedgerForUser(request.user.sub);
    const { format } = z.object({ format: z.string().optional() }).parse(request.query);
    const exportFormat = parseExportFormat(format);
    const transactions = await prisma.transaction.findMany({
      where: { ledgerId: ledger.id, deletedAt: null },
      include: { account: true, toAccount: true, category: true },
      orderBy: { occurredAt: "desc" }
    });
    const rows = [
      exportHeaders(exportFormat).join(","),
      ...transactions.map((item) => exportRow(exportFormat, item).map(csvEscape).join(","))
    ];
    return reply.header("content-type", "text/csv; charset=utf-8").send(`\ufeff${rows.join("\n")}`);
  });

  return app;
}

const app = await buildApp();

try {
  await app.listen({ host: "0.0.0.0", port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
