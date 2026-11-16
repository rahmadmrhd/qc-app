-- Push per perangkat (spek 2026-11-12-notifikasi-serah-terima-design.md, "Push dimatikan per perangkat"): pengguna dapat
-- mematikan push di SATU perangkat (mis. Chrome di PC yang sama dengan aplikasi desktop) tanpa mematikannya di
-- perangkat lain. `muted` = 1 membuat pengirim push melewati langganan itu; barisnya tetap ada sehingga
-- `push.subscribe` ulang (sinkron senyap tiap sesi) tidak menyalakannya kembali.
--
-- EXPAND-ONLY, kompatibel mundur: satu kolom baru dengan nilai bawaan 0 (= perilaku lama). Image sebelumnya tak
-- membacanya dan tetap berjalan di atas skema ini; ia hanya akan mengirim ke perangkat yang dimatikan (pengecualian
-- rollback tercatat di docs/ci-cd.md). Idempoten (IF NOT EXISTS).
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS muted TINYINT NOT NULL DEFAULT 0;
