# QC App

Aplikasi web internal Quality Control. Backend Google Apps Script + Google Sheets; frontend React + TanStack + shadcn/ui yang di-build menjadi satu file HTML dan disajikan oleh Apps Script.

## Prasyarat
- [Bun](https://bun.sh) versi terbaru
- [clasp](https://github.com/google/clasp) 3.x, sudah `clasp login` dengan akun pemilik script
- Git

## Mulai
```bash
bun install
bun run dev
```
Buka http://localhost:3000 dan pilih user mock di halaman login. Tema terang/gelap dapat diganti dari tombol di header.

## Perintah
| Perintah | Fungsi |
|---|---|
| `bun run dev` | FE lokal + mock backend |
| `bun run check` | typecheck, lint, test |
| `bun run build` | build `gas/dist` |
| `bun run push` | check + build + `clasp push` |
| `bun run deploy` | push + perbarui deployment web app |

## Dokumentasi
- Setup Google Cloud, Script Properties, deploy pertama: `docs/setup-google.md`
- Menambah modul: `docs/adding-a-module.md`
- Checklist uji manual: `docs/e2e-checklist.md`
- PRD: `docs/prd/`
