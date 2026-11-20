# tab — Memory Archive

> Resolved entries rotated from MEMORY.md. Reference only — do not re-open unless the feature is actively changing again.

---

## Archived decisions (old tab design, pre Nov 20 2026 redesign)

| Date | Decision | Rationale |
|------|----------|-----------|
| Jul 6 2026 | Pull to refresh built: resistance-based drag on `#pw`, `.ptr` indicator (rotates while dragging, spins during fetch), `overscroll-behavior: contain` on `.page` | Matches native PTR feel while suppressing the browser's own bounce/refresh so they don't fight. Threshold 64px, capped drag distance 96px with 0.5x resistance. |
| Jul 3 2026 | No percentage on group total header | Bar + `₱X / ₱Y` already encodes it. Third encoding adds no information. |
| Jul 3 2026 | Group total as header (label row), not as a category card at the bottom | Bottom placement was visually ambiguous — looked like another category. Header placement makes ownership clear. |
| Jul 3 2026 | `.goal-group` wrapper + `32px` gap between groups | Gestalt proximity — tight internal spacing, relaxed between-group spacing. |
| Jul 3 2026 | Webhook over direct Sheets API | API key + Sheet ID would both be client-side in a public repo. Personal finance data — not worth the privacy tradeoff. |
| Jul 3 2026 | No Apps Script warm-up trigger | Probabilistic (doesn't guarantee warmth, can land on different server instance), burns quota, doesn't fix slow reads. |
| Jul 3 2026 | Accept Apps Script cold start; fix perceived perf with loading states | Cache-first already covers blank-screen problem. Cold start only matters for explicit refresh. |
| Jul 7 2026 | Replaced `index.html`/`style.css` with the `tabv2` redesign (font stack: Instrument Sans/Inconsolata/Fraunces, replacing Instrument Serif/Space Mono/Manrope) | Redesign was prototyped separately in the sibling `tabv2` directory; once approved, promoted wholesale into `tab` as the new visual system. |

Notes: the pull-to-refresh decision (Jul 6) was retired in the redesign. The Plan tab progress-bar ambiguity is resolved by the group rings and donut. Logger restyle to match tab is done.


## Completed roadmap items (moved from ROADMAP.md, Nov 20 2026)

- Redesign promoted from `tabv3`: Home, Accounts, Activity, Budget, Goals, Insights
- Shared hero → strip → donut pattern, eye for headline numbers, category colours and icons
- Global search, notifications bell with dismissible alerts, floating link to the logger
- Swipeable account and goal cards with history charts; goal progress projection
- PWA: manifest, service worker (app shell only), icons
- Data fetch, parse and cache (`tab_v1`, shared with the logger)
- Logger restyle to match tab
- Accounts tab on AccountSnapshot data (net worth from AccountSnapshot col J)

## Dropped (old tab, replaced by the redesign)

- Dedicated Reports tab and 6-tab layout: replaced by the Insights tab and the 6-tab nav
- Old Plan / Spend / More tabs, debug panel, pull-to-refresh
