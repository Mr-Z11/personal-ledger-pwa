# 任务交接

## 1. 当前任务目标

维护个人记账 PWA 的日常迭代与数据安全。**云端服务器已于 2026-08-29 失效**，当前数据完全以本地 Mac 为中心（local-first 架构 + 本地 PostgreSQL）。云端重建与否待用户决策。

## 2. 已完成并部署的变更（2026-10-19 最新）

最新 commit `5f6b54e` 已推送 GitHub main（SSH 通道；https 直推被沙箱代理 502 拦截）；前端已构建并部署到**本地 Mac 栈**（云端服务器仍失效，见第 3 节）。

| Commit | 描述 | 关键文件 | 状态 |
|--------|------|---------|------|
| `5f6b54e` | **记账输入体验三连改**：① 删除内置 AmountKeypad 数字键盘（组件+全部样式），金额输入 `inputMode=decimal` 直接弹系统键盘，行内加 × 清空按钮；② 分类搜索框+全部分类下拉常驻显示（不再藏在「搜索」按钮后），头部显示分类总数；③ 备注从折叠区移出常显（时间、商户仍折叠），减少展开导致的版面跳动；键盘弹出时 body.keyboard-open 隐藏底部导航/悬浮按钮/浮层提示、保存条取消 sticky、输入区加 scroll-margin，避免固定元素随键盘上移盖住输入框造成页面跳动 | App.tsx, styles.css | 已部署 |
| `0c63832` | **全页面模块标题/内容字号对齐报表设置基准**：基准=标题 0.95rem/700、副题 0.75rem/700、标签 0.72rem/700、数值 0.95rem/700、徽章 0.72rem/700。修总览（标题 1rem/900→0.95/700、quick-card 标签 0.74→0.72rem、数值 1.02→0.95rem、蓄水池 1rem→0.95rem、三模块副题补全局规则）、报表（toolbar/分类统计/趋势面板标题、趋势副题 0.76→0.75rem、趋势徽章 0.62→0.72rem）、规划（4 标题 + 副题 0.78→0.75rem）、搜索（标题+副题）；补 h2 字重 700（Tailwind preflight 会把 h2 打成 400）；删三处表单头 0.92rem 与移动端 0.88/0.62/0.66rem 过期覆盖。无头 Chrome 390px 五页复测全部达标 | styles.css | 已部署 |
| `2d417e1` | **报表 6 模块密度对齐设置页 + 字号加粗统一**：模块头 padding 0.5/0.85rem、gap 0.6rem；折叠体 0.85/0.7rem；标题统一 0.95rem/700（原三种规格：report-fold 1rem/900、insights 1rem/400 未加粗、special 0.74rem/900）；小字 0.75rem/700；卡片标签 0.72rem/700、数值 0.95rem/700；移动端过小标签 0.62/0.66rem 上调；修 insights 标题块 strut 撑高 4px | styles.css | 已部署 |
| `6608ef0` | **设置页标题「?」修复**：`.settings-section summary span{display:block}` 把标题里 InfoTip 的 span 也块级化导致「?」独占一行；改 `:not(.info-tip)` 排除后「?」恢复紧跟标题（无头 Chrome 390px 实测 sameLine=true） | styles.css | 已部署 |
| `d6deee4` | **删除冗余抬头 + 说明全「?」化**：分类维护删「分类」h2（说明「?」包进消费/收入切换标签行，新增 `.category-kind-wrap`）；账户管理删「账户」h2（「?」跟新增按钮后）；三个内联编辑表单头（新增账户/分类/预算）说明改「?」贴 h2，编辑态「正在编辑：X」数据行保留 | App.tsx, styles.css | 已部署 |
| `3187576` | **「?」气泡内联排版**：InfoTip 不单独占行，全部贴到被解释文字后（标题/标签/状态条/预算行名后）；删计划购买 2 条独立问号；预算说明入 `renderBudgetLine(budget, tip?)` 参数；保险说明并入标题；推送提示入状态条 | App.tsx, widgets.tsx, plan.tsx | 已部署 |
| `81428ab` | **说明/备注「?」气泡化（InfoTip）**：新增复用组件（? 按钮 + 点击气泡 + 外部/Esc 关闭）；设置页 5 模块描述、预算 scope、工资/限额/固定支出/计划购买/保险日历说明段改造；错误态/交互提示/数据型小字保持 inline | widgets.tsx, App.tsx, plan.tsx, styles.css | 已部署 |
| `997adb7` | **预算管理抬头精简 + 间距一致性**：删「日常消费预算/总开支预算」两个 h2；说明小字移列表底部；手机端 chart-heading 抬头↔小字间距收紧至 0.12rem 全模块一致 | App.tsx, styles.css | 已部署 |
| `65df483` | **提醒去重**：已订阅 web push（localStorage ledger-push-subscribed）时前端 maybeNotifyDailyLimit / maybePraiseNoSpend 不再发本地 Notification，只由服务端单发 | widgets.tsx, App.tsx | 已部署 |
| `ba13f5f` | **表扬提醒修复**：noSpendPraiseDue zero 档改用今日全部支出（含专项，todayAllSpentCents）；服务端 checkSpendingAlerts 新增表扬分支（sendPraiseReminder，ReminderSetting 加 praiseEnabled 列，GET/PUT 同步），关 App 也能 web-push 送达（日志已验证 delivered:true） | widgets.tsx, App.tsx, api.ts, schema.prisma, api/index.ts, notifications.ts, widgets.smoke.test.tsx | 已部署 |
| `f2cb337` | **低消费表扬提醒**：DailyLimitAlertSettings 加 praiseEnabled（默认 true）；纯函数 noSpendPraiseDue（hour≥18=pm / ≥12=am；spent≤0=zero / spent<limit=thrifty，达/超限不表扬）+ praiseMessage（应急资金变厚/压力更小）；maybePraiseNoSpend 按 `日期:时段` 去重（每时段每天最多一条本地 Notification）；App 即时 effect + 10 分钟轮询双调用；设置页「低消费表扬」checkbox | widgets.tsx, App.tsx, widgets.smoke.test.tsx | 已部署 |
| `6f40518` | **搜索时间范围 + 设置默认收起 + 红警每次打开必弹**：搜索加「起始月/截止月」下拉（YYYY-MM 字符串比较，选项取自匹配结果月份）；设置页数据管理/数据同步去掉 defaultOpen 默认收起；当日限额红警改会话内关闭（useState 取代持久化 dismiss），超限后当天每次打开 App 都再弹 | widgets.tsx, App.tsx, styles.css | 已部署 |
| `203b247` | **搜索筛选+排序 + 底部导航 6 列**：搜索视图加分类/账户/排序（日期↑↓、金额↑↓）筛选，filtered 集合同时驱动概览卡/按月汇总/按年汇总/明细；手机 nav repeat(5,1fr)→repeat(6,1fr) 解决「搜索」按钮被挤到第二排 | widgets.tsx, App.tsx, styles.css | 已部署 |
| `6e39648` | **新增「搜索记录」视图**：关键词匹配备注/商户/标签/账户名/分类路径（排除 income 与已删除）；纯函数 searchMatches + aggregateByPeriod（sliceLen 7=按月、4=按年）；概览卡（笔数/支出合计/月均/区间）+ 按月/按年汇总（占比条）+ 明细倒序分页 +200；新 View=search + 底部导航「搜索」 | widgets.tsx, App.tsx, styles.css, widgets.smoke.test.tsx | 已部署 |
| `fb6939e` | **计划购买行更扁 + 固定支出参考项默认收起**：.planbuy-main/.planbuy-side 由 column 改 row（名字+状态同行、金额+操作同行），手机 @640px flex-wrap 单行布局；FixedExpenseOverview showSuggest 初始值 true→false | widgets.tsx, styles.css | 已部署 |
| `a003c39` | **预算管理行内编辑**：根因是 BudgetPanel 双列 grid 在 ≤940px 塌成单列，编辑表单落到列表下方；改为编辑态在该预算行内展开表单（金额 autoFocus + 保存/取消），右侧面板显示「正在编辑X」提示卡；`.budget-line span` 收窄为 `.budget-line > span` 防样式泄漏 | App.tsx, styles.css | 已部署 |
| `4bb1e77` | **计划购买精简**：移除「已买到手」前置 Check 图标（避免已完成错觉）；状态文案「今日余额可买，安排！」→「今日可买」；行内间距/字号全面压缩 | widgets.tsx, styles.css | 已部署 |
| `c0bbb08` | **日常消费动态日限额**：dailyLimitCents(budgets, transactions, categories, month) =（月日常预算 − 截至昨日日常支出）÷ 含今日剩余天数；当日自身消费不计入 → 当日限额日内恒定，盈余/超支只滚入次日及以后；BudgetReservoir 页脚「今日限额/今日还可花/剩 N 天」；todayRemainingCents 可为负（超限） | widgets.tsx, App.tsx, utils.ts, widgets.smoke.test.tsx | 已部署 |
| `1038d48` | 计划购买「已买到手」按钮改行动色青 #1f5f74，与已完成绿色状态区分（绿=状态、青=动作、红=删除/超支） | widgets.tsx, styles.css | 已部署 |
| `29b78d5` | 手动添加固定支出可选具体分类（下拉列全部分类路径），已支出按该分类当月消费自动累计；未关联行也可随时补关联 | widgets.tsx, styles.css | 已部署 |
| `0abe64f` | 固定支出手动添加提供规划/历史参考项（buildFixedExpenseSuggestions 复用常规项+保险日历口径），点选即添加；categoryId 关联后已支出显示「自动」只读，可「改手动」解除 | widgets.tsx, styles.css | 已部署 |
| `f98474c` | 总览「本月固定支出」改为手动维护：FixedExpenseItem 按月份 key 存 localStorage `ledger-fixed-expenses-<month>`；行内编辑项目/已支出/预计；合计四卡；「复制模板到下月」1-11 个月（spent 归零、不覆盖已有数据） | widgets.tsx, App.tsx, styles.css, widgets.smoke.test.tsx | 已部署 |
| `32cc58f` | **删除限额提醒时间**：DailyLimitAlertSettings 删 remindHour；面板删「提醒时间」下拉；遮罩删提示行；本地通知恢复达线即发（每天一次）；App syncDailyLimitSettings 固定传 dailyLimitHour:0 中和服务端门控 | widgets.tsx, App.tsx | 已部署 |
| `6950f5f` | 测试推送改中性文案「测试推送（通道验证）」：修 sendTestReminder 误发工资日文案；前端按钮改「发一条测试推送（验证通道）」；先用容器热补丁（docker cp dist + restart）端到端验证，CI 镜像后补齐 | apps/api/src/index.ts, apps/web/src/App.tsx | 已部署 |
| `964dfe4` | **推送修复 + 限额提醒时间 + 计划购买按钮语义**：VAPID subject 改合法域（Apple 曾判 403 BadJwtToken）；ReminderSetting 加 dailyLimitEnabled/Hour(21)/ToleranceCents，到点才推送；计划购买「已完成」→「已买到手」+ 垃圾桶删除 + 已买徽章 | schema.prisma, api/index.ts, notifications.ts, App.tsx, api.ts, widgets.tsx, styles.css | 已部署 |
| `a836ba3` | 设置→当日限额提醒区内新增 PushAlertPanel（订阅/退订/测试推送）；compose 透传 VAPID_*；**旧版工资推送面板移除后前端无订阅入口，服务端 daily-limit/planbuy 推送原本送不出去** | App.tsx, styles.css, docker-compose.local.yml, .env.local.example | 已部署 |
| `3a2a115` | **当日限额警告 + 计划购买清单**：固定支出文案「已完成」→「已支出」；新同步实体 PlannedPurchase（shared/Prisma/API/Dexie v3/outbox）；总览「计划购买」面板（录入/余额够买高亮/已完成/删除）；日限额（月日常预算÷天数，误差线 ¥20 可配）达线→全屏红色遮罩 + 本地通知；服务端 checkSpendingAlerts 推送 daily-limit / planbuy（ReminderLog 按天去重，只送达才写日志） | shared/src/index.ts, schema.prisma, api/index.ts, notifications.ts, serializers.ts, db.ts, App.tsx, widgets.tsx, styles.css | 已部署 |
| `d71d13d` | **总览页「本月固定支出」面板：逐项已支/剩/超进度条 + 合计三卡（固定项合计/已实现支出/待支出额度）；数据源与规划页一致（常规项 + 保险日历）；保险日历存储迁移 widgets.tsx（plan.tsx re-export）** | widgets.tsx, plan.tsx, App.tsx, styles.css, widgets.smoke.test.tsx | 已部署 |
| `294b00c` | 主要支出项保险按日历精确计入：配置日历后保险类从频率常规项剔除，无保费月份不再出现保险 | plan.tsx, styles.css, widgets.smoke.test.tsx | 已部署 |
| `c972ed0` | 规划锚点月选择器（默认本月）+ 回测（过去月份显示实际总支出对照） | plan.tsx, styles.css | 已部署 |
| `ca0cfc0` | 保险日历保存简化：删「保存日历」，行编辑自动保存，「解析并保存」唯一全宽主按钮 | plan.tsx, styles.css | 已部署 |
| `c359160` | 保险日历保存按钮无反应修复（disabled 条件误伤，改幂等可点 + 保存反馈） | plan.tsx, styles.css | 已部署 |
| `69a1227` | **保险缴费日历（本机 localStorage，保单数据不进仓库）：行编辑 + 批量粘贴导入；预测总支出 = 原预测 − 历史保险月均 + 当月日历保费；10/12 月无保险项** | plan.tsx, styles.css, widgets.smoke.test.tsx | 已部署 |
| `f382de2` | 规划页手机显示修复（趋势图随容器缩放 + 预测明细表内联标签自适应卡片 + 依据表可换行）；报表页四模块默认折叠（defaultOpen=false） | plan.tsx, styles.css, App.tsx | 已部署 |
| `e78b11d` | **手机端修复：导航 5 列不换行 + FAB 不再挡规划 + 常规项表格自适应（报表显示不全修复）；规划升级：覆盖总支出（4 KPI + 逐月预测明细表）+ 去年同期主权重预测（60% 去年 + 40% 近期基准）+ 标题统一带「预测」** | plan.tsx, widgets.tsx, App.tsx, styles.css, widgets.smoke.test.tsx | 已部署 |
| `46350bf` | **报表「常规项支出」模块 + 四个报表模块可折叠（异常分析移到大额开销上方）+ 新导航专栏「规划」（未来3个月消费/总支出预测图 + 主要支出项 + 分析依据）** | plan.tsx(新), widgets.tsx, App.tsx, styles.css, widgets.smoke.test.tsx | 已部署 |
| `7796d90` | 预算两层（日常/总开支 scope）+ 首页双蓄水池 + 消费节奏图（预算参考线）+ 大额开销规律分析 + 工资提醒纯本地化 + 默认首页改总览 | schema.prisma, shared, serializers, api/index.ts, App.tsx, widgets.tsx(新), utils.ts(新), styles.css | 已部署 |
| `d1907cf` | 手机（≤480px）两个蓄水池保持横向两列（删除堆叠规则，收紧间距字号） | styles.css | 已部署 |
| `717ff32` | 节奏图措辞口语化：「低于/超出预算平均线」→「比预算慢/快 ¥X」；图例改「预算参考线」；焦点卡改「预算每天可花 / 实际每天花」 | widgets.tsx, App.tsx | 已部署 |
| `2da791d` | 蓄水池数字可读性：读数包进磨砂玻璃卡片（半透明米白 + backdrop-blur + 阴影），任意水位高对比 | widgets.tsx, styles.css | 已部署 |
| `1929b20` / `7c6bacd` | 交接文件同步 + caddy 悬空挂载坑记录 | HANDOFF/findings/task_plan/progress | — |

