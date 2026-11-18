/**
 * CLI penerbitan rilis desktop ke folder Drive (dipanggil job `publish` di `.github/workflows/release-desktop.yml`).
 *
 *   publish:  bun run scripts/publish-desktop-release.ts --version X.Y.Z --dir <folder installer> --changelog-file <berkas> --folder-id <idDrive>
 *   tarik:    bun run scripts/publish-desktop-release.ts --version X.Y.Z --folder-id <idDrive> --withdraw
 *
 * Rahasia hanya lewat lingkungan/berkas, tak pernah argumen atau log:
 *   GOOGLE_SA_KEY_FILE            berkas kunci service account PENERBIT (hanya berhak menulis folder rilis)
 *   RELEASE_SIGNING_KEY_FILE      berkas kunci privat Ed25519 penandatangan rilis (*.release-signing-key.pem)
 *   DESKTOP_RELEASE_PUBLIC_KEY_PEM kunci publik yang tertanam di aplikasi (pasangan diperiksa sebelum menandatangani)
 * Kode keluar: 0 berhasil, 1 gagal, 2 salah pakai.
 */
import { readFileSync } from 'node:fs';
import { createGoogleClient } from '../server/src/core/google/client';
import { isDriveId } from '../server/src/core/google/settings';
import {
  buildReleaseManifest,
  KEEP_VERSIONS,
  pruneInstallers,
  publishRelease,
  signRelease,
  withdrawRelease,
} from './desktop-release';

export const PUBLISH_USAGE =
  'Pemakaian: publish-desktop-release.ts --version X.Y.Z --folder-id <id> (--dir <folder> --changelog-file <berkas> | --withdraw)';

export type PublishArgs =
  | { mode: 'publish'; version: string; folderId: string; dir: string; changelogFile: string }
  | { mode: 'withdraw'; version: string; folderId: string };

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Mengurai argumen; bentuk yang salah (argumen asing, nilai hilang, versi/id tak sah) = `null`. */
export function parsePublishArgs(argv: string[]): PublishArgs | null {
  const values = new Map<string, string>();
  let withdraw = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--withdraw') {
      withdraw = true;
      continue;
    }
    if (!['--version', '--dir', '--changelog-file', '--folder-id'].includes(arg)) return null;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--') || values.has(arg)) return null;
    values.set(arg, value);
    i++;
  }
  const version = values.get('--version');
  const folderId = values.get('--folder-id');
  if (version === undefined || !VERSION.test(version)) return null;
  if (folderId === undefined || !isDriveId(folderId)) return null;
  if (withdraw) {
    return values.size === 2 ? { mode: 'withdraw', version, folderId } : null;
  }
  const dir = values.get('--dir');
  const changelogFile = values.get('--changelog-file');
  if (dir === undefined || changelogFile === undefined || values.size !== 4) return null;
  return { mode: 'publish', version, folderId, dir, changelogFile };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`Variabel ${name} kosong.`);
  return value;
}

async function main(): Promise<number> {
  const args = parsePublishArgs(process.argv.slice(2));
  if (args === null) {
    console.error(PUBLISH_USAGE);
    return 2;
  }
  const keyFile = requiredEnv('GOOGLE_SA_KEY_FILE');
  const client = createGoogleClient({
    GOOGLE_SA_KEY_FILE: keyFile,
    GOOGLE_ROOT_FOLDER_ID: '',
    GOOGLE_SPREADSHEET_ID: '',
    ATTACHMENTS_FOLDER_ID: '',
    QR_FOLDER_ID: '',
    QR_DOC_FOLDER_ID: '',
    BACKUP_FOLDER_ID: '',
    DESKTOP_RELEASES_FOLDER_ID: args.folderId,
    ALLOWED_FOLDER_IDS: [args.folderId],
  });
  if (args.mode === 'withdraw') {
    await withdrawRelease(client, args.folderId, args.version);
    console.log(`Rilis desktop ${args.version} ditarik (tanda tangan dihapus; berkas lain tetap).`);
    return 0;
  }
  const changelog = readFileSync(args.changelogFile, 'utf8').trim();
  const manifestJson = await buildReleaseManifest({
    version: args.version,
    dir: args.dir,
    changelog,
    publishedAt: new Date().toISOString(),
  });
  const signature = signRelease(
    manifestJson,
    requiredEnv('RELEASE_SIGNING_KEY_FILE'),
    requiredEnv('DESKTOP_RELEASE_PUBLIC_KEY_PEM'),
  );
  await publishRelease(client, args.folderId, {
    version: args.version,
    dir: args.dir,
    manifestJson,
    signature,
  });
  console.log(`Rilis desktop ${args.version} terbit di Drive (installer, manifest, tanda tangan).`);
  // Pembersihan hanya setelah rilis baru terlihat; kegagalannya tak membatalkan rilis yang sudah terbit.
  try {
    await pruneInstallers(client, args.folderId, KEEP_VERSIONS, args.version);
  } catch (error) {
    console.log(
      `::warning::Pembersihan versi lama gagal: ${error instanceof Error ? error.message : error}`,
    );
  }
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      // Pesan galat dari fungsi rilis sengaja tanpa rahasia; galat jaringan Google sudah dibersihkan klien.
      console.error(
        `publish-desktop-release gagal: ${error instanceof Error ? error.message : 'galat tak dikenal'}`,
      );
      process.exit(1);
    },
  );
}
