# Article Screenshots

Store screenshots for `../ai-assisted-simulator-time-management.md` here.

Current screenshots were captured from the local AeroCap app with Playwright.

To regenerate them:

1. Run `npm run dev:core`.
2. If port `3000` is already serving stale assets, start a clean web server with `cd apps/web && npx next dev --port 3100`.
3. Run `AEROCAP_BASE_URL=http://localhost:3100 node scripts/capture-article-screenshots.mjs`.

The script captures different visible profiles:

- `01-schedule-blocked-periods.png`: `admin@demo.com` / `admin123`
- `02-schedule-maintenance.png`: `manager.fr@demo.com` / `manager123`
- `03-operating-schedules.png`: `manager.global@demo.com` / `manager123`
- `04-pilot-booking-calendar.png`: `a.martin@aerocap.fr` / `pilot123`
- `05-book-slot-modal.png`: `r.leroy@aerocap.fr` / `pilot123`
- `06-pending-pilot-lock.png`: `newpilot@demo.com` / `pilot123`
- `07-cbta-progress.png`: `a.martin@aerocap.fr` / `pilot123`
- `08-reports-compliance.png`: `manager.fr@demo.com` / `manager123`
- `09-pilot-profile.png`: `r.leroy@aerocap.fr` / `pilot123`
- `10-company-switcher.png`: `manager.global@demo.com` / `manager123`

Expected filenames:

- `01-schedule-blocked-periods.png`
- `02-schedule-maintenance.png`
- `03-operating-schedules.png`
- `04-pilot-booking-calendar.png`
- `05-book-slot-modal.png`
- `06-pending-pilot-lock.png`
- `07-cbta-progress.png`
- `08-reports-compliance.png`
- `09-pilot-profile.png`
- `10-company-switcher.png`
