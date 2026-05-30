-- Migration 002: add scheduling-awareness fields to reservations

ALTER TABLE reservations ADD COLUMN session_type_at_booking TEXT;
ALTER TABLE reservations ADD COLUMN simulator_qualification_level_at_booking TEXT;
ALTER TABLE reservations ADD COLUMN maintenance_record_id TEXT;
ALTER TABLE reservations ADD COLUMN recency_warning INTEGER NOT NULL DEFAULT 0;

-- Update session_type_at_booking from existing session_type for backward compat
UPDATE reservations SET session_type_at_booking = session_type WHERE session_type_at_booking IS NULL;
