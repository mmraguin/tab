# tab — Roadmap

## Next

- **Logger restyle** — bring the logger up to the same design system (separate repo).
- **Credit cards** — needs sheet columns for limit, statement day and due day before Accounts can show utilisation and due dates.
- **Bank statement reconciliation** — lives in the logger (see MEMORY.md).
- **Pull-to-refresh** and a **debug panel** were not carried over from the previous tab; add back if missed.

## Done

- Redesign promoted from `tabv3`: Home, Accounts, Activity, Budget, Goals, Insights
- Shared hero → strip → donut pattern, eye for headline numbers, category colours and icons
- Global search, notifications bell with dismissible alerts, floating link to the logger
- Swipeable account and goal cards with history charts; goal progress projection
- PWA: manifest, service worker (app shell only), icons
- Data fetch, parse and cache (`tab_v1`, shared with the logger)
