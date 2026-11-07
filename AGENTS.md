# QC App — panduan untuk agen

Panduan lengkap (perintah, struktur, aturan server/frontend, cara menambah rute REST, tooling agen) ada di
[`CLAUDE.md`](CLAUDE.md) dan menjadi satu-satunya sumber; berkas ini sengaja tidak menyalinnya agar tak ada dua versi.

Ringkasnya: aplikasi Quality Control dengan frontend React + TanStack (`web/`), backend Bun + Hono + MariaDB (`server/`),
dan kontrak bersama (`shared/`). Aplikasi Google Apps Script lama sudah dipensiunkan (T35); kodenya hanya ada di tag
`gas-legacy`. Resep modul baru: `docs/adding-a-module.md`.
