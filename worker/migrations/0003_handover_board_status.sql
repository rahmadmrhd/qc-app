-- Kolom turunan board_status (aturan deriveHandoverStatus di shared/handover.ts):
--   cancelled bila status tersimpan 'cancelled'; done bila total_count > 0 dan checked_count = total_count,
--   atau total_count = 0 dan completed_at terisi; in_progress bila checked_count > 0; selain itu new.
-- WAJIB dijaga oleh setiap penulisan handovers (Task 2.5) bersama checked_count/total_count.
ALTER TABLE handovers ADD COLUMN board_status TEXT NOT NULL DEFAULT 'new' CHECK (board_status IN ('new', 'in_progress', 'done', 'cancelled'));
UPDATE handovers SET board_status = CASE
  WHEN status = 'cancelled' THEN 'cancelled'
  WHEN total_count > 0 AND checked_count = total_count THEN 'done'
  WHEN total_count = 0 AND completed_at <> '' THEN 'done'
  WHEN checked_count > 0 THEN 'in_progress'
  ELSE 'new' END;
DROP INDEX handovers_board;
CREATE INDEX handovers_board ON handovers (location_id, board_status, updated_at);