### 2026-09-30 部署细节

- typecheck ✓ → vitest 10/10 ✓（新增常规项/规划页 4 用例）→ `mv apps/web/dist /tmp/...` → `npm run build` ✓ → `compose up -d --force-recreate caddy-local`
- 验证：`https://localhost:8443/` 200、`https://FrorideMacBook-Air.local:8443/` 200；App chunk 含「常规项支出」「分析依据与计算过程」，css 含「plan-kpi」
- 注意：首页入口 chunk 是 `index-*.js`，App 是异步 chunk，grep 验证要用 dist 里的 `App-*.js` 文件名
- 纯前端变更，API/DB 无改动，无需重启 api-local

### 2026-10-17 部署细节（Phase 26–28，12 commits）

- 全链路：typecheck ✓ → vitest 26/26 ✓ → `mv apps/web/dist /tmp/...`（规避 safe-delete shim）→ `npm run build` ✓ → `docker compose -f docker-compose.local.yml --env-file .env.local up -d --force-recreate caddy-local`
- 验证：`https://localhost:8443/` 200、`/api/health` 200；App chunk `App-Bqrt7isC.js` 含本轮全部特征串（搜索记录/关键词检索/按月汇总/按年汇总/清除筛选/起始月/今日限额/今日还可花/应急资金/低消费表扬/正在编辑/今日可买/参考项目/下次打开仍会提醒）
- 注意：caddy force-recreate 后偶发根路径 000（启动竞态），重试 curl 即 200
- 纯前端变更，API/DB/Prisma 无改动，无需重启 api-local、无需拉镜像
- git：沙箱代理（127.0.0.1:57589）挡 push → `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy git -c http.version=HTTP/1.1 push` 成功；远端早期 Git Data API 推送造成 4 个等价 commit SHA 分叉 → 确认重叠点 tree 相同（`git diff 262d917 6950f5f` 为空）后 `git rebase --onto origin/main 262d917 main` 重放 13 commits，origin/main 到达 `f2cb337`，本地 0/0

