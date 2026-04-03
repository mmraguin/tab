# tab — Claude Reference

## Project

Mobile-first personal budget dashboard for Miles (Philippines, PHP). Single `index.html` + `style.css`. No framework, no build step. Deployed via GitHub Pages — push to main, live in ~30 seconds.

Data lives in Google Sheets. The app is read-only. Google Apps Script serves data as JSON via a `/exec` endpoint.

```
const WEBHOOK = 'https://script.google.com/macros/s/AKfycbxy2zzSSdVP4zoLO8em6hUkAnNran5lq2_U1QIbMgVRutHuVeE_KBRzkRiEbc9X7GeMQA/exec';
```

---

## Files

- `index.html` — entire app (HTML + CSS + JS)
- `style.css` — all styles
- `CLAUDE.md` — this file

---

## Code Style

```javascript
var x = 123;          // var, not let/const
function fn() {}      // function declarations
var html = '<div>' + x + '</div>';  // string concatenation, no template literals
```

---

## Architecture

```
Google Sheets (Apps Script)
    │  HTTP GET → JSON { budget, activity, snapshot, accountSnapshot }
    ▼
parseAll()  →  categories[], allTxns[], accBals{}, readyToAssign, cashEnd, ...
    │
    ├── renderHome()
    ├── renderPlan()
    ├── renderSpend()
    ├── renderAccounts()
    └── renderMore()
```

**Cache:** `localStorage` key `tab_v1`. Stores `{ b, a, s, as, ts }`. Loaded on boot, refreshed on every successful fetch.

---

## Date Parsing — Critical

Apps Script serializes all Date cells as UTC ISO timestamps (e.g. `"2026-01-31T16:00:00.000Z"`). In UTC+8 (Philippines), `Jan 31 16:00 UTC` is `Feb 1 00:00 local` — so `2026-01-31T16:00:00.000Z` means **February 1** locally.

Always use `parseDate(v)` — never parse raw strings. It reads ISO timestamps as full UTC dates then returns them in local time via `new Date(ts.getFullYear(), ts.getMonth(), ts.getDate())`.

---

## Column Mappings

All indices are 0-based from col A. Apps Script exports from A1.

### Budget Sheet — filter by `row[5]` (MonthStart, col F)

| Index | Col | Field | Notes |
|-------|-----|-------|-------|
| 5 | F | MonthStart | Date filter — UTC ISO timestamp |
| 6 | G | Group | Category group |
| 7 | H | Category | Budget category name |
| 9 | J | MonthlyGoal | Stored as `goal` — shown in Plan detail panel for Sinking/Emergency/Goals |
| 10 | K | FutureBudgeted | Checkbox — ignored |
| 11 | L | ManualAssigned | Stored as `assigned` — what was manually put in this month (no rollovers) |
| 12 | M | AssignedThisMonth | Stored as `totalAssigned` — includes rollovers — **progress bar denominator** |
| 13 | N | Activity | Stored as `activity` — negative = spent |
| 14 | O | RolloverPrevMonth | Stored as `rollover` |
| 15 | P | AvailableThisMonth | Stored as `available` — **hero number on every category card** |
| 16 | Q | NeededThisMonth | Stored as `overspent` |

```javascript
catMap[cat] = {
  group:         grp,
  goal:          pn(row[9]),   // MonthlyGoal — col J
  assigned:      pn(row[11]),  // ManualAssigned — col L (no rollovers)
  totalAssigned: pn(row[12]),  // AssignedThisMonth — col M (includes rollovers)
  activity:      pn(row[13]),  // Activity — col N (negative = spent)
  rollover:      pn(row[14]),  // RolloverPrevMonth — col O
  available:     pn(row[15]),  // AvailableThisMonth — col P (hero)
  overspent:     pn(row[16])   // NeededThisMonth — col Q
};
```

### Activity Sheet — filter by `row[0]` (Date, col A)

| Index | Col | Field | Notes |
|-------|-----|-------|-------|
| 0 | A | Date | Transaction date — UTC ISO timestamp — **filter by this** |
| 1 | B | Type | "Income", "Expense", "Transfer", "Balance", "Reimbursement" |
| 2 | C | Amount | Transaction amount |
| 3 | D | Merchant | Merchant/payee name |
| 4 | E | Payment Method | Account name — must match ACCOUNTS list |
| 5 | F | Category | Budget category |
| 6 | G | Group | Category group |
| 7 | H | Memo | Notes |
| 11 | L | MonthStart | Pre-assigned budget month — present but not used for filtering |

