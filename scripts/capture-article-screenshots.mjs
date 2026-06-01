import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const baseUrl = process.env.AEROCAP_BASE_URL ?? 'http://localhost:3000';
const outDir = resolve('docs/articles/screenshots');

mkdirSync(outDir, { recursive: true });

const viewport = { width: 1440, height: 1000 };

const profiles = {
  globalAdmin: { email: 'admin@demo.com', password: 'admin123' },
  franceManager: { email: 'manager.fr@demo.com', password: 'manager123' },
  globalManager: { email: 'manager.global@demo.com', password: 'manager123' },
  pilotAlice: { email: 'a.martin@aerocap.fr', password: 'pilot123' },
  pilotRobert: { email: 'r.leroy@aerocap.fr', password: 'pilot123' },
  pendingPilot: { email: 'newpilot@demo.com', password: 'pilot123' },
};

function isoOn(daysFromNow, hour, minute = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dateOnly(daysFromNow) {
  return isoOn(daysFromNow, 0).slice(0, 10);
}

async function login(page, email, password) {
  // Use the browser context's request API — cookies from the response are
  // automatically stored in the context and sent on subsequent navigations.
  const ctx = page.context();
  const res = await ctx.request.post(`${baseUrl}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ email, password }),
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Login failed for ${email}: ${res.status()} ${body}`);
  }
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'load', timeout: 30000 });
}

async function api(page, path, options = {}) {
  return page.evaluate(
    async ({ path, options }) => {
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
        },
      });
      const json = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, json };
    },
    { path, options },
  );
}

