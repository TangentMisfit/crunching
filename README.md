# Crunching

Offline PWA that trains executive-finance mental math: reading a budget-vs-actual P&L in seconds (Module 1, P&L Flash)
and in-head what-if math on SaaS metrics (Module 2, Sensitivity Math). No frameworks, no build step.
The full build spec is in [CLAUDE.md](CLAUDE.md).

## Run locally

```
cd docs
python -m http.server 8000
```

Open http://localhost:8000 in Chrome. (On your phone, open the deployed GitHub Pages URL instead.)

## Run the tests

- Browser: with the server running, open http://localhost:8000/tests.html. The top line shows `ALL PASS — n/n passed`.
- Node (optional): from the repo root, `node tests/run.mjs`.

## Deploy (GitHub Pages)

1. Create an empty GitHub repo named `crunching`, then from this folder:
   ```
   git remote add origin https://github.com/<your-user>/crunching.git
   git push -u origin main
   ```
2. On GitHub: Settings → Pages → Source "Deploy from a branch" → Branch `main`, folder `/docs` → Save.
3. After a minute the app is at `https://<your-user>.github.io/crunching/`. On the Pixel, open it in Chrome →
   menu → "Add to Home screen" / "Install app".

## Shipping an update

Every time any file in `docs/` changes, bump `CACHE_VERSION` in `docs/version.js` (e.g. `crunch-v2`) before you push.
The installed app picks up the new version on the next launch after it has been online once.

## Data

All data stays on the device in `localStorage` keys starting with `crunch_`. Settings → Export CSV to back it up;
Import CSV merges without duplicates.