### 2026-09-30 预测算法 v2（去年同期主权重）

- 预测值 = 去年同期 × 0.6 + 近期基准 × 0.4（PLAN_LAST_YEAR_WEIGHT=0.6，plan.tsx 可调）
- 近期基准 =（近3月均值 + 近6月均值）÷ 2 × 趋势因子（近3月÷前3月，clamp 0.9~1.1）
- 每个未来月份独立取各自去年同月；去年无记录 → 退化为全额近期基准；区间 = 近6月与去年同期的 min~max 包络
- 手机底部导航：新增导航项必须同步改 `@media(max-width:940px)` 里 nav 的列数（当前 repeat(5,1fr)），否则换行 + FAB 遮挡
- 报表四个模块（节奏/常规项/异常分析/大额开销）默认折叠（ReportFold defaultOpen=false），用户点开看；不要改回默认展开
- 不要把保单/保费等真实财务数据硬编码进代码或提交仓库；保险日历存 localStorage（`ledger-insurance-schedule`），与工资提醒/大额阈值同为本机设置，换设备需重新导入

### 2026-09-25 部署细节

- CI (3609435) 构建 GHCR 镜像 → 本机 `docker pull --platform linux/amd64` → 备份（ledger-local-20260925-122935.sql, 3469 条）→ `compose up -d api-local` → 启动自动 `prisma db push` 添加 `Budget.scope` 列（已有 4 行预算全部落为 daily，正确）
- 本地 API health 通过；前端 dist 本地重新构建
- **每次重建 dist 后必须 `up -d --force-recreate caddy-local`**（配置未变时普通 `up -d` 不会重建，绑定挂载会悬空 → 根路径 403，手机看不到任何更新）
- 部署验证：`curl -sk https://localhost:8443/` 返回 200，且 App chunk / App css 含新特征字符串；`https://FrorideMacBook-Air.local:8443/` 返回 200
- vitest 冒烟测试 6 项通过（apps/web/src/widgets.smoke.test.tsx）

### 历史变更（2026-08-16，云端失效前最后部署）

`1e8be1c` 本地全栈接管+故障转移 · `314899d` CORS 修复 · `5a4f61a` 手机同步状态栏 · `909ac42` 状态栏滚动+自动隐藏 · `ffa0a54` amountCents BigInt + PWA autoUpdate（云端 HEAD 定格 ffa0a54）

### 历史变更（2026-08-15，全部已部署）

`dd3d237` 预算编辑/去重 · `adce292` 趋势气泡 · `78bdadd` UI 专业化 · `478d367` 工资日推送 · `116e8be` 空 body POST 修复 · `cfadb86` 本地同步模式 · `b3b1ffe` 双重存储 · `71752ca` setup-auto-backup.sh

### 2026-09-25 会话（本地运维修复，无新 commit）

- 修复本地 API crash-loop（RestartCount 11428，根因 colima VM 丢 qemu binfmt）：`docker run --rm --privileged tonistiigi/binfmt --install amd64`
- 排除旧镜像 `--accept-data-loss` 数据降级风险：拉取 `--platform linux/amd64` 新镜像（BigInt），`db push` 零数据变更
- **改进 `scripts/start-local-sync.sh`（未提交）**：启动前自动注册 binfmt + 自动拉取匹配镜像，防 VM 重启复发
- 打通手机同步：确认 mDNS fallback 自动生效，手机 8-31 后数据全部入本地 PG（3416→3469，最新 2026-09-24）
- 升级前备份：`backups/pre-image-upgrade-20260925-101948.sql.gz`；导出存档 `Desktop/记账数据-截至2026-09-25.xlsx`

### 2026-10-18 工作（未提交，已部署本地栈）

> 以下为 **2026-10-18 当天**的 UI 紧凑化迭代，**仍未 `git commit`**（自 `f2cb337` 起 5 个文件 modified、未推送；用户尚未批准提交）。代码已 build 并用 `force-recreate caddy-local` 重新挂载到本地栈，手机刷新即见。

