// Perlengkapan tes klien Google: server Google palsu + kunci uji + jam terkendali + pengaturan folder.
import { createGoogleClient, type GoogleClient } from '@server/core/google/client';
import type { GoogleDeps, GoogleSettings } from '@server/core/google/settings';
import { createFakeGoogle, createTestServiceAccount, type FakeGoogle } from './fake-google';

export const ROOT_ID = 'ROOTFOLDER00001';
export const IMAGES_ID = 'IMAGESFOLDER001';
export const QR_ID = 'QRFOLDERID00001';
export const QR_DOC_ID = 'QRDOCFOLDER0001';
export const BACKUP_ID = 'BACKUPFOLDER001';
/** Folder rilis desktop: milik pemilik, BUKAN anak folder induk (hanya lolos karena tercantum di konfigurasi). */
export const RELEASES_ID = 'RELEASESFOLDER01';
export const OUTSIDE_ID = 'OUTSIDEFOLDER01';
export const SPREADSHEET_ID = 'SPREADSHEET0001';
export const KEY_PATH = '/run/secrets/google-sa.json';

export interface GoogleRig {
  client: GoogleClient;
  fake: FakeGoogle;
  settings: GoogleSettings;
  keyJson: string;
  privateKeyPem: string;
  clock: { now(): number; advance(ms: number): void };
  sleeps: number[];
  /** Seluruh keluaran `console.*` selama tes (untuk uji sentinel). */
  logs: string[];
  restoreConsole(): void;
  /** Membuat klien baru dengan pengaturan/dependensi tambahan (fake dan jam sama). */
  make(settings?: Partial<GoogleSettings>, deps?: GoogleDeps): GoogleClient;
}

export async function createGoogleRig(
  overrides: Partial<GoogleSettings> = {},
  deps: GoogleDeps = {},
): Promise<GoogleRig> {
  const account = await createTestServiceAccount();
  let current = Date.parse('2026-11-06T03:00:00.000Z');
  const clock = {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
  const fake = createFakeGoogle({ publicKey: account.publicKey, now: clock.now });
  fake.addFolder(ROOT_ID);
  for (const id of [IMAGES_ID, QR_ID, QR_DOC_ID, BACKUP_ID]) fake.addFolder(id, [ROOT_ID]);
  fake.addFolder(OUTSIDE_ID);
  fake.addFolder(RELEASES_ID);
  fake.sheets.set(SPREADSHEET_ID, new Map());

  const settings: GoogleSettings = {
    GOOGLE_SA_KEY_FILE: KEY_PATH,
    GOOGLE_ROOT_FOLDER_ID: ROOT_ID,
    GOOGLE_SPREADSHEET_ID: SPREADSHEET_ID,
    ATTACHMENTS_FOLDER_ID: IMAGES_ID,
    QR_FOLDER_ID: QR_ID,
    QR_DOC_FOLDER_ID: QR_DOC_ID,
    BACKUP_FOLDER_ID: BACKUP_ID,
    DESKTOP_RELEASES_FOLDER_ID: RELEASES_ID,
    ALLOWED_FOLDER_IDS: [],
    ...overrides,
  };
  const sleeps: number[] = [];
  const logs: string[] = [];
  const original = { ...console };
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    console[level] = (...args: unknown[]) => {
      logs.push(
        args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '),
      );
    };
  }
  const baseDeps: GoogleDeps = {
    fetch: fake.fetch,
    readKeyFile: async () => account.keyJson,
    now: clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...deps,
  };
  const make = (extra: Partial<GoogleSettings> = {}, extraDeps: GoogleDeps = {}) =>
    createGoogleClient({ ...settings, ...extra }, { ...baseDeps, ...extraDeps });
  return {
    client: make(),
    fake,
    settings,
    keyJson: account.keyJson,
    privateKeyPem: account.privateKeyPem,
    clock,
    sleeps,
    logs,
    restoreConsole() {
      Object.assign(console, original);
    },
    make,
  };
}
