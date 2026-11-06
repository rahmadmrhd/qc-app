# syntax=docker/dockerfile:1
#
# Image server QC (Bun + Hono) beserta berkas statis web. Dibangun dari akar repo: `docker build -t qc-app .`
# Aturan: tanpa rahasia di image (semuanya lewat variabel lingkungan/berkas yang dipasang saat dijalankan),
# pengguna non-root, migrasi basis data dijalankan `main.ts` saat start SEBELUM port dibuka (gagal = proses keluar).

# Versi Bun dipatok (sama dengan yang dipakai pengembangan); jangan memakai `latest`.
ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION}-alpine AS base
WORKDIR /app

# Manifest workspace: dasar lapisan dependensi (dicache selama manifest dan bun.lock tidak berubah).
# gas/ dan bridge/ hanya memasok package.json (ada di bun.lock; kodenya tidak masuk image).
FROM base AS manifests
COPY package.json bun.lock ./
COPY shared/package.json shared/
COPY gas/package.json gas/
COPY bridge/package.json bridge/
COPY web/package.json web/
COPY server/package.json server/

# ---- Tahap 1: build web (Vite) ke /app/server/dist, lalu pemeriksaan verify-dist ----
FROM manifests AS web-build
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY shared shared
COPY web web
COPY scripts scripts
RUN bun run build

# ---- Tahap 2: dependensi produksi server saja (hono, mysql2) ----
FROM manifests AS prod-deps
RUN bun install --frozen-lockfile --production --filter @qc/server

# ---- Tahap 3: runtime ----
FROM base AS runtime
LABEL org.opencontainers.image.title="qc-app" \
      org.opencontainers.image.source="https://github.com/rahmadmrhd/qc-gas"

# Di dalam kontainer: dengarkan semua antarmuka (port dipublikasikan hanya ke 127.0.0.1 oleh compose).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788

# node_modules hasil `bun install` berisi symlink relatif (server/node_modules -> ../../node_modules/.bun/...):
# keduanya disalin utuh agar tautannya tetap valid.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/server/node_modules ./server/node_modules
COPY package.json tsconfig.base.json ./
COPY shared shared
COPY server/package.json server/tsconfig.json server/
COPY server/src server/src
# Migrator membaca berkas SQL dari disk: WAJIB ada di image.
COPY server/migrations server/migrations
# CLI pemulihan cadangan (T31): dijalankan lewat `docker exec`; logikanya ada di server/src/modules/backup/restore.ts.
COPY scripts/restore-backup.ts scripts/restore-backup.ts
COPY --from=web-build /app/server/dist server/dist
# Berkas tes tidak dibutuhkan runtime.
RUN find shared server/src -name '*.test.ts' -delete

# Klien MariaDB untuk cadangan malam (mariadb-dump) dan skrip pemulihan (mariadb). Hanya paket klien, bukan server.
# Folder dump lokal: named volume dipasang di sini; direktori dibuat dan dimiliki `bun` SEBELUM USER agar volume baru
# mewarisi kepemilikannya (tanpa ini volume dimiliki root dan cadangan tak dapat menulis).
RUN apk add --no-cache mariadb-client     && mkdir -p /var/backups/qc     && chown bun:bun /var/backups/qc

# Pengguna non-root bawaan image oven/bun (uid 1000).
USER bun
WORKDIR /app/server
EXPOSE 8788

# Gagal sehat bila /api/ping tak menjawab 200; start_period menampung migrasi saat start.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 8788}/api/ping`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Bentuk exec: SIGTERM dari `docker stop` langsung ke Bun (shutdown rapi di main.ts).
ENTRYPOINT ["bun", "src/main.ts"]