| 文件 | 本轮改动摘要 | 状态 |
|------|------|------|
| `apps/web/src/styles.css` | 整体 UI 密度收紧（面板/卡片/行/页面边距/字号）、设置页单独收紧、分类维护单行母版、账户管理单行+折叠式新增、预算管理行内编辑样式、预算/固定支出/专项支出单行压缩、分析报表 7 模块「框大字小」只降框高不动字号 | 已部署本地栈，未提交 |
| `apps/web/src/App.tsx` | 账户管理单行化 + 折叠式「新增账户」、预算管理行内编辑 + 折叠式「新增预算」、预算行压缩为单行（budget-info / mini-bar / 操作） | 已部署本地栈，未提交 |
| `apps/web/src/widgets.tsx` | 计划购买折叠式「新增」(showAdd)、固定支出行/专项支出行单行化样式配套 | 已部署本地栈，未提交 |
| `apps/api/src/notifications.ts` | 服务端动态日限额公式与前端对齐（按「截至昨日」口径，不再静态 ÷ 当月天数） | 已部署本地栈，未提交（需 api-local 热补丁或重拉镜像才生效） |
| `apps/web/src/widgets.smoke.test.tsx` | 冒烟测试随 widgets/App 改动小幅更新 | 已部署本地栈，未提交 |

**部署状态**：前端 5 文件改动已 build → `docker compose -f docker-compose.local.yml --env-file .env.local up -d --force-recreate caddy-local` 重新挂载；`https://localhost:8443/` 与 mDNS 入口均 200，磁盘 CSS 已确认含全部新令牌。
**后端（notifications.ts）**：纯 JS，可 `docker cp apps/api/dist/. api-local:/app/apps/api/dist/ && docker restart api-local` 热补丁验证；或等 CI 镜像后 `docker pull --platform linux/amd64 ghcr.io/mr-z11/personal-ledger-pwa-api:main && compose up -d api-local`。
**未提交原因与提交方法**：用户本会话未批准 commit/push；如需提交用 `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy git -c http.version=HTTP/1.1 push`（沙箱代理挡直连 push）；远端若因历史 Data API 推送产生等价 commit 分叉，先 `git diff <本地等价> <远端等价>` 确认 tree 相同再 `git rebase --onto origin/main <本地等价> main` 重放，切勿 force push。
**详细逐条记录**：见项目记忆 `.workbuddy/memory/2026-10-18.md`（本轮 9 项改动均有条目）。

## 3. 当前环境状态（2026-09-25 更新）

### ⚠️ 云端已失效（2026-08-29 起）

- 服务器 `47.74.3.104`：ping 通但 **80/443 全关**，仅 22 开放；**SSH host key 已变更**（疑实例被重装或释放后 IP 回收分配他人）。**确认归属前不要删 known_hosts 硬连**（有连到他人机器的风险）
- 最后成功云备份：`ledger-cloud-20260829-030322.sql`；此后 `auto-backup.log` 每日 Cloud FAILED
- 云端数据定格在 2026-08-29 前；**云端重建与否待用户决策**

### 本地 Mac 栈（当前唯一活跃数据中心）

- 容器：postgres-local(healthy) + api-local + caddy-local，全部运行
- 本地 API：`https://localhost:8443/api` / `https://192.168.3.21:8443/api` / `https://FrorideMacBook-Air.local:8443/api`
- 数据库：**3469 笔（2020-05-31 ~ 2026-09-24）**，bigint 金额列，serverVersion 122；**Budget 表 2026-09-25 新增 scope 列（daily/total）**
- api-local 镜像：GHCR main @ 7796d90（含预算两层 + 工资本地化后端；服务端推送后续经 Git Data API/热补丁更新至 6950f5f 内容）
- 前端静态文件：`apps/web/dist` 本地构建 @ f2cb337，由 caddy-local 挂载 `/srv/web`（**改 dist 后需 force-recreate caddy-local**）
- **2026-10-18 补充**：当前 dist 已包含本轮未提交改动（自 `f2cb337` 起 5 文件 modified），前端已重新挂载；git 工作区未提交，用户尚未批准 commit/push
- 前端版本核对方法：`curl -sk https://localhost:8443/` → 200；取 dist 目录里的 App chunk 文件名（如 `App-Bqrt7isC.js`）后 `curl -sk https://localhost:8443/assets/App-*.js | grep -c "<特征串>"` → ≥1（App 是异步 chunk，入口是 index-*.js）
- 冒烟测试：`npm --workspace @ledger/web run test` → widgets.smoke.test.tsx 26 项全过（含动态日限额/搜索/表扬用例）
- 手机 8-31 后数据已于 2026-09-25 11:15 全部同步入本地 PG（用户确认）
- 物理数据：`data/local-postgres/`（65MB，Docker 卷挂载，容器删除数据不丢）
- **风险**：数据仅 Mac 单点，建议异地备份

## 4. 数据存储架构（双重存储，全自动）

```
云端 PostgreSQL (primary)  ←→  本地备份文件 (backups/*.sql)  ←→  本地 PostgreSQL (fallback)
        ↑ 自动故障转移（前端 apiFetch，无需手动改设置）
```

### 自动化备份（全部由 macOS launchd 管理，不依赖 WorkBuddy）

- **`com.personal-ledger.data-backup`**: 每天 03:00 跑 `scripts/auto-backup.sh`（RunAtLoad=true，睡眠错过唤醒补跑）
- **`com.personal-ledger.colima`**: 登录时自动 `colima start`（Docker VM 常驻）
- **auto-backup.sh 策略**: 云端在线→SSH 拉云端库；云端离线→自动备份本地 PG（`ledger-local-*.sql`）；Docker 没跑→自动 `colima start` 自愈
- **服务器自身 cron**: 每日 03:15 自动备份 PostgreSQL

### data-sync.sh 工具（6 个命令）

- `bash scripts/data-sync.sh status` — 查看云端/本地/备份三方面状态
- `bash scripts/data-sync.sh backup-cloud` — 从云端 dump 到 backups/ 文件
- `bash scripts/data-sync.sh backup-local` — 从本地 PG dump 到 backups/ 文件
- `bash scripts/data-sync.sh restore-to-local [file]` — 恢复到本地 PG（先 DROP SCHEMA）
- `bash scripts/data-sync.sh sync-cloud-to-local` — 云端→本地 PG 实时同步
- `bash scripts/data-sync.sh sync-local-to-cloud` — 本地→云端推送
- `SSH_ALIAS` 环境变量可覆盖（测试离线兜底用）

### 关键技术坑

- SSH 管道传输 >700K 数据会被 SIGKILL（exit 137）→ 服务器端 gzip 压缩后传输
- Git push SSH 绕过 Clash 代理：`GIT_SSH_COMMAND="ssh -o ProxyCommand=none" git push git@github.com:...`
- 本地 arm64 Docker 构建因 tsup/esbuild 原生二进制问题不可用 → 用 GHCR amd64 镜像 + qemu 模拟
- CSS 是 minified 的，验证部署时 grep 用无空格形式（如 `overflow-x:auto`）
- Prisma 表名是 PascalCase（`"Transaction"` 非 `transactions`）
- data-sync.sh 的 last_tx 查 `occurredAt`（交易时间）而非 `createdAt`（插入时间），且排除已删除记录
- **colima VM 重启后丢失 qemu binfmt 注册** → amd64 镜像 `exec format error` crash-loop；必须重跑 `docker run --rm --privileged tonistiigi/binfmt --install amd64`（已固化进 start-local-sync.sh）
- **本地镜像版本必须匹配数据库 schema**：旧镜像（Int）+ 数据库（bigint）会触发 `prisma db push` 要求 `--accept-data-loss` → 拉匹配镜像，切勿放行降级
- **`docker pull` 必须带 `--platform linux/amd64`**（arm64 宿主默认找 arm64 manifest 报 `no matching manifest`）
- **Service Worker `urlPattern: pathname.startsWith("/api")` 匹配任何 origin**，切本地地址后 `/api` 请求被 SW NetworkFirst 拦截；但 **workbox 默认只路由 GET**，POST/OPTIONS 直接走网络
- **iOS WKWebView（PWA）不信任 IP 类 SAN 证书，信任 DNS 类 SAN 证书** → 本地同步地址必须用 mDNS 域名（`FrorideMacBook-Air.local`），不能用 IP（会 fetchevent/no-response）
- **"URL is not valid"** = 手动输入地址字符串语法非法，fetch() 页面层解析即抛错；**清空地址用自动 fallback 优于手动输入**（mDNS fallback 已编译进 bundle 并自动生效）
- `SyncSettingsPanel.handleSave()` 强制 reload → `hydrateFromServer()` 只拉不推，会用本地旧数据覆盖 IndexedDB 同 ID 记录；切换地址后须立即点"同步"让 outbox 推回修正

