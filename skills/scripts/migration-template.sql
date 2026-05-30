-- AeroCap Migration Template
-- Copy and adapt for each new domain entity.
-- Run per-tenant: replace {TENANT_ID} with actual tenant schema name.
--
-- Convention:
--   File name:  NNN_description.sql  (e.g. 001_init_booking.sql)
--   Schema:     tenant_{tenantId}
--   All tables: tenant_id column + composite index on (tenant_id, id)
--   Soft delete: deleted_at TIMESTAMPTZ
--   Audit:       every mutation → audit_log entry (handled in repository layer)

-- ─── Create schema (run once per tenant) ────────────────────────────────────
-- CREATE SCHEMA IF NOT EXISTS tenant_{TENANT_ID};

-- ─── Main entity table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_{TENANT_ID}.entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     VARCHAR(36) NOT NULL,

  -- Domain fields (add yours here)
  -- name       VARCHAR(255) NOT NULL,
  -- status     VARCHAR(50)  NOT NULL DEFAULT 'ACTIVE',

  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,                          -- soft delete: NULL = active

  -- Constraints
  CONSTRAINT entities_tenant_id_check CHECK (tenant_id = '{TENANT_ID}')
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
-- Primary lookup: all queries filter by tenant_id + id
CREATE INDEX IF NOT EXISTS idx_entities_tenant_id_id
  ON tenant_{TENANT_ID}.entities (tenant_id, id);

-- Exclude soft-deleted rows from common queries
CREATE INDEX IF NOT EXISTS idx_entities_active
  ON tenant_{TENANT_ID}.entities (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Add domain-specific indexes below:
-- CREATE INDEX IF NOT EXISTS idx_entities_status
--   ON tenant_{TENANT_ID}.entities (tenant_id, status)
--   WHERE deleted_at IS NULL;

-- ─── Updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON tenant_{TENANT_ID}.entities;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON tenant_{TENANT_ID}.entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Audit log table (shared across all tenants, partitioned by tenant_id) ───
-- Run once globally (not per tenant):
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    VARCHAR(36) NOT NULL,
  entity_type  VARCHAR(100) NOT NULL,
  entity_id    UUID NOT NULL,
  action       VARCHAR(50) NOT NULL,   -- CREATE | UPDATE | DELETE | READ
  actor_id     UUID,                   -- user who performed the action
  actor_role   VARCHAR(50),
  old_values   JSONB,                  -- snapshot before change
  new_values   JSONB,                  -- snapshot after change
  ip_address   VARCHAR(45),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY LIST (tenant_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_entity
  ON public.audit_log (tenant_id, entity_type, entity_id, created_at DESC);

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS tenant_{TENANT_ID}.entities;
