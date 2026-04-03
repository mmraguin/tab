# tab — Roadmap

## Planned Features

---

### Home Tab — Health Sentence

A single status line below the greeting that summarizes the month. Logic:

| Condition | Sentence |
|-----------|----------|
| `readyToAssign < 0` | "{Month} is over-assigned." |
| spending pace is over | "{Month} needs a reset." |
| `overspent.length > 0` | "{Month} has some overspending." |
| `readyToAssign < totalInc * 0.05` | "{Month} is fully allocated." |
| default | "{Month} looks great." |

---

### Accounts Tab — AccountSnapshot Integration

Currently the Accounts tab may fall back to Balance rows from Activity. It should prefer AccountSnapshot data.

**Layout:**
```
Net Worth (MonthSnapshot col H)
₱317,957.97
+₱20,115.09 (+6.8%) from last month   ← hidden if prevCashEnd = 0

Maribank    ₱475,472.61   ← accountSnap[acc].cashEnd
  +₱307,251 activity · 7 txns
BDO         ₱26,146.54
  +₱8,691 activity · 2 txns
...
```

Per-account activity line shown only when AccountSnapshot data is available for that account.

---

### Tab 4 — Dedicated Goals Tab

Replace the current Goals section in the More tab with a full dedicated tab. Three sections:

1. **Sinking Funds** — budgeted savings for irregular expenses
2. **Emergency** — emergency fund categories (strip "Fund" suffix from display names)
3. **Goals** — longer-term savings targets

Each item is a full-width progress row:
- Category name
- % funded
- Progress bar
- Saved / goal amount
- Monthly contribution

Uses `goal` (MonthlyGoal, Budget col J) as the monthly contribution target. Uses `yearlyGoal` (Budget col I, currently unparsed) as the annual savings target for progress rings.

---

### Tab 5 — Dedicated Reports Tab

Three sections:

1. **Budget vs Activity** — table of every group/category with a mini bar and numbers
2. **Spend by Group** — SVG donut chart, tappable slices
3. **Month-over-Month** — two mini bar charts:
   - Net Worth over last 6 months (from MonthSnapshot col H)
   - Income vs Expense over last 6 months (from MonthSnapshot cols C/G)

---

### 6-Tab Layout

When Goals and Reports become dedicated tabs, the page container scales from 500% width (5 tabs) to 600% (6 tabs). Each page goes from `width: 20%` to `width: 16.666%`.

Tab bar gains a 6th entry. Swipe navigation already handles arbitrary tab counts via `curTab`.

---

## Done

- Data fetch, parse, cache (`tab_v1`)
- Home tab — greeting, Left to Assign hero, spending pace, goals strip, recent txns
- Plan tab — all groups, category cards, detail panels, search, progress bars
- Spend tab — transactions, date grouping, category filter chips
- Accounts tab — net worth, per-account list, account detail view with filter
- More tab — Goals and Reports in simplified form
- Debug panel — Budget, Activity, Snapshot sub-tabs with raw value verification
- Swipe navigation, pull-to-refresh, haptic feedback
- Safe area padding for iPhone notch