## 5. 本地全栈（Mac 上的完整后备环境）

- **容器运行时**（免 sudo 手动安装）: `~/bin/{docker,colima}`、`~/opt/lima/limactl`、`~/.docker/cli-plugins/docker-compose`；colima VM 用 vz（Apple M2）
- **本地栈**: `docker-compose.local.yml`（postgres-local + api-local + caddy-local）
- **本地 API 入口**: `https://localhost:8443/api`（Caddy 自签证书，tls internal + on_demand）
- **本地 Caddy 同时提供 PWA 静态文件**: apps/web/dist → /srv/web
- **Caddy 根证书**: `~/Desktop/Caddy-Local-CA.crt` 需安装到系统钥匙串并设"始终信任"（一次性）
- **JWT_SECRET**: 与云端一致（`.env.local`）
- **CORS**: API 已允许全方法（GET/HEAD/POST/PUT/DELETE/PATCH/OPTIONS），本地 CORS_ORIGIN=*

### 前端 API 自动故障转移

- `apps/web/src/api.ts` 的 apiFetch：云 API 不可达时自动切到 fallback 端点
- Fallback: `https://localhost:8443/api` + `https://FrorideMacBook-Air.local:8443/api`（mDNS）
- localStorage 健康追踪 + 2 分钟冷却；云恢复后自动切回
- `VITE_FALLBACK_API_BASES` 通过 CI build-arg 编入 JS bundle

## 6. 关键文件位置

### 2026-09-30 新增/重构模块

| 文件 | 用途 |
|------|------|
| `apps/web/src/plan.tsx` | 「规划」专栏：`PlanView`（KPI 卡 + 趋势预测图 + 主要支出项 + 分析依据折叠区）、`buildPlanHistory`（近6月序列，当月按日均投影）、`forecastFromHistory`（基准=(近3月均值+近6月均值)/2 × 趋势因子 clamp 0.9~1.1） |
| `apps/web/src/widgets.tsx` | 追加 `RegularExpensePanel` + `collectRegularExpenses`（常规项：同一分类近6月出现≥3次，逐月迷你柱+月均+环比，top8）；`FixedExpenseOverview`（总览固定支出面板，2026-10-01 新增）；保险日历存储实现（loadInsuranceSchedule/saveInsuranceSchedule/parseInsuranceText/scheduledInsuranceCents，2026-10-01 自 plan.tsx 迁入） |
| `apps/web/src/App.tsx` | `ReportFold` 通用折叠面板（details 默认展开可收起）；报表模块顺序：消费节奏→常规项→消费异常分析→大额开销→核心洞察→专项支出→分类统计/趋势；新增 View=`plan` 导航（CalendarClock 图标，报表与设置之间） |

### 2026-10-17 新增/重构模块（Phase 26–28）

| 文件 | 用途 |
|------|------|
| `apps/web/src/widgets.tsx` | `FixedExpenseOverview` 改**纯手动维护**（FixedExpenseItem 按月份 localStorage `ledger-fixed-expenses-<month>`；`buildFixedExpenseSuggestions` 提供参考项；categoryId 关联后已支出按当月该分类自动汇总显示「自动」；`copyFixedExpensesToFuture` 模板复制）；`dailyLimitCents(budgets, transactions, categories, month)` 动态日限额（当日恒定，只滚入次日）；`PlannedPurchasePanel` 单行扁平化 + 青色「已买到手」动作按钮；**新 `SearchView`**（searchMatches/aggregateByPeriod 纯函数 + 筛选/排序/时间范围/分页）；`noSpendPraiseDue`/`praiseMessage`/`maybePraiseNoSpend` 低消费表扬（时段 am/pm × zero/thrifty，`日期:时段` 去重） |
| `apps/web/src/App.tsx` | `BudgetPanel` 行内编辑（编辑态在预算行内展开表单，消除跳转底部）；View 新增 `search`（底部导航第 5 项，流水与报表之间）；当日限额红警改会话内关闭（超限当天每次打开都弹）；即时 effect + 10 分钟轮询双调 maybePraiseNoSpend；设置页数据管理/数据同步默认收起 |
| `apps/web/src/widgets.smoke.test.tsx` | 26 项冒烟测试：动态日限额（当日消费不改变日限额）、searchMatches（排除收入/已删除）、aggregateByPeriod 按月/年口径、noSpendPraiseDue/praiseMessage 时段与档位 |

### 2026-09-25 新增/重构模块

| 文件 | 用途 |
|------|------|
| `apps/web/src/widgets.tsx` | `BudgetReservoir`（蓄水池 SVG 水位）、`SalaryBanner` + `LocalSalaryReminderPanel`（纯本地工资提醒）、`DailyPaceChart`（每日累计 vs 预算参考线）、`TrendFocusCards`（环比/同比/近3月趋势/日均对比）、`BigExpensePanel`（大额清单 + 规律识别） |
| `apps/web/src/utils.ts` | 从 App.tsx 抽出的纯函数（日期/金额/专项分类判定/预算汇总），widgets 与 App 共用 |
| `apps/web/src/widgets.smoke.test.tsx` | vitest + renderToString 冒烟测试（6 项，无浏览器环境可跑） |

### 关键行为约定（改动前务必了解）

- 预算模型：`categoryId` 非空 = 分类预算；`categoryId=null & scope=daily` = 日常消费预算；`categoryId=null & scope=total` = 总开支预算（含日常+专项）
- 日常消费 vs 专项支出：靠 `isNonDailyExpenseCategory()` 关键词正则划分（贷款/保险/教育/购车养车等），节奏图与趋势卡只统计日常消费
- 默认首页是 `overview`（蓄水池），记账 FAB 仍指向 `entry`
- 本地设置（不同步服务器）：`localStorage` 键 `ledger-salary-reminder`（工资提醒）、`ledger-big-expense-threshold`（大额判定线）、`ledger-salary-dismissed`、`ledger-salary-notified`、`ledger-insurance-schedule`（保险日历）、`ledger-fixed-expenses-<month>`（分月固定支出手动维护，模板复制到未来月）、`ledger-daily-limit-alert`（限额提醒开关/误差金额/系统通知/praiseEnabled 低消费表扬）、`ledger-no-spend-praise-notified`（表扬去重，值=`YYYY-MM-DD:am|pm`）

