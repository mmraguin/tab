# tab — Memory

> Keep lean. Max ~15 active entries. When a feature is stable and no longer changing, move its entry to MEMORY-ARCHIVE.md.
> Claude: check this before every session. Update after any decision or shipped change.

---

## In Flight

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
| Jul 6 2026 | Pull to refresh built: resistance-based drag on `#pw`, `.ptr` indicator (rotates while dragging, spins during fetch), `overscroll-behavior: contain` on `.page` | Matches native PTR feel while suppressing the browser's own bounce/refresh so they don't fight. Threshold 64px, capped drag distance 96px with 0.5x resistance. |
| Jul 3 2026 | No percentage on group total header | Bar + `₱X / ₱Y` already encodes it. Third encoding adds no information. |
| Jul 3 2026 | Group total as header (label row), not as a category card at the bottom | Bottom placement was visually ambiguous — looked like another category. Header placement makes ownership clear. |
| Jul 3 2026 | `.goal-group` wrapper + `32px` gap between groups | Gestalt proximity — tight internal spacing, relaxed between-group spacing. |
| Jul 3 2026 | Webhook over direct Sheets API | API key + Sheet ID would both be client-side in a public repo. Personal finance data — not worth the privacy tradeoff. |
| Jul 3 2026 | No Apps Script warm-up trigger | Probabilistic (doesn't guarantee warmth, can land on different server instance), burns quota, doesn't fix slow reads. |
| Jul 3 2026 | Accept Apps Script cold start; fix perceived perf with loading states | Cache-first already covers blank-screen problem. Cold start only matters for explicit refresh. |