async function ensureArticleData(page) {
  const sims = await api(page, '/api/booking/simulators');
  const simulatorId = sims.json?.data?.[0]?.id ?? 'sim-a320-1';

  const dailyWindows = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    openTime: dayOfWeek === 0 ? '10:00' : '06:00',
    closeTime: dayOfWeek === 0 ? '16:00' : '22:00',
    isOpen: dayOfWeek !== 6,
  }));

  const scheduleTitle = 'Article Demo - Standard Training Week';
  const schedules = await api(page, '/api/schedule/operating-schedules?limit=100');
  const existingSchedule = schedules.json?.data?.find((s) => s.name === scheduleTitle);
  if (!existingSchedule) {
    const created = await api(page, '/api/schedule/operating-schedules', {
      method: 'POST',
      body: JSON.stringify({
        simulatorId: null,
        name: scheduleTitle,
        effectiveFrom: dateOnly(0),
        timeZone: 'Europe/Paris',
        dailyWindows,
        notes: 'Created for the AI-assisted simulator time management article screenshots.',
      }),
    });
    const id = created.json?.data?.id;
    if (created.ok && id) {
      await api(page, `/api/schedule/operating-schedules/${id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ effectiveFrom: dateOnly(0) }),
      });
    }
  }

  const blockTitle = 'Article Demo - DGAC Inspection Window';
  const blocks = await api(page, '/api/schedule/blocked-periods?limit=100');
  const existingBlock = blocks.json?.data?.find((b) => b.title === blockTitle);
  if (!existingBlock) {
    await api(page, '/api/schedule/blocked-periods', {
      method: 'POST',
      body: JSON.stringify({
        simulatorId,
        blockType: 'AUTHORITY_INSPECTION',
        title: blockTitle,
        description: 'Authority inspection block used for article screenshots.',
        startAt: isoOn(3, 8),
        endAt: isoOn(3, 18),
        isPublic: false,
        affectsSlots: true,
      }),
    });
  }

  const maintenanceTitle = 'Article Demo - A320 FFS Requalification';
  const maintenance = await api(page, '/api/schedule/maintenance?limit=100');
  const existingMaintenance = maintenance.json?.data?.find((m) => m.title === maintenanceTitle);
  if (!existingMaintenance) {
    await api(page, '/api/schedule/maintenance', {
      method: 'POST',
      body: JSON.stringify({
        simulatorId,
        maintenanceType: 'FSTD_REQUALIFICATION',
        title: maintenanceTitle,
        description: 'Planned FSTD requalification window used for article screenshots.',
        plannedStartAt: isoOn(7, 6),
        plannedEndAt: isoOn(7, 14),
        technicianName: 'AeroCap Technical Services',
        authorityReferenceNumber: 'DGAC-FSTD-ARTICLE-2026',
        partialOperationAllowed: false,
        qualificationLevelDuring: null,
        autoCreateBlockedPeriod: true,
      }),
    });
  }
}

async function capture(page, route, filename, { waitFor } = {}) {
  // Navigate; for client components Next.js dev needs time to compile on first visit
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'load', timeout: 30000 });

  if (waitFor) {
    // Wait for specific content — confirms the page fully rendered (not error state)
    try {
      await page.waitForSelector(waitFor, { timeout: 15000 });
    } catch {
      // Dev-mode compilation delay: reload once and try again
      await page.reload({ waitUntil: 'load', timeout: 30000 });
      await page.waitForSelector(waitFor, { timeout: 15000 });
    }
  } else {
    await page.waitForTimeout(800);
  }

  await page.screenshot({ path: resolve(outDir, filename), fullPage: true });
}

const browser = await chromium.launch({ headless: true });

try {
  const seedContext = await browser.newContext({ viewport });
  const seedPage = await seedContext.newPage();
  await login(seedPage, profiles.franceManager.email, profiles.franceManager.password);
  try {
    await ensureArticleData(seedPage);
  } catch (err) {
    console.warn('Seed step skipped (data may already exist):', err.message);
  }
  await seedContext.close();

  async function shot(label, fn) {
    try { await fn(); console.log(`✓ ${label}`); }
    catch (e) { console.warn(`✗ ${label}: ${e.message.split('\n')[0]}`); }
  }

  // h1 on schedule page — confirms the client component fully rendered
  const SCHEDULE_READY = 'h1:has-text("Simulator Schedule Management")';
  // h1 on bookings page — covers both authorized and pending states
  const BOOKINGS_READY = 'h1:has-text("Simulator Bookings"), h2:has-text("Booking access not yet authorized")';

  await shot('01 schedule blocked periods', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.globalAdmin.email, profiles.globalAdmin.password);
    await capture(pg, '/schedule', '01-schedule-blocked-periods.png', { waitFor: SCHEDULE_READY });
    await ctx.close();
  });

  await shot('02 schedule maintenance', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.franceManager.email, profiles.franceManager.password);
    await pg.goto(`${baseUrl}/schedule`, { waitUntil: 'load', timeout: 30000 });
    // Wait for page to render before clicking the tab
    await pg.waitForSelector(SCHEDULE_READY, { timeout: 15000 }).catch(async () => {
      await pg.reload({ waitUntil: 'load', timeout: 30000 });
      await pg.waitForSelector(SCHEDULE_READY, { timeout: 15000 });
    });
    await pg.getByRole('button', { name: 'Maintenance' }).click({ timeout: 8000 });
    await pg.waitForTimeout(600);
    await pg.screenshot({ path: resolve(outDir, '02-schedule-maintenance.png'), fullPage: true });
    await ctx.close();
  });

  await shot('03 operating schedules', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.globalManager.email, profiles.globalManager.password);
    await pg.goto(`${baseUrl}/schedule`, { waitUntil: 'load', timeout: 30000 });
    await pg.waitForSelector(SCHEDULE_READY, { timeout: 15000 }).catch(async () => {
      await pg.reload({ waitUntil: 'load', timeout: 30000 });
      await pg.waitForSelector(SCHEDULE_READY, { timeout: 15000 });
    });
    await pg.getByRole('button', { name: 'Operating Schedules' }).click({ timeout: 8000 });
    await pg.waitForTimeout(600);
    await pg.screenshot({ path: resolve(outDir, '03-operating-schedules.png'), fullPage: true });
    await ctx.close();
  });

  await shot('04 pilot booking calendar', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.pilotAlice.email, profiles.pilotAlice.password);
    await capture(pg, '/bookings', '04-pilot-booking-calendar.png', { waitFor: BOOKINGS_READY });
    await ctx.close();
  });

  await shot('05 book slot modal', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.pilotRobert.email, profiles.pilotRobert.password);
    await pg.goto(`${baseUrl}/bookings`, { waitUntil: 'load', timeout: 30000 });
    await pg.waitForSelector(BOOKINGS_READY, { timeout: 15000 }).catch(async () => {
      await pg.reload({ waitUntil: 'load', timeout: 30000 });
      await pg.waitForSelector(BOOKINGS_READY, { timeout: 15000 });
    });
    await pg.getByRole('button', { name: /Book a slot/i }).click({ timeout: 8000 });
    await pg.locator('select').nth(1).selectOption({ index: 2 });
    await pg.waitForTimeout(1200);
    const slotSelect = pg.locator('select').nth(2);
    if (await slotSelect.isVisible()) await slotSelect.selectOption({ index: 1 }).catch(() => {});
    await pg.addStyleTag({ content: '.backdrop-blur-sm { --tw-backdrop-blur: blur(0) !important; backdrop-filter: none !important; }' });
    await pg.screenshot({ path: resolve(outDir, '05-book-slot-modal.png'), fullPage: true });
    await ctx.close();
  });

  await shot('06 pending pilot lock', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.pendingPilot.email, profiles.pendingPilot.password);
    await capture(pg, '/bookings', '06-pending-pilot-lock.png', { waitFor: BOOKINGS_READY });
    await ctx.close();
  });

  await shot('07 CBTA progress', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.pilotAlice.email, profiles.pilotAlice.password);
    await capture(pg, '/cbta', '07-cbta-progress.png');
    await ctx.close();
  });

  await shot('08 reports compliance', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.franceManager.email, profiles.franceManager.password);
    await capture(pg, '/reports', '08-reports-compliance.png');
    await ctx.close();
  });

  await shot('09 pilot profile', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.pilotRobert.email, profiles.pilotRobert.password);
    await capture(pg, '/profile', '09-pilot-profile.png');
    await ctx.close();
  });

  await shot('10 company switcher', async () => {
    const ctx = await browser.newContext({ viewport });
    const pg  = await ctx.newPage();
    await login(pg, profiles.globalManager.email, profiles.globalManager.password);
    await pg.goto(`${baseUrl}/dashboard`, { waitUntil: 'load', timeout: 30000 });
    await pg.waitForTimeout(600);
    await pg.locator('aside button').first().click({ timeout: 8000 });
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: resolve(outDir, '10-company-switcher.png'), fullPage: true });
    await ctx.close();
  });
} finally {
  await browser.close();
}

console.log(`Screenshots saved to ${outDir}`);