| 文件 | 用途 |
|------|------|
| `apps/web/src/App.tsx` | 前端主应用（含 .mobile-sync-bar 手机同步状态栏） |
| `apps/web/src/widgets.tsx` | 蓄水池/工资横幅/节奏图/趋势焦点卡/大额面板/工资设置（2026-09-25 新增） |
| `apps/web/src/utils.ts` | 纯工具函数（从 App.tsx 抽取，供 widgets 复用） |
| `apps/web/src/api.ts` | API 请求层（apiFetch 自动故障转移 + 运行时可配 API_BASE） |
| `apps/web/src/styles.css` | 全部前端样式 |
| `apps/web/public/push-sw.js` | Service Worker 推送处理 |
| `apps/api/src/notifications.ts` | Web Push 发送 + 工资日定时器 |
| `apps/api/src/index.ts` | API 路由入口（CORS 全方法） |
| `apps/api/src/serializers.ts` | 序列化（bigint→Number() 转换） |
| `apps/api/prisma/schema.prisma` | 数据模型（amountCents/openingBalanceCents 为 BigInt） |
| `apps/web/vite.config.ts` | VitePWA（registerType: autoUpdate, skipWaiting, clientsClaim） |
| `scripts/data-sync.sh` | 双向数据同步工具（6 命令） |
| `scripts/auto-backup.sh` | 自动备份（云端在线/离线双策略 + colima 自愈） |
| `scripts/verify-pwa-startup.mjs` | PWA 启动回归检查（已允许 skipWaiting/clientsClaim） |
| `docker-compose.local.yml` | 本地 Docker Compose 配置 |
| `deploy/Caddyfile.local` | 本地 Caddy 自签 HTTPS + PWA 静态文件 |
| `deploy/com.personal-ledger.data-backup.plist` | launchd 每日备份 |
| `deploy/com.personal-ledger.colima.plist` | launchd 登录启动 Docker |
| `docs/data-storage-guide.md` | 完整双重存储策略文档 |
| `backups/恢复说明.md` | 数据恢复流程 |

## 7. 重要规则和限制

- 真实财务数据、`.env`、备份、密钥不得提交 GitHub
- 服务器 ~2 GiB RAM，不在服务器构建镜像
- 安全部署流程：typecheck → build → push → 等 CI → `deploy/update-server.sh` → 验证 health
- 服务器到期前必须确保本地有最新备份
- `data/local-postgres/` 是本地数据库数据目录，不可删除
- 金额字段（amountCents 等）必须保持 BigInt，勿改回 Int（integer 上限 21.4 亿分 = 2140 万元，真实交易可超）

## 8. 服务器到期后的故障切换（全自动，无需手动）

1. 服务器到期 → 前端 apiFetch 自动切换到本地端点（localhost:8443 / mDNS），数据继续写入本地 PG
2. Mac 重启 → launchd 自动 `colima start` → 本地栈自动可用
3. 每天 03:00 → auto-backup.sh 检测云端离线 → 自动备份本地 PG（ledger-local-*.sql）
4. 手机在 Mac 局域网内时走 mDNS 端点；跨网络时 App 降级离线模式暂存 IndexedDB，回到局域网自动同步
5. 续费新服务器后: `bash scripts/data-sync.sh sync-local-to-cloud` 推送数据

## 9. 不要重复做的事情

- 不要重新调查 2026-08-16 的 6 个 commit 是否上线；全部已部署到 `ffa0a54`
- 不要重新排查"手机端同步失败"问题；根因（amountCents Int 溢出）已修复，265 条已全部同步成功
- 不要重新实现手机端同步状态栏；已实现（滚动 + 自动隐藏）
- 不要把 PWA registerType 改回 "prompt"（iOS 独立模式下更新提示不显示，用户会一直用旧版本）
- 不要用直接 SSH 管道传输大文件（>700K 会被 kill）；用 gzip 压缩后传
- 不要在沙箱内尝试 `launchctl load`/`crontab`；让用户在 Terminal 手动执行
- 不要把数据库备份或 `.env` 提交到 GitHub
- 不要在小内存服务器上构建镜像
- 不要尝试本地 arm64 构建 API 镜像（tsup/esbuild 原生二进制问题）；用 GHCR amd64 + qemu
- 不要在 `prisma db push` 报 `BigInt→Integer` 警告时加 `--accept-data-loss`（会把 3416 条真实数据金额列降级）；应拉取与数据库 schema 匹配的镜像
- 本地同步地址不要填 IP（iOS WKWebView 不信 IP 类证书，会 fetchevent）；用 mDNS 域名 `FrorideMacBook-Air.local:8443`
- 不要 `docker pull` 不带 `--platform linux/amd64`（arm64 宿主会报 `no matching manifest`）
- 不要以为"点同步"能切换同步地址；也无需手动填地址——自动 fallback（mDNS）已生效，或在设置里改 mDNS 地址
- 不要删 known_hosts 硬连 47.74.3.104（host key 已变，IP 可能已分配给他人）
- 不要卸载/重装手机端 PWA（会清空 IndexedDB，丢失未同步数据）
- 不要把"无分类预算"直接当日常预算用；Budget 有 scope 字段，查询必须过滤 `scope ?? "daily"`，否则总开支预算会串进日常统计
- 不要恢复旧版 Web Push 工资提醒面板（前端已移除，工资提醒改纯本地 localStorage）；但**不要删后端 notifications.ts / push-sw.js**：自 3a2a115 起它负责当日限额与计划购买的服务端推送
- 服务器端推送要生效必须三件事齐备：api-local 注入 VAPID_*（写在 .env.local，不提交；compose 已透传）+ 手机 PWA 内点过「开启手机推送」（PushSubscription 有记录）+ API 镜像含 checkSpendingAlerts（3a2a115 之后）
- 不要在沙箱里直接 vite build 而不处理 dist 清空拦截（safe-delete shim）；先 `mv apps/web/dist /tmp/...` 再 build
- **不要忘了：改 dist 后必须 `docker compose -f docker-compose.local.yml --env-file .env.local up -d --force-recreate caddy-local`**，否则 caddy 挂载悬空 → 页面 403，手机看不到任何更新（配置未变时普通 `up -d` 不重建容器）
- 不要在"总开支预算"存在时把它当日常预算用；`monthBudgetTotal` 已按 `scope ?? "daily"` 过滤，勿改回 `find(!categoryId)`
- 不要把规划页预测金额改成按 6 个月窗口平均；常规项预测用「有支出的月份」均值（窗口均值会低估非满勤固定项），常规项模块的月均才是窗口均值——两处口径不同是有意的
- 不要 grep 首页引用的入口 chunk 验证新功能（入口是 index-*.js，App 是异步 chunk）；用 dist 里的 App-*.js 文件名直接 curl 验证
- 不要给手机端模块设固定 min-width（如常规项表格曾经的 34rem）——手机视口 ~390px 会"显示不全"，改为 grid 自适应列布局；plan 趋势图是例外（SVG viewBox 680 固定，靠 .plan-chart-wrap 横滚）
- 不要改 PLAN_LAST_YEAR_WEIGHT 的语义（去年同期主权重 60% 是用户明确要求）；调权重只改 plan.tsx 常量
- 不要把总览「今日还可花」当静态日限额：动态日限额 =（月日常预算 − 截至昨日日常支出）÷ 含今日剩余天数，当日自身消费不改变当日限额，只滚入次日及以后（c0bbb08 起，用户明确纠正过概念）
- 新增底部导航入口必须同步改 `@media(max-width:940px)` 里 nav 的列数（当前 repeat(6,1fr)），否则入口换行很难看（「搜索」上线时踩过）
- 预算编辑不要跳转到页面底部表单（移动端双列 grid 塌陷的根源）；已在预算行内展开编辑，保持此模式
- 不要把当日限额红警改成持久化 dismiss（用户要求：超限后当天无论何时打开 App 都是红色警报）；dismiss 仅会话内有效
- 低消费表扬的去重键是 `日期:时段`（每天上午/下午各一条），不是整天一条；达到/超限额不表扬
- 计划购买的动作按钮（已买到手）不要用绿色——绿色只代表真实状态（已买徽章/今日可买），动作用青色，删除/超支用红色（1038d48 起的配色语义）
- git push 被沙箱代理挡时不要反复重试同一命令：用 `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy git -c http.version=HTTP/1.1 push`；若远端因 GitHub Data API 推送产生等价 commit SHA 分叉，先确认重叠点 tree 相同再 `git rebase --onto origin/main <本地等价commit> main` 重放，切勿 force push 覆盖
- caddy force-recreate 后根路径偶发 000 是启动竞态，重试 curl 即可，不要误判为部署失败去排查容器
- 不要为「框大字小」去改字号凑比例——用户要的是「字号不变、只降框高」；只用 padding/min-height/gap 收紧，font-size 一律不动
- 列表行单行化已成母版范式：名称+金额同行、操作按钮 flex-row，移动端操作降级为纯图标（`.text-action span{display:none}`）；新列表行直接复用 `.category-line`/`.budget-line`/`.fixed-expense-row` 同款 3 列 `minmax(0,1fr) auto auto`
- 所有「新增」入口统一为「分类维护折叠式」：默认只显示青色虚线 toggle，点击展开内联表单、保存自动收起，不要再做常驻右侧表单
- 账户/预算等「列表+编辑」用行内编辑（编辑态在行内展开表单），不要回到双列 grid（≤940px 塌成单列会把表单挤到列表下方）

