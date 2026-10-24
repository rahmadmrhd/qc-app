# Setup Cloudflare (Task 0.1)

Dibuat 2026-10-25 lewat `wrangler` (akun login pemilik). Nama proyek: **qc-app**.

| Sumber daya | Staging | Production |
|---|---|---|
| Worker | `qc-app-staging` | `qc-app` |
| D1 | `qc-app-staging` (`8328db7f-69e6-43ef-b4a4-7da285bb5194`) | `qc-app-production` (`a45aa48a-12b6-4d25-b43e-17490a292d55`) |
| Queue | `qc-app-jobs-staging` | `qc-app-jobs-production` |

Id database bukan rahasia. Rahasia (`SESSION_SECRET`, `OAUTH_CLIENT_SECRET`, `SYNC_API_TOKEN`, `BRIDGE_SECRET`, `CLOUDFLARE_API_TOKEN`) tidak boleh masuk repo; diatur dengan `wrangler secret put` / secret environment GitHub.