**Balance rows** (`row[1] === "Balance"`) are account balance snapshots, not transactions. Not month-filtered. Used as fallback for account balances when AccountSnapshot is unavailable.

### MonthSnapshot Sheet — filter by `row[0]` (MonthStart, col A)

| Index | Col | Field | Notes |
|-------|-----|-------|-------|
| 0 | A | MonthStart | Date filter — UTC ISO timestamp |
| 1 | B | CashStart | Opening net worth |
| 2 | C | InflowExternal | Income received |
| 3 | D | Income | |
| 4 | E | Reimbursements | |
| 5 | F | AssignedThisMonth | Total assigned across all categories |
| 6 | G | Activity | Total expenses paid |
| 7 | H | CashEnd | **Total net worth — primary number on Accounts tab** |
| 8 | I | FutureBudgeted | |
| 9 | J | ReadyToAssignEnd | **Left to Assign — hero number on Home and Plan tabs** |
| 10 | K | Expenses | |

```javascript
inflowExt  = pn(sr[2]);  // InflowExternal — col C
atm        = pn(sr[5]);  // AssignedThisMonth — col F
outflowExt = pn(sr[6]);  // Activity — col G
cashEnd    = pn(sr[7]);  // CashEnd — col H
rta        = pn(sr[9]);  // ReadyToAssignEnd — col J
if (sMonths[i + 1]) prevCashEnd = pn(sMonths[i + 1].row[7]);
```

### AccountSnapshot Sheet — filter by `row[0]` (MonthStart, col A)

| Index | Col | Field | Notes |
|-------|-----|-------|-------|
| 0 | A | MonthStart | Date filter — UTC ISO timestamp |
| 1 | B | Account | Account name — must match ACCOUNTS list |
| 2 | C | CashStart | Opening balance |
| 3 | D | Activity | Net flow (Income − Expense) for this account |
| 4 | E | CashEnd | **Closing balance per account — shown in Accounts tab** |

---

## Key Concepts

**Left to Assign** = `ReadyToAssignEnd` from MonthSnapshot col J (index 9). Hero number on Home and Plan tabs. Green = positive = healthy. Red = over-assigned.

**Available** = `AvailableThisMonth` from Budget col P (index 15). Per-category hero on Plan tab cards. Factors in budget + spending + rollovers.

**AssignedThisMonth** (Budget col M, index 12) includes rollovers. Used as denominator in progress bars. Larger than ManualAssigned (col L, index 11).

**CashEnd** (MonthSnapshot col H, index 7) = total net worth this month. Shown at top of Accounts tab.

---

## Constants

```javascript
var ACCOUNTS = [
  'BDO', 'BPI', 'Cash', 'GCash', 'Maribank', 'Maya', 'UnionBank', 'UnionBank Credit'
];

var GORDER = [
  'Income', 'Home', 'Pets', 'Health', 'Quality Of Life',
  'Stellar Rebels', 'Sinking', 'Emergency', 'Goals'
];
```

Account names must exactly match values in Activity sheet (col E) and AccountSnapshot (col B).

---

## Tabs

| Index | Name | Status |
|-------|------|--------|
| 0 | Home | Live — greeting, Left to Assign hero, spending pace, goals strip, recent txns |
| 1 | Plan | Live — all category groups, detail panels, search |
| 2 | Spend | Live — transactions, date grouping, category filter |
| 3 | Accounts | Live — net worth, per-account balances, account detail view |
| 4 | More | Live — Goals and Reports (simplified form) |

Planned: dedicated Goals tab (tab 4), dedicated Reports tab (tab 5), Home health sentence. See `ROADMAP.md`.

---

## Color Semantics

| Token | Hex | Meaning |
|-------|-----|---------|
| `--income` | `#4ade80` | Positive / funded / on track |
| `--expense` | `#ff5c5c` | Negative / overspent / over pace |
| `--accent` | `#2a9d9f` | Brand / active / progress fill |
| `--warn` | `#c8922a` | Caution / approaching limit (≥80%) |
| `--transfer` | `#b8a9e0` | Transfer transactions (neutral) |

---

## Debug Panel

Opened with the 🔍 button. Four sub-tabs: Overview, Budget, Activity, Snapshot. Shows raw vs parsed values for every key column. Use it to verify column mapping issues — the Snapshot tab shows `RTA(J)` for each row so you can confirm the right value is being read.
