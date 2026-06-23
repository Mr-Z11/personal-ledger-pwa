# Task Plan: keypad and monthly anomaly analysis

## Goal
Improve quick-entry keypad confidence and add professional monthly spending anomaly analysis with persistent analysis notes.

## Current Phase
Phase 6

## Phases

### Phase 1: Discovery
- [x] Inspect entry keypad implementation
- [x] Inspect report analytics implementation
- [x] Inspect API/shared persistence model
- **Status:** complete

### Phase 2: Data Model and Sync
- [x] Add analysis note shared type/schema
- [x] Add API bootstrap/sync support
- [x] Add web IndexedDB support
- **Status:** complete

### Phase 3: Keypad UX
- [x] Redesign keypad layout for lower mis-tap risk
- [x] Separate destructive actions from commit path
- [x] Add clearer press/disabled feedback
- **Status:** complete

### Phase 4: Report Analytics and Notes
- [x] Add monthly summary analysis
- [x] Add category anomaly detection using budget, previous month, and 3-month baseline
- [x] Add monthly and anomaly note UI
- **Status:** complete

### Phase 5: Verification and Deployment
- [x] Run build/test
- [x] Push GitHub
- [x] Deploy cloud server
- [x] Verify production health
- **Status:** complete

### Phase 6: Entry Feedback and Report Context
- [x] Add keypad haptic fallback and press confirmation
- [x] Add amount preview motion and saved-state confirmation
- [x] Add sticky report period context
- [x] Label report modules by data scope
- [x] Verify, push, deploy
- **Status:** complete

## Key Questions
1. Where should notes persist so they survive refresh and sync to cloud?
2. How should anomaly IDs remain stable across refreshes and months?
3. How can keypad reduce accidental save/clear actions while keeping one-screen entry?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use confirmed anomaly thresholds from task package | User confirmed proposed thresholds. |
| Keep专项支出 separate from日常消费 anomaly analysis | Existing app semantics distinguish日常消费 and专项支出. |
| Persist notes as AnalysisNote synced entity | Notes must survive refresh and sync to cloud. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Playwright bundled browser missing | Tried headless Chromium | Used installed Chrome channel for visual checks. |
| IndexedDB version mismatch in test harness | Opened `ledger-box` with fixed version 2 | Opened existing DB without a fixed version for the seeded UI check. |
| False historical anomaly for a category that decreased MoM | Seeded report data exposed conflict | Required historical anomaly to also increase versus previous month. |
| Report context anchor did not stick in mobile browser check | Tried `position: sticky` with `align-self: start` | Used a mobile fixed context bar with report-page spacing. |

## Notes
- Confirmed requirements: all keypad friction points exist; add professional anomaly analysis and persistent analysis notes.
- Deploy to GitHub/cloud after implementation.
- New confirmed requirements: add input confirmation feeling (press feedback, haptic where supported, amount preview) and reduce report confusion while scrolling by making month/data scope obvious.
