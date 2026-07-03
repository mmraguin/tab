# tab — Memory

> Keep lean. Max ~15 active entries. When a feature is stable and no longer changing, move its entry to MEMORY-ARCHIVE.md.
> Claude: check this before every session. Update after any decision or shipped change.

---

## In Flight

### Pull to Refresh
**Status:** scoped, not built
**Approach:** `touchstart` / `touchmove` / `touchend` — detect downward swipe from top, show spinner, call existing `fetchData()`. Add `overscroll-behavior: contain` to body to suppress browser's native PTR.
**Note:** Apps Script cold start (2–5s) means the wait is real — needs a clear loading state so the user knows something is happening.

### Bank Statement Reconciliation (Feature 2)
**Status:** scoped, not built — companion to logger
**Scope:** Upload bank statement → cross-reference against Activity sheet → flag missed / mislogged transactions → allow add / edit / remove → write via logger webhook.
**Format notes:** GCash, Maya, UnionBank export CSV. UnionBank Credit exports PDF — harder, parse later.
**Match logic:** date + amount fuzzy match against Activity sheet transactions.
**Lives in:** logger app (has write access), not tab.

---

## Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| Jul 3 2026 | No percentage on group total header | Bar + `₱X / ₱Y` already encodes it. Third encoding adds no information. |
| Jul 3 2026 | Group total as header (label row), not as a category card at the bottom | Bottom placement was visually ambiguous — looked like another category. Header placement makes ownership clear. |
| Jul 3 2026 | `.goal-group` wrapper + `32px` gap between groups | Gestalt proximity — tight internal spacing, relaxed between-group spacing. |
| Jul 3 2026 | Webhook over direct Sheets API | API key + Sheet ID would both be client-side in a public repo. Personal finance data — not worth the privacy tradeoff. |
| Jul 3 2026 | No Apps Script warm-up trigger | Probabilistic (doesn't guarantee warmth, can land on different server instance), burns quota, doesn't fix slow reads. |
| Jul 3 2026 | Accept Apps Script cold start; fix perceived perf with loading states | Cache-first already covers blank-screen problem. Cold start only matters for explicit refresh. |
