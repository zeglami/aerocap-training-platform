import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'aerocap.db');

function txn(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try   { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function createDatabase(): DatabaseSync {
  mkdirSync(DB_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const sql = readFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);

  const row = db.prepare('SELECT COUNT(*) AS count FROM competency_units').get() as { count: number };
  if (row.count === 0) seedDatabase(db);

  ensureAllCountryCUs(db);

  return db;
}

const EASA_UNITS = [
  { code: 'AP',  name: 'Application of Procedures',                    category: 'TECHNICAL',     description: 'Identifies and applies procedures in accordance with applicable documents and in a manner appropriate to the situation.' },
  { code: 'COM', name: 'Communication',                                category: 'NON_TECHNICAL', description: 'Communicates using appropriate methods, terminology and procedures, in normal, abnormal and emergency situations.' },
  { code: 'FPA', name: 'Aircraft Flight Path Management — Automation', category: 'TECHNICAL',     description: 'Controls the aircraft flight path through automation, including appropriate use of flight management systems and other avionics.' },
  { code: 'FPM', name: 'Aircraft Flight Path Management — Manual',     category: 'TECHNICAL',     description: 'Controls the aircraft flight path using manual flying skills within the normal operating envelope and to recover from unusual attitudes.' },
  { code: 'LT',  name: 'Leadership and Teamwork',                      category: 'NON_TECHNICAL', description: 'Leads or participates in crew as a productive member of the team in all circumstances, including emergency situations.' },
  { code: 'PSD', name: 'Problem Solving and Decision Making',          category: 'NON_TECHNICAL', description: 'Accurately identifies risks and resolves threats and errors, applying appropriate decision-making processes including time-critical decisions.' },
  { code: 'SA',  name: 'Situation Awareness',                          category: 'NON_TECHNICAL', description: 'Perceives and comprehends all relevant information available and anticipates its future impact on operations and flight safety.' },
  { code: 'WM',  name: 'Workload Management',                          category: 'NON_TECHNICAL', description: 'Manages available resources efficiently to prioritise and perform tasks in a timely manner under all conditions.' },
];

type Scores = Record<string, number>;
type Session = { date: string; scores: Scores; note?: string };

function seedDatabase(db: DatabaseSync): void {
  const insUnit = db.prepare('INSERT INTO competency_units (id, tenant_id, code, name, description, category) VALUES (?,?,?,?,?,?)');
  const insA    = db.prepare('INSERT INTO assessments (id, tenant_id, pilot_id, instructor_id, competency_unit_id, score, notes, assessed_at) VALUES (?,?,?,?,?,?,?,?)');
  const ids: Record<string, string> = {};

  txn(db, () => {
    for (const tenantId of ['tenant-demo', 'tenant-za']) {
      for (const u of EASA_UNITS) {
        const id = `cu-${u.code.toLowerCase()}-${tenantId}`;
        ids[`${u.code}-${tenantId}`] = id;
        insUnit.run(id, tenantId, u.code, u.name, u.description, u.category);
      }
    }

    const uid = (code: string, t = 'tenant-demo') => ids[`${code}-${t}`];
    const seed = (pilotId: string, instr: string, sessions: Session[], t = 'tenant-demo') => {
      for (const s of sessions)
        for (const [code, score] of Object.entries(s.scores))
          insA.run(randomUUID(), t, pilotId, instr, uid(code, t), score, s.note ?? null, s.date);
    };

    // ── ALICE MARTIN — A320 ITR: starts below standard, steadily improves ─────
    // Story: entered ITR with 2 800 h but no A320 experience. Struggled with FPM
    // and FPA in early sessions. Strong COM from day 1. Now solidly meets standard.
    seed('pilot-alice', 'instructor-jean', [
      { date:'2025-12-10', scores:{ AP:2, COM:3, FPA:2, FPM:2, LT:3, PSD:2, SA:2, WM:2 }, note:'Session 1 — FBS Phase. Baseline assessment. FPM and FPA below standard on approach.' },
      { date:'2026-01-14', scores:{ AP:2, COM:3, FPA:2, FPM:2, LT:3, PSD:3, SA:3, WM:2 }, note:'Session 2 — FFS. Continues to struggle with energy management. COM strong.' },
      { date:'2026-02-05', scores:{ AP:3, COM:4, FPA:3, FPM:2, LT:3, PSD:3, SA:3, WM:3 }, note:'Session 3 — FFS. AP now meets standard. FPM still inconsistent on manual ILS.' },
      { date:'2026-02-26', scores:{ AP:3, COM:4, FPA:3, FPM:3, LT:4, PSD:3, SA:3, WM:3 }, note:'Session 4 — FFS. First session with all CUs ≥3. Good progress.' },
      { date:'2026-03-19', scores:{ AP:4, COM:4, FPA:4, FPM:3, LT:4, PSD:4, SA:3, WM:4 }, note:'Session 5 — FFS. Exceeds standard on AP and FPA. Consistent energy management.' },
      { date:'2026-04-09', scores:{ AP:4, COM:5, FPA:4, FPM:4, LT:5, PSD:4, SA:4, WM:4 }, note:'Session 6 — FFS. Exemplary briefing and crew leadership. SA well-developed.' },
      { date:'2026-05-07', scores:{ AP:4, COM:5, FPA:5, FPM:4, LT:5, PSD:4, SA:4, WM:4 }, note:'Session 7 — FFS. Strong pre-ITR check performance. Ready for examiner session.' },
    ]);

    // ── ROBERT LEROY — B737 captain: stable high-performer, SA dipped Feb ─────
    // Story: 8 200 h, experienced captain. SA scored 2 in Feb (tunnelling during
    // abnormal procedure). Deficit opened, remedial briefing done, resolved March.
    // OPC coming up — all CUs now at 3–4.
    seed('pilot-bob', 'instructor-jean', [
      { date:'2025-11-12', scores:{ AP:4, COM:4, FPA:4, FPM:4, LT:4, PSD:3, SA:4, WM:4 }, note:'Annual recurrent. Excellent crew management. LOFT scenario.' },
      { date:'2026-02-18', scores:{ AP:3, COM:4, FPA:3, FPM:4, LT:4, PSD:3, SA:2, WM:3 }, note:'Recurrent session. SA deficit — missed compressor stall cue during ECON cruise.' },
      { date:'2026-03-05', scores:{ AP:3, COM:4, FPA:3, FPM:4, LT:4, PSD:3, SA:3, WM:3 }, note:'Reassessment SA — briefing + scenario focus on situational cues. Meets standard.' },
      { date:'2026-04-22', scores:{ AP:4, COM:4, FPA:4, FPM:4, LT:4, PSD:4, SA:4, WM:4 }, note:'Pre-OPC check session. All CUs exceeds standard. Ready for OPC.' },
    ]);

    // ── SOFIA REYES — A350 command upgrade: consistently excellent ────────────
    // Story: 6 500 h, SIC. Identified for command upgrade. 3 LPC sessions over
    // 14 months, all 4+. Final LPC 15 May 2026 — captain recommendation issued.
    seed('pilot-sofia', 'instructor-sophie', [
      { date:'2025-03-14', scores:{ AP:4, COM:4, FPA:5, FPM:4, LT:4, PSD:4, SA:4, WM:4 }, note:'LPC — 12-month recurrency check. Strong FPA. Role model crew briefing.' },
      { date:'2025-10-08', scores:{ AP:4, COM:5, FPA:5, FPM:4, LT:5, PSD:4, SA:4, WM:4 }, note:'Command upgrade check — Phase 1. Outstanding LT. Decision quality exemplary.' },
      { date:'2026-01-21', scores:{ AP:5, COM:5, FPA:5, FPM:4, LT:5, PSD:5, SA:5, WM:4 }, note:'Command upgrade — Phase 2. Emergency scenario (dual hydraulic, crosswind). Exceptional.' },
      { date:'2026-05-15', scores:{ AP:5, COM:5, FPA:5, FPM:5, LT:5, PSD:5, SA:5, WM:5 }, note:'Final LPC command upgrade. First all-5 record in cohort this year. Captain recommendation issued.' },
    ]);

    // ── MARC GIRARD — A320 line: stable recurrent pilot ──────────────────────
    // Story: 5 100 h, 3 200 h on A320. Reliable, meets standard consistently.
    // No drama, textbook EASA line pilot.
    seed('pilot-marc', 'instructor-jean', [
      { date:'2025-08-20', scores:{ AP:3, COM:3, FPA:3, FPM:3, LT:3, PSD:3, SA:3, WM:3 }, note:'Annual recurrent — standard performance. All CUs meet standard.' },
      { date:'2026-01-15', scores:{ AP:3, COM:4, FPA:3, FPM:3, LT:3, PSD:3, SA:3, WM:3 }, note:'Recurrent. COM improved. Good crew briefing quality.' },
      { date:'2026-05-20', scores:{ AP:3, COM:4, FPA:4, FPM:3, LT:4, PSD:3, SA:3, WM:3 }, note:'Pre-OPC session. Consistently meets standard. FPA improvement noted.' },
    ]);

    // ── YUKI TANAKA — B737 MAX ITR: early FFS, developing ───────────────────
    // Story: B737 MAX ITR. 3 910 h total but B777 background, different energy
    // management. FPM and COM are challenging. Improving but needs more sessions.
    seed('pilot-yuki', 'instructor-sophie', [
      { date:'2026-03-10', scores:{ AP:2, COM:2, FPA:3, FPM:2, LT:3, PSD:3, SA:3, WM:2 }, note:'FFS Session 1. Type transition from B777. FPM and COM below standard.' },
      { date:'2026-03-25', scores:{ AP:2, COM:3, FPA:3, FPM:2, LT:3, PSD:3, SA:3, WM:3 }, note:'FFS Session 2. COM improving with crew comms exercise. FPM still inconsistent.' },
      { date:'2026-04-10', scores:{ AP:3, COM:3, FPA:3, FPM:2, LT:3, PSD:3, SA:3, WM:3 }, note:'FFS Session 3. AP now meets standard. FPM remains below — energy control.' },
      { date:'2026-05-02', scores:{ AP:3, COM:3, FPA:3, FPM:3, LT:3, PSD:3, SA:3, WM:3 }, note:'FFS Session 4. FPM meets standard for first time. Good session overall.' },
    ]);

    // ── FATIMA BENALI — A320 transferee: pre-ITR assessment only ─────────────
    // Story: Air Maroc transferee. Prior A320 experience (3 450 h, 1 200 h A320).
    // Initial CBTA baseline shows strong COM and LT from airline background.
    // AP and FPM need calibration to EASA standard.
    seed('pilot-fatima', 'instructor-jean', [
      { date:'2026-05-28', scores:{ AP:3, COM:5, FPA:3, FPM:3, LT:4, PSD:3, SA:3, WM:3 }, note:'Pre-ITR cross-credit assessment. Excellent COM and LT from Air Maroc background. AP and FPM to calibrate to EASA technique.' },
    ]);

    // ── PIERRE DUMONT — B737 F/O: FPM deficit opened 15 May ──────────────────
    // Story: Experienced B737 F/O (4 800 h). FPM scored 2 in May recurrent
    // due to energy management failure (fast/high approach). Deficit open.
    // Remedial briefing scheduled this week. Reassessment in June.
    seed('pilot-pierre', 'instructor-jean', [
      { date:'2025-11-04', scores:{ AP:3, COM:3, FPA:3, FPM:3, LT:3, PSD:3, SA:3, WM:3 }, note:'Annual recurrent. Meets standard across all CUs.' },
      { date:'2026-02-10', scores:{ AP:3, COM:3, FPA:3, FPM:3, LT:3, PSD:3, SA:3, WM:3 }, note:'Mid-cycle EBT session. Stable performance.' },
      { date:'2026-05-15', scores:{ AP:3, COM:3, FPA:3, FPM:2, LT:3, PSD:3, SA:3, WM:3 }, note:'Recurrent. FPM below standard — unstabilised approach at 500 ft (fast+high, failed to go around). Deficit triggered per ICAO Doc 9995.' },
    ]);

    // ── CAMILLE ROUSSEAU — A350 captain: exemplary all-round ─────────────────
    // Story: 11 200 h, 5 100 h on A350. LPC 20 May 2026 — first all-CU ≥4
    // result in current cycle. Candidate for TRI endorsement.
    seed('pilot-camille', 'instructor-sophie', [
      { date:'2025-05-22', scores:{ AP:4, COM:5, FPA:5, FPM:4, LT:5, PSD:4, SA:5, WM:4 }, note:'LPC. Outstanding situational awareness and decision-making. Examiner: S. Bernard (TRE).' },
      { date:'2025-11-14', scores:{ AP:4, COM:5, FPA:5, FPM:5, LT:5, PSD:5, SA:5, WM:4 }, note:'EBT recurrent. Dual engine failure scenario. Crew management exemplary.' },
      { date:'2026-05-20', scores:{ AP:5, COM:5, FPA:5, FPM:5, LT:5, PSD:5, SA:5, WM:5 }, note:'LPC 2026. All 8 CUs exemplary (5/5). Recommended for TRI endorsement. Confirmed captain upgrade eligible.' },
    ]);

    // ── SOUTH AFRICA pilots ───────────────────────────────────────────────────
    seed('pilot-amara', 'instructor-za', [
      { date:'2025-10-10', scores:{ AP:3, COM:3, FPA:3, FPM:3, LT:3, PSD:3, SA:3, WM:3 }, note:'Annual OPC — A320. Meets standard. SACAA jurisdiction.', },
      { date:'2026-01-22', scores:{ AP:3, COM:4, FPA:3, FPM:3, LT:3, PSD:3, SA:3, WM:3 }, note:'EBT recurrent. COM improved. Good crew comms.' },
    ], 'tenant-za');

    seed('pilot-za-3', 'instructor-za', [
      { date:'2025-09-18', scores:{ AP:4, COM:4, FPA:4, FPM:4, LT:4, PSD:4, SA:4, WM:4 }, note:'LPC. Senior captain. Excellent across all CUs.' },
      { date:'2026-03-05', scores:{ AP:4, COM:5, FPA:4, FPM:4, LT:5, PSD:4, SA:4, WM:4 }, note:'EBT session. Strong leadership and CRM.' },
    ], 'tenant-za');
  });

  console.log('[seed] CBTA: 8 FR pilots + 2 ZA pilots, 30+ session records across 14 months');
}

function ensureAllCountryCUs(db: DatabaseSync): void {
  const insUnit = db.prepare(
    'INSERT OR IGNORE INTO competency_units (id, tenant_id, code, name, description, category) VALUES (?,?,?,?,?,?)'
  );
  txn(db, () => {
    for (const tenantId of ['tenant-cn', 'tenant-in']) {
      for (const u of EASA_UNITS) {
        insUnit.run(`cu-${u.code.toLowerCase()}-${tenantId}`, tenantId, u.code, u.name, u.description, u.category);
      }
    }
  });
}
