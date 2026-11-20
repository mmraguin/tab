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

### Open items
- Credit cards: no limit / statement / due-date data in the sheet; Accounts shows "Not tracked yet".

### Webhooks (intentionally different)
- Tab `WEBHOOK` (read, GET) and logger `WEBHOOK` (write, POST) are **different** Apps Script deployments. The logger also has `TAB_WEBHOOK` for reads. Do not "fix" one to match the other. Full URLs are in each repo's CLAUDE.md.

## Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| Nov 20 2026 | Promoted the `tabv3` redesign into `tab`: Inter, dark neutral surfaces with lavender primary and per-group colours; tabs are Home / Accounts / Activity / Budget / Goals / Insights; shared hero → strip → donut pattern; eye hides headline numbers only; global search and a bell with dismissible notifications; PWA manifest + service worker. Previous tab archived in `tabv2`. | Budget bars were ambiguous (spent vs left) — replaced by group rings and a donut, so that item is resolved. Kept the `tab_v1` cache shape because the logger reads it. |
| Nov 20 2026 | One brand icon: `Images/favicon.png` is the browser favicon and `Images/app.png` is the install / home-screen icon (manifest, apple-touch-icon) in both repos; `Images/logo.png` is the wordmark. Old `icon-*.png`, `apple-touch-icon.png`, `tab-mark.png` removed. | Single source for brand images. Logger carries its own copy of `Images/`. |
