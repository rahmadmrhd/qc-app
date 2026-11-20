-- Tautan entri Log Audit ke entitasnya (redesain fase 4c, keputusan pemilik 2026-11-20). Expand-only: kolom baru dengan
-- bawaan '' (entri lama tanpa tautan); jenis entitas diturunkan dari awalan `action` (shared/audit.ts), bukan disimpan.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_id VARCHAR(100) NOT NULL DEFAULT '';
