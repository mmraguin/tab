# tab — Claude Reference

> Read MEMORY.md before starting any session. Move resolved entries to MEMORY-ARCHIVE.md when a feature is stable and unlikely to change.

---

## What this is

Mobile-first personal budget dashboard (Philippines, PHP). Single `index.html` + `style.css`. No framework, no build step. GitHub Pages — push to main, live in ~30 seconds. Read-only: data comes from Google Sheets via Apps Script GET endpoint.

```
WEBHOOK = 'https://script.google.com/macros/s/AKfycbxy2zzSSdVP4zoLO8em6hUkAnNran5lq2_U1QIbMgVRutHuVeE_KBRzkRiEbc9X7GeMQA/exec'
```

---

## Active Projects

See MEMORY.md for full context. Current in-flight:

- **Pull to refresh** — not built. Approach agreed: touch events + `overscroll-behavior:contain`, call existing `fetchData()`.
- **Bank statement reconciliation (Feature 2)** — not built. Scoped: CSV-first (GCash, Maya, UnionBank), PDF harder (UnionBank Credit). Match on date + amount against Activity sheet, write via logger webhook.

---

## Rules — follow these exactly

**Code style**
- `var` only — never `let` or `const`
- Function declarations, not arrow functions
- String concatenation — no template literals
- All styles go in `style.css`, never inline beyond layout values

**Dates — critical**
- Always use `parseDate(v)`. Never parse raw date strings.
- Apps Script serializes dates as UTC ISO (`2026-01-31T16:00:00.000Z`). In UTC+8, that's Feb 1 locally. `parseDate` handles this via UTC extraction → local Date construction.

**Goals tab**
- Goal progress = `available / target` where `target = yearlyGoal > 0 ? yearlyGoal : goal * 12`. Never use `totalAssigned` as fallback — causes fake 100% when goal fields are blank.
- Group sections use `.goal-group` wrapper. `.goal-group + .goal-group` has `margin-top: 32px` for visual separation.
- `groupHeader(label, cats)` renders the group label + total amounts + progress bar. Bar color: accent while in progress, income (green) when funded, expense (red) if negative.
- Do not show a percentage on the group total — the bar + amount display is sufficient.

**Accounts**
- Account names must exactly match `ACCOUNTS` array and Activity sheet col L / AccountSnapshot col B.
- `AccountSnapshot` (col E = Actual Balance) is the preferred source. Activity `Balance` rows are fallback only.

**Adding UI sections**
- New tab content goes in the appropriate `render*()` function.
- New CSS classes go in `style.css` under the relevant section comment.
- Match existing token usage: `--income`, `--expense`, `--accent`, `--warn`, `--transfer`.

---

## Architecture

```
Google Sheets (Apps Script)
    │  HTTP GET → JSON { budget, activity, snapshot, accountSnapshot }
    ▼
parseAll()  →  categories[], allTxns[], accBals{}, readyToAssign, cashEnd, ...
    │
    ├── renderHome()      tab 0 — Left to Assign hero, pace, goals strip, recent txns
    ├── renderPlan()      tab 1 — all category groups, detail panels, search
    ├── renderSpend()     tab 2 — transactions, date grouping, category filter
    ├── renderAccounts()  tab 3 — net worth, per-account balances, account detail
    └── renderMore()      tab 4 — Goals: Sinking Funds, Emergency, Goals groups
```

**Cache:** `localStorage` key `tab_v1` → `{ b, a, s, as, ts }`. Rendered on boot before fetch. Refreshed on every successful fetch. Logger app reads this cache on same origin (`mmraguin.github.io`).

**Companion app:** `mmraguin.github.io/logger/` handles all writes (log transactions, reconcile accounts). Tab is read-only.

---

## Reference

### Constants

```javascript
var ACCOUNTS = [
  'BDO', 'BPI', 'Cash', 'GCash', 'Grab Wallet', 'Maribank', 'Maya', 'Shopee Pay', 'UnionBank', 'UnionBank Credit'
];

var GORDER = [
  'Balance', 'Income', 'Fixed', 'Essentials', 'Pets', 'Lifestyle',
  'Sinking', 'Emergency', 'Goals'
];
```

### Key computed values

| Value | Source | Used in |
|-------|--------|---------|
| Left to Assign | MonthSnapshot col I (index 8) | Home hero, Plan hero |
| Available | Budget col P (index 15) | Every category card |
| CashEnd (net worth) | MonthSnapshot col F (index 5) | Accounts tab hero |
| Goal target | `yearlyGoal > 0 ? yearlyGoal : goal * 12` | Goals tab, Home strip |

### Color tokens

| Token | Meaning |
|-------|---------|
| `--income` | Positive / funded / on track |
| `--expense` | Negative / overspent / over pace |
| `--accent` | Brand / active / progress fill |
| `--warn` | Caution / approaching limit (≥80%) |
| `--transfer` | Transfer transactions (neutral) |

### Budget Sheet (filter by `row[5]` — MonthStart)

| Index | Field | Stored as |
|-------|-------|-----------|
| 2 | GroupID | `grpId` |
| 3 | CategoryID | `catId` — primary key |
| 4 | GroupSort | `grpSort` |
| 7 | Category name | `cat` |
| 8 | YearlyGoal | `yearlyGoal` |
| 9 | MonthlyGoal | `goal` |
| 11 | ManualAssigned | `assigned` (no rollovers) |
| 12 | AssignedThisMonth | `totalAssigned` (includes rollovers) |
| 13 | Activity | `activity` (negative = spent) |
| 14 | RolloverPrevMonth | `rollover` |
| 15 | AvailableThisMonth | `available` — **hero number** |
| 16 | NeededThisMonth | `overspent` |

### Activity Sheet (filter by `row[7]` — BillingCycle)

| Index | Field | Notes |
|-------|-------|-------|
| 4 | CategoryID | Join key → Budget row[3] |
| 6 | TransactionDate | Display date |
| 7 | BillingCycle | Period filter |
| 8 | Type | Income / Expense / Transfer / Balance / Reimbursement / Reconciliation |
| 9 | Amount | Negative = expense |
| 10 | Merchant | Payee |
| 11 | Payment Method | Must match ACCOUNTS |

Balance rows (`row[8] === "Balance"`) are snapshots, not transactions — not month-filtered, used as account balance fallback.

### MonthSnapshot Sheet (filter by `row[0]` — BillingCycle)

| Index | Field | Notes |
|-------|-------|-------|
| 2 | ExternalInflow | Income received |
| 4 | TrueExpense | Monthly outflow |
| 5 | CashEnd | **Net worth** |
| 7 | AssignedThisMonth | Total assigned |
| 8 | AvailableToAssign | **Left to Assign** |

### AccountSnapshot Sheet (filter by `row[0]` — BillingCycle)

| Index | Field | Notes |
|-------|-------|-------|
| 1 | Payment Method | Must match ACCOUNTS |
| 2 | TrueBalance | Opening balance |
| 3 | NetCashImpact | Net flow |
| 4 | Actual Balance | **Closing balance — shown in Accounts tab** |

### Debug panel

🔍 button → four sub-tabs: Overview, Budget, Activity, Snapshot. Snapshot tab shows `RTA(J)` per row — use to verify correct column is being read.
