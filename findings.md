# Findings & Decisions

## Requirements
- Improve the quick-entry number keypad: larger safer touch targets, lower accidental save/clear/退格 risk, better feedback.
- Add report anomaly analysis for each month: identify超预算,环比异常,历史异常,低频大额, and专项支出 reminders.
- Add note-taking for monthly analysis results and anomaly items.
- Persist notes so they remain after refresh/reopen and sync to cloud server.
- Update GitHub and cloud server.

## Research Findings
- Shared data types currently include accounts, categories, transactions, and budgets only.
- API Prisma schema currently has User, Ledger, Account, Category, Transaction, Budget, AuditLog; no analysis note table.
- Web IndexedDB currently stores accounts, categories, transactions, budgets, meta, and outbox.
- Reports component lives in `apps/web/src/App.tsx` and already separates daily expenses from special expenses.
- Quick entry keypad is `AmountKeypad` in `apps/web/src/App.tsx`; CSS lives under `.amount-keypad`, `.amount-keypad-grid`, `.amount-key`.
- API Docker image already runs `npm --workspace @ledger/api run prisma:push` before start, so the new table can be applied during normal lightweight server update.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Add AnalysisNote as first-class synced entity | User requires notes to persist across refresh/reopen and cloud server. |
| Store notes by month plus optional subject key | Allows monthly general notes and per-anomaly notes with stable keys. |
| Keep anomaly detection in web layer initially | Analysis derives from existing local data and does not need server computation. |
| Remove save action from the number keypad | Keeps numeric input and commit action separate, reducing accidental saves. |
| Require historical anomaly to also increase MoM | Avoids warning on categories that are below last month but above sparse 3-month average. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Playwright's bundled Chromium was missing | Used the installed Chrome channel for screenshot checks. |
| Seeded report test initially opened IndexedDB with a lower fixed version | Opened the existing DB without specifying a version. |
| Seeded `买菜` example produced a misleading historical anomaly while MoM decreased | Added MoM-increase guard to historical anomaly logic. |

## Resources
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/web/src/App.tsx`
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/web/src/styles.css`
- `/Users/frori/Vibecoding/personal-ledger-pwa/packages/shared/src/index.ts`
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/api/prisma/schema.prisma`
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/api/src/index.ts`
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/web/src/db.ts`

## Visual/Browser Findings
- Mobile entry page: keypad now uses larger 3-column touch targets; save remains sticky at the bottom.
- Mobile reports page with seeded data: anomaly panel shows budget status, total spending, projected daily spending, top increases/decreases, monthly note, and collapsed anomaly items.
- Seeded data confirmed that decreasing categories no longer trigger historical increase warnings.