- **沙箱内 git push 走 https 被代理拦（CONNECT 502 / Empty reply）时，直接改走 SSH：`git push git@github.com:Mr-Z11/personal-ledger-pwa.git main`（ssh 22 与 ssh.github.com:443 都通，验证于 2026-10-19）**
- 键盘弹出遮挡/跳动类问题统一用 `body.keyboard-open` 标记解决（focusin/focusout 维护），不要再逐页写 focus 监听
## 10. 待确认/建议下一步

- **手机端实测反馈（最新，2026-10-17）**：总览手动「本月固定支出」（行内编辑/参考项点选/关联分类自动跟踪/复制模板到下月）、计划购买单行扁平观感、预算行内编辑、搜索记录视图（关键词+筛选+排序+起始/截止月+按月年汇总）、底部导航 6 入口单行不换行、设置页数据管理/同步默认收起、超限额红警每次打开必弹、低消费表扬通知（需手机 PWA 已允许通知；上午/下午各一条）—— 本地 origin PWA 划掉重开两次即可看到
- **用户需在手机上操作**：规划页「保险缴费日历（本机）」→ 批量导入 → 粘贴保单清单（会话中已给出粘贴文本）→ 保存；保存后预测明细表「保险日历」列应显示 10 月/12 月"无保费"、11 月有保费
- **手机端 PWA 需要用户操作确认**：若 PWA 是从云端 origin（ledger.47.74.3.104.sslip.io）安装的，云端失效后永远收不到更新，需从 `https://FrorideMacBook-Air.local:8443` 重新「添加到主屏幕」（数据已全部入本地 PG，删除旧 PWA 安全）；若本就是本地 origin 安装，划掉重开两次即可。**用户是否已完成重装、手机实测反馈尚未回收**
- **用户已提出的观察点**：首页蓄水池数字可读性（已改为磨砂玻璃读数卡，待手机实测确认）；两个蓄水池横向排列（已修）
- **`scripts/start-local-sync.sh` 的改进尚未提交**（自动注册 binfmt + 自动拉镜像），建议提交
- **云端 47.74.3.104 归属待确认**：是否重装/被回收？决定是重建云端还是彻底转向纯本地架构
- **数据异地备份（紧迫）**：当前数据仅 Mac 单点 + backups/，建议把 backups/ 自动复制到云盘/移动硬盘
- 建议用户检查那条金额约 1 亿元的交易（amountCents=9999999900），很可能是输入错误
- 导出功能在 iOS PWA 独立模式静默失败（`a.download` 被 WebKit 忽略）；如需手机导出，改用 Web Share API（`navigator.share`），但仅本地 origin 的 PWA 能受益
- `limactl` 二进制缺失导致 `colima status/list` 失败；docker 仍可用，但建议修复 lima PATH 便于管理 VM
- findings.md 中 P0 项「reliable-sync 工作包」（串行化 syncNow、逐行 ack outbox、启动先 flush 再 pull）尚未实施，是后续可靠性改进的首选

## 2026-10-18 表扬提醒修复（ba13f5f + 去重补丁）
- **依据修复**：noSpendPraiseDue 的 zero 档改用「今日全部支出」（含专项/贷款/保险），新增 todayAllSpentCents；专项支出不再误判「一分钱没花」
- **后台推送**：checkSpendingAlerts 新增表扬分支（zero 用全部支出 / thrifty 用日常对比日限额），ReminderSetting 加 praiseEnabled 列，设置 GET/PUT 同步；关 App 也能经本地 api-local web-push 送达（已验证日志 delivered:true）
- **重复去重**：前端 maybeNotifyDailyLimit / maybePraiseNoSpend 在已订阅 web push（localStorage ledger-push-subscribed=1）时跳过本地 Notification，由服务端单发；PushAlertPanel 订阅/取消时写该标志
- **部署**：前端 build + caddy force-recreate；后端 CI 构建镜像 → pull → api-local up（prisma db push 自动加 praiseEnabled 列）；迁移前已备份 ledger-local-20261018-174148.sql

## 2026-10-18 预算管理抬头精简 + 抬头↔小字间距一致性（App.tsx + styles.css）
- 预算管理：删除「日常消费预算」「总开支预算」两个 h2 抬头（预算行 scope 徽标 + 底部说明已可区分），原抬头下小字（budget-scope-hint）下移到各自列表底部作脚注；两个面板加 `.budget-scope-panel`
- CSS：`.budget-scope-hint` margin `0.1rem 0 0.5rem → 0.5rem 0 0`；`.budget-scope-panel .budget-list { margin-top: 0 }`（无抬头后列表贴顶）
- 一致性：手机端 `.chart-heading` 上下堆叠时 h2↔span 间距由 0.55/0.65rem 收紧为 0.12rem（与 `.report-toolbar` 内 span、设置摘要 span 一致）
- 已部署：前端 build + force-recreate caddy-local

## 2026-10-18 说明/备注文字统一改为「?」气泡（InfoTip 组件，App/widgets/plan + styles.css）
- 新增复用组件 `InfoTip`（widgets.tsx）：一个「?」按钮，点击弹出说明气泡，点外部/Esc 关闭；样式 `.info-tip/.info-tip-btn/.info-tip-pop`
- 已转换（纯说明/备注、无关键数据）：设置页 5 个模块描述（SettingsSection，? 贴在标题后）、预算管理 2 条 scope 说明、工资/当日限额/固定支出/计划购买/保险日历的 reminder-hint 说明段（各归位到原文字位置）
- 刻意保留 inline：`reminder-hint.warn`（权限被拒等错误态）、带按钮的交互提示、以及含金额/笔数/匹配数等数据的 chart-heading/report-toolbar 小字（隐藏会丢信息）
- 已部署：前端 build + force-recreate caddy-local

