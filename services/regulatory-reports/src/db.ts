import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'aerocap.db');

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ReportTemplateRow {
  id:                    string;
  tenant_id:             string;
  code:                  string;
  title:                 string;
  regulatory_framework:  string;
  template_type:         string;
  schema_version:        number;
  layout_spec:           string;
  is_authority_approved: number;
  authority_approval_ref: string | null;
  created_at:            string;
  updated_at:            string;
  deleted_at:            string | null;
}

export interface ReportRunRow {
  id:                 string;
  tenant_id:          string;
  template_id:        string;
  scope:              string;
  requested_by:       string;
  requested_at:       string;
  status:             string;
  started_at:         string | null;
  finished_at:        string | null;
  error:              string | null;
  output_document_id: string | null;
  signed_at:          string | null;
  signed_by:          string | null;
  signature_hash:     string | null;
  created_at:         string;
  updated_at:         string;
  deleted_at:         string | null;
}

export interface ReportDocumentRow {
  id:            string;
  tenant_id:     string;
  report_run_id: string;
  format:        string;
  storage_key:   string;
  size_bytes:    number;
  sha256:        string;
  generated_at:  string;
  created_at:    string;
  updated_at:    string;
  deleted_at:    string | null;
}

export interface PilotComplianceSnapshotRow {
  id:                       string;
  tenant_id:                string;
  pilot_id:                 string;
  snapshot_at:              string;
  q1_training_cycle_status: string;
  q2_medical_status:        string;
  q3_recency_status:        string;
  q4_cu_coverage_status:    string;
  q5_open_deficits_status:  string;
  q6_instructor_qual_status: string;
  q7_simulator_qual_status: string;
  payload:                  string;
  overall_compliant:        number;
  expires_at:               string;
  created_at:               string;
  updated_at:               string;
  deleted_at:               string | null;
}

export interface InspectorAccessTokenRow {
  id:              string;
  tenant_id:       string;
  inspector_email: string;
  inspector_name:  string;
  authority:       string;
  scope:           string;
  token_hash:      string;
  issued_at:       string;
  valid_until:     string;
  revoked_at:      string | null;
  revoked_by:      string | null;
  access_log:      string;
  created_at:      string;
  updated_at:      string;
  deleted_at:      string | null;
}

// ─── Database factory ──────────────────────────────────────────────────────────

export function createDatabase(): DatabaseSync {
  mkdirSync(DB_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const sql = readFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);

  const row = db.prepare('SELECT COUNT(*) AS count FROM report_template').get() as { count: number };
  if (row.count === 0) seedDatabase(db);

  return db;
}

// ─── Seed ──────────────────────────────────────────────────────────────────────

function seedDatabase(db: DatabaseSync): void {
  const now = new Date();

  // Expires 24 h from now
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const insTpl = db.prepare(`
    INSERT INTO report_template
      (id, tenant_id, code, title, regulatory_framework, template_type, layout_spec, is_authority_approved)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insSnap = db.prepare(`
    INSERT INTO pilot_compliance_snapshot
      (id, tenant_id, pilot_id, q1_training_cycle_status, q2_medical_status,
       q3_recency_status, q4_cu_coverage_status, q5_open_deficits_status,
       q6_instructor_qual_status, q7_simulator_qual_status, payload, overall_compliant, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN IMMEDIATE');
  try {
    // Seed report template
    insTpl.run(
      randomUUID(),
      'tenant-demo',
      'EASA-PILOT-COMPLIANCE',
      'EASA Pilot Compliance Report',
      'EASA',
      'PILOT_COMPLIANCE',
      '{}',
      1, // is_authority_approved = true
    );

    // pilot-alice: all questions PASS, overall_compliant = 1
    insSnap.run(
      randomUUID(), 'tenant-demo', 'pilot-alice',
      'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS',
      '{}', 1, expiresAt,
    );

    // pilot-bob: q5 open deficits WARN, overall_compliant = 0
    insSnap.run(
      randomUUID(), 'tenant-demo', 'pilot-bob',
      'PASS', 'PASS', 'PASS', 'PASS', 'WARN', 'PASS', 'PASS',
      '{}', 0, expiresAt,
    );

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  console.log('[seed] 1 report template, 2 compliance snapshots inserted');
}
