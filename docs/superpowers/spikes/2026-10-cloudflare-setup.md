# Setup Cloudflare (Task 0.1)

Dibuat 2026-10-25 lewat `wrangler`. Nama proyek: **qc-app**. Akun Cloudflare: **QC** (account id `2256d27ce4dcdcb9ade777cc2650fd81`). Login Wrangler pemilik punya lebih dari satu akun, jadi SEMUA perintah `wrangler` non-interaktif wajib menyebut akun: `CLOUDFLARE_ACCOUNT_ID=2256d27ce4dcdcb9ade777cc2650fd81` (atau `account_id` di `wrangler.jsonc`). Jangan memakai akun lain.

| Sumber daya | Staging | Production |
|---|---|---|
| Worker | `app-staging` | `app` |
| D1 | `qc-app-staging` (`67c826c4-e20e-413b-b611-0653a480c130`) | `qc-app-production` (`cf7f9bb3-202d-4819-bc1f-c60581795933`) |
| Queue | `qc-app-jobs-staging` | `qc-app-jobs-production` |

Id akun dan database bukan rahasia. Rahasia (`SESSION_SECRET`, `OAUTH_CLIENT_SECRET`, `SYNC_API_TOKEN`, `BRIDGE_SECRET`, `CLOUDFLARE_API_TOKEN`) tidak boleh masuk repo; diatur dengan `wrangler secret put` / secret environment GitHub.

Catatan: sumber daya sempat dibuat di akun yang salah dan sudah dihapus seluruhnya.

Prasyarat tambahan (ditemukan di Task 0.3): akun QC belum punya subdomain `workers.dev`. Selama belum ada, `wrangler deploy` gagal ("This Worker does not exist", kode 10007) dan pemasangan konsumen Queue ditolak (kode 10063). Buka menu Workers di dashboard akun QC sekali (otomatis membuat subdomain) atau daftarkan di halaman onboarding Workers.

## Subdomain workers.dev
Terdaftar 2026-10-25: **`qc-225.workers.dev`** (nama `qc` sudah dipakai pihak lain). Nama Worker (keputusan pemilik): `app` (production) dan `app-staging` (staging); D1 dan Queue tetap `qc-app-*`. Alamat: production `https://app.qc-225.workers.dev`, staging `https://app-staging.qc-225.workers.dev`. Redirect OAuth yang harus didaftarkan di Google Cloud Console: `https://app-staging.qc-225.workers.dev/auth/callback` dan `https://app.qc-225.workers.dev/auth/callback`.