## 2026-10-18 「?」气泡改为跟随文字内联排版（3187576，已推送 origin/main）
- 用户反馈「?」不要单独占一行 → 全部 InfoTip 挪到被解释文字旁内联；`.info-tip` 为 `inline-flex + vertical-align:middle + margin-left:.28rem` 保证与文字基线对齐
- 计划购买：删除两条独立 InfoTip（文字已合并进标题问号）；保险缴费日历说明并入 `<h2>` 标题问号（plan.tsx）
- 手机推送提示：从 PushAlertPanel 底部挪入 `.reminder-status` 状态条内联（App.tsx）
- 预算面板：`renderBudgetLine(budget, tip?)` 加可选参数，说明贴 `budget-name` 后内联；未设置预算的空状态行也带问号；顺手修 `categoryBudgets.map(renderBudgetLine)` 把索引误传为 tip 的隐患
- 校验：typecheck 通过、31 个冒烟测试通过、build 成功、force-recreate caddy-local 已部署（线上 HTML/CSS/JS 均含 info-tip 新令牌）

## 2026-10-18 删除账户/分类冗余抬头，说明统一「?」化（d6deee4，已推送 origin/main）
- 用户反馈「分类维护」展开后「分类」抬头 + 一大段说明啰嗦 → 删除抬头，说明改「?」；同类问题全模块扫描后一并修改
- **分类维护**：删 `<h2>分类</h2>` 与说明段；「?」包进消费/收入切换标签行（新增 `.category-kind-wrap` 承接原 `flex:1 1 11rem`，toolbar 成为面板首元素 margin 归零，与预算面板一致）
- **账户管理**：删 `<h2>账户</h2>` 与说明段；「?」跟在「新增账户」按钮后（`.account-toolbar` flex 行内）
- **三个内联编辑表单头**（新增账户/新增分类/新增预算）：说明段改「?」贴 h2 后；编辑态「正在编辑：X」数据行保留 inline（`.inline-form-head h2` margin:0，删 p 无残留间距）
- 保留未动：报表/规划页图表标题的数据型小字（金额/笔数/权重）、空态引导语（固定支出/计划购买/搜索的「还没有…」提示，空的时候正是需要引导的时候）
- 校验：typecheck + 31 冒烟通过；build + force-recreate caddy-local 已部署（新 bundle `App-0pKuPKVC.js` 含新文案，CSS 含 `category-kind-wrap`）

## 2026-10-18 设置页标题「?」独占一行修复（6608ef0，已推送 origin/main）
- 用户反馈：设置页几个模块的「?」都是单独一行，要全部放到标题后面
- **根因**（无头 Chrome 390px 实测 DOM/计算样式确认）：`.settings-section summary span { display: block }` 原为副标题小字设计，但 InfoTip 的根元素也是 `<span class="info-tip">`，被这条规则块级化 → 「?」掉到标题下方独占一行（computed display=block、width=285px 撑满）
- **修复**：该规则改 `.settings-section summary span:not(.info-tip)`；「?」恢复 `inline-flex`，实测 sameLine=true、「?」在标题文字右侧 4px；点击只弹气泡不误折叠模块（stopPropagation 生效）
- 排查工具沉淀：`~/.workbuddy/binaries/node/workspace/` 装有 playwright-core，可用「本地签发 JWT（JWT_SECRET 签 sub=用户id）+ 无头 Chrome（executablePath=/Applications/Google Chrome.app/...、ignoreHTTPSErrors）+ addInitScript 写 ledger-token」渲染需登录的页面并截图；当天超限额时先点「知道了」关 daily-limit-overlay 再操作

## 2026-10-18 报表 6 模块密度对齐设置页 + 字号加粗统一（2d417e1，已推送 origin/main）
- 用户反馈：报表中本月消费节奏/常规项支出/核心洞察/消费异常分析/大额开销/专项支出 6 个模块太大显得字小，要参考「设置」的密度，并注意字体大小和加粗一致性
- **框体收紧（对齐设置）**：模块头 padding 0.6/0.88 → **0.5/0.85rem**、gap 0.8 → 0.6rem；折叠体 padding 1.1rem → **0.85/0.7rem**；页面模块间距 0.72 → 0.6rem；面板内距 0.78 → 0.7rem；工具栏 padding 0.78/0.9 → 0.6/0.85rem
- **标题统一 0.95rem/700**（原来三种规格：report-fold 1rem/900、insights 1rem/**400 没加粗**、special span 0.74rem/900）；小字统一 0.75rem/700 弱化色
- **卡片统一**：标签 0.72rem/700、数值 0.95rem/700（节奏卡数值 1.05rem 作页面主数字）；移动端过小标签（异常卡 0.62rem、指标卡 0.66rem）上调至 0.72rem
- **strut 坑修复**：insights 标题容器是普通 block，行内 span 受父级 24px 行高 strut 影响把标题块撑高 4px（44px vs 子元素 37px）→ 改 flex 纵向堆叠后与 report-fold 头齐平（均 56px）
- 校验：typecheck + build（PWA 校验通过）+ force-recreate caddy-local；无头 Chrome 390px 实测 6 模块标题全部 15.2px/700（与设置页 sectionTitle 完全一致）、头高 63/67 → 56px；逐模块截图目验通过

## 2026-10-18 全页面模块标题/内容字号对齐报表设置基准（0c63832，已推送 origin/main）
- 诉求：「继续排查其他模块的标题字体大小与内容字体大小，要与『报表』『设置』内的模块保持一致」。
- 方法：先无头 Chrome 390px 全页面审计（总览/流水/搜索/报表/规划/设置的 h2、副题、标签、数值 computed style），与基准对比列出不一致清单，再定向改 CSS，改完全面复测 + 截图目验。
- 基准（沿用上轮报表/设置定稿）：标题 0.95rem/700、副题 0.75rem/700、卡片标签 0.72rem/700、卡片数值 0.95rem/700、徽章 0.72rem/700。
- 主要修正：① 通用 h2 1rem→0.95rem；② `.panel .chart-heading h2` 补 700（原 900）；③ 固定支出/计划购买 1.04rem、趋势面板 1.02rem→0.95rem；④ quick-card 标签 0.74rem/900→0.72rem/700、数值 1.02rem→0.95rem；⑤ 蓄水池标题 1rem→0.95rem、副字移动端 0.62rem 删除；⑥ 新增全局 `.chart-heading span:not(.info-tip)` 副题规则（总览三模块原本无规则继承 16px/400）；⑦ 删 `.report-page` 作用域 0.78rem/900 旧副题规则；⑧ 趋势面板徽章 0.62rem/950→0.72rem/700、标签 0.7→0.72rem/700、数值 0.98→0.95rem/700；⑨ report-toolbar span 0.8→0.75rem；⑩ inline-form-head p 0.82→0.75rem + 删三处 0.76rem 覆盖。
- **关键坑：Tailwind preflight 把 h1-h6 的 font-size/font-weight 重置为 inherit**——本项目 body 是 1rem/400，所以任何没显式设 font-weight 的 h2 都会渲染成 400（审计发现「分析报表」「支出规划」两个 toolbar 标题是 400）。report-toolbar h2 / inline-form-head h2 / settings-section-body .panel h2 / edit-panel h2 共 4 处补 700。今后新增标题规则必须同时写 font-weight。
- 保留不动的（设计使然，已在 commit message 列明）：hero 大数字、非报表 metric 1.45rem、交易详情标题 1.12rem、日限额全屏警报（1.5rem/2.6rem）、row 列表组件（全页共享规则，跨页已一致）、表单 label/输入控件、图表内部微字/脚注。
- 验证：typecheck ✓ 31 冒烟 ✓ build 6.1s ✓ force-recreate caddy-local；无头 Chrome 390px 复测五页模块标题全部 15.2px/700、副题 12px/700、标签 11.52px/700、数值 15.2px/700；三页截图目验通过。
