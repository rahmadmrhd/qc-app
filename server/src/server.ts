import { app } from '@server/app';
import type { Config } from '@server/config';
import { createDb, type Db } from '@server/core/db';
import type { Env } from '@server/core/env';
import { MAX_REQUEST_BODY_BYTES } from '@server/http/body';
import { clientIp } from '@server/http/proxy';
import { startJobRunner, startScheduler } from '@server/jobs/runner';

export interface ServerOptions {
  /** Hanya tes: pakai `Db` yang sudah ada (tidak ditutup oleh `stop`) alih-alih membuat pool dari `databaseUrl`. */
  db?: Db;
  /** `false` = tanpa runner job dan penjadwal (tes). Bawaan `true`. */
  background?: boolean;
  /** Hanya tes: timpa/ tambah isi `Env` (jembatan palsu, jam terkendali, ...). */
  env?: Partial<Env>;
}

export interface QcServer {
  env: Env;
  /** `peerAddress`: alamat TCP lawan bicara (bukan header); dipakai `clientIp` untuk pembatas dan log. */
  fetch(request: Request, peerAddress: string): Response | Promise<Response>;
  /** Hentikan runner/penjadwal (menunggu putaran berjalan selesai), lalu tutup pool basis data milik sendiri. */
  stop(): Promise<void>;
}

/** Menyusun `Env` aplikasi dari konfigurasi dan sebuah `Db`. */
export function envFromConfig(config: Config, db: Db): Env {
  return {
    DB: db,
    SESSION_SECRET: config.sessionSecret,
    OAUTH_CLIENT_ID: config.oauthClientId,
    OAUTH_CLIENT_SECRET: config.oauthClientSecret,
    SYNC_API_TOKEN: config.syncApiToken,
    BRIDGE_URL: config.bridgeUrl,
    BRIDGE_SECRET: config.bridgeSecret,
    ADMIN_EMAIL: config.adminEmail,
    ...(config.appOrigin === undefined ? {} : { APP_ORIGIN: config.appOrigin }),
    ...(config.devLoginEmail === undefined ? {} : { DEV_LOGIN_EMAIL: config.devLoginEmail }),
  };
}

/**
 * Server aplikasi: Hono (`app`) + `Env` dari konfigurasi + runner job dan penjadwal latar. Tidak membuka port
 * (itu tugas `main.ts` lewat `Bun.serve`), sehingga tes cukup memanggil `fetch`.
 */
export function createServer(config: Config, options: ServerOptions = {}): QcServer {
  const ownsDb = options.db === undefined;
  const db =
    options.db ?? createDb({ url: config.databaseUrl, connectionLimit: config.dbPoolSize });
  const env: Env = { ...envFromConfig(config, db), ...options.env };
  const stops = options.background === false ? [] : [startJobRunner(env), startScheduler(env)];
  return {
    env,
    fetch: (request, peerAddress) =>
      app.fetch(request, {
        ...env,
        clientIp: clientIp(request, peerAddress, config.trustedProxy),
        peerAddress,
        staticDir: config.staticDir,
      }),
    async stop() {
      await Promise.all(stops.map((stop) => stop()));
      if (ownsDb) await db.close();
    },
  };
}

/**
 * Opsi `Bun.serve` untuk server ini: alamat TCP peer diteruskan ke aplikasi dan `maxRequestBodySize` dibatasi
 * (`MAX_REQUEST_BODY_BYTES`; di atasnya Bun membalas 413 sebelum badan dimuat ke memori).
 */
export function bunServeOptions(server: QcServer, listen: { host: string; port: number }) {
  return {
    hostname: listen.host,
    port: listen.port,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    fetch: (request: Request, srv: { requestIP(request: Request): { address: string } | null }) =>
      server.fetch(request, srv.requestIP(request)?.address ?? ''),
  };
}
