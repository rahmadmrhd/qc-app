import { app } from '@server/app';
import type { Config } from '@server/config';
import { createDb, type Db } from '@server/core/db';
import type { Env } from '@server/core/env';
import { createGoogleClient } from '@server/core/google/client';
import { createSmtpMailer } from '@server/core/mail';
import { MAX_REQUEST_BODY_BYTES } from '@server/http/body';
import { clientIp } from '@server/http/proxy';
import { startJobRunner, startNotificationLoop, startScheduler } from '@server/jobs/runner';
import { createMariadbDumpRunner, parseDatabaseUrl } from '@server/modules/backup/dump';
import { closeAllNotificationStreams } from '@server/modules/notification/stream-hub';
import { createWebPushSender } from '@server/modules/notification/web-push';
import { backfillPostelStickers } from '@server/modules/postel/stickers';
import { createProofStore } from '@server/modules/serial/proof/store';

export interface ServerOptions {
  /** Hanya tes: pakai `Db` yang sudah ada (tidak ditutup oleh `stop`) alih-alih membuat pool dari `databaseUrl`. */
  db?: Db;
  /** `false` = tanpa runner job dan penjadwal (tes). Bawaan `true`. */
  background?: boolean;
  /** Hanya tes: timpa/ tambah isi `Env` (jembatan palsu, jam terkendali, ...). */
  env?: Partial<Env>;
  /**
   * Persiapan basis data yang HARUS selesai sebelum runner job dan penjadwal dijalankan (`main.ts`:
   * `prepareDatabase` = cek koneksi + migrasi). Tanpa ini runner mulai menanyai tabel yang belum ada pada skema
   * baru dan mencatat galat. Gagal = `ready` menolak dan runner/penjadwal tidak pernah dijalankan.
   */
  prepare?: (db: Db) => Promise<string[]>;
}

export interface QcServer {
  env: Env;
  /** `peerAddress`: alamat TCP lawan bicara (bukan header); dipakai `clientIp` untuk pembatas dan log. */
  fetch(request: Request, peerAddress: string): Response | Promise<Response>;
  /** Selesai setelah `prepare` (bila ada) berhasil dan runner/penjadwal berjalan; menolak bila `prepare` gagal. */
  ready: Promise<string[]>;
  /** Hentikan runner/penjadwal (menunggu putaran berjalan selesai), lalu tutup pool basis data milik sendiri. */
  stop(): Promise<void>;
}

/** Menyusun `Env` aplikasi dari konfigurasi dan sebuah `Db`. */
export function envFromConfig(config: Config, db: Db): Env {
  const google = {
    GOOGLE_SA_KEY_FILE: config.googleSaKeyFile,
    GOOGLE_ROOT_FOLDER_ID: config.googleRootFolderId,
    GOOGLE_SPREADSHEET_ID: config.googleSpreadsheetId,
    ATTACHMENTS_FOLDER_ID: config.attachmentsFolderId,
    QR_FOLDER_ID: config.qrFolderId,
    QR_DOC_FOLDER_ID: config.qrDocFolderId,
    BACKUP_FOLDER_ID: config.backupFolderId,
    DESKTOP_RELEASES_FOLDER_ID: config.desktopReleasesFolderId,
    ALLOWED_FOLDER_IDS: config.allowedFolderIds,
  };
  return {
    DB: db,
    ...google,
    // Satu klien per proses: token OAuth service account di-cache di dalamnya (membuatnya tidak menyentuh jaringan).
    BRIDGE: createGoogleClient(google),
    SESSION_SECRET: config.sessionSecret,
    OAUTH_CLIENT_ID: config.oauthClientId,
    OAUTH_CLIENT_SECRET: config.oauthClientSecret,
    BUILD_SHA: config.buildSha,
    ADMIN_EMAIL: config.adminEmail,
    // Cadangan malam hanya di produksi dengan Google terkonfigurasi dan `BACKUP_ENABLED` tidak `false` (staging memakainya untuk mati; CLI pemulihan tak terpengaruh) (dev memakai basis data bersama di VPS dan tak
    // punya mariadb-dump); `parseDatabaseUrl` hanya dipakai bila dump dijalankan (URL sudah divalidasi `loadConfig`).
    BACKUP_ENABLED:
      config.production &&
      config.backupEnabled &&
      config.googleSaKeyFile !== '' &&
      config.googleRootFolderId !== '',
    BACKUP_LOCAL_DIR: config.backupLocalDir,
    PROOF_STORE: createProofStore(config.proofStagingDir),
    PROOF_STAGING_MAX_BYTES: config.proofStagingMaxBytes,
    BACKUP_DUMP: (outputPath) =>
      createMariadbDumpRunner(parseDatabaseUrl(config.databaseUrl))(outputPath),
    ...(config.smtp === null ? {} : { MAILER: createSmtpMailer(config.smtp) }),
    ALERT_TO: config.alertTo,
    ...(config.vapid === null
      ? {}
      : { PUSH: createWebPushSender(config.vapid), VAPID_PUBLIC_KEY: config.vapid.publicKey }),
    ...(config.desktopCatalogToken === ''
      ? {}
      : { DESKTOP_CATALOG_TOKEN: config.desktopCatalogToken }),
    QUOTA_ALERT_PERCENT: config.quotaAlertPercent,
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
  let stops: Array<() => Promise<void>> = [];
  const startBackground = () => {
    if (options.background !== false)
      stops = [startJobRunner(env), startScheduler(env), startNotificationLoop(env)];
  };
  const ready = (options.prepare ? options.prepare(db) : Promise.resolve([] as string[])).then(
    async (result) => {
      // Hanya di jalur nyata (ada persiapan basis data): catatan Postel lama dibekali stiker per catatan. Galatnya
      // dicatat tanpa menggagalkan start (pengisi idempoten, diulang pada start berikutnya).
      if (options.prepare) {
        try {
          await backfillPostelStickers(env);
        } catch (error) {
          console.error('Pengisian stiker Postel gagal:', error);
        }
      }
      startBackground();
      return result;
    },
  );
  // Penolakan ditangani pemanggil lewat `ready`; tanpa ini, tes/pemanggil yang tak menunggu memicu "unhandled".
  ready.catch(() => {});
  return {
    env,
    ready,
    fetch: (request, peerAddress) =>
      app.fetch(request, {
        ...env,
        clientIp: clientIp(request, peerAddress, config.trustedProxy),
        peerAddress,
        staticDir: config.staticDir,
      }),
    async stop() {
      await ready.catch(() => {}); // runner dimulai (atau tidak) sebelum dihentikan
      // Aliran SSE desktop ditutup dulu: koneksi berumur panjang tak boleh menahan shutdown (klien menyambung ulang).
      closeAllNotificationStreams();
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
