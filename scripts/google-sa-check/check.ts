/**
 * Cek kuota Drive service account Google (dijalankan LOKAL oleh pemilik; tidak dipakai aplikasi).
 *
 *   bun run scripts/google-sa-check/check.ts <kunci.json> [--folder <idFolder>]
 *
 * 1. `about.get`      : akun yang dipakai dan `storageQuota`.
 * 2. `files.list`     : berkas yang DIMILIKI service account (itulah yang memakai kuotanya).
 * 3. `--folder`       : uji tulis nyata. Membuat berkas kecil di folder itu (harus dibagikan ke
 *                       service account sebagai Editor), lalu menghapusnya. `403 storageQuotaExceeded`
 *                       berarti service account tidak bisa membuat berkas di Drive tersebut.
 *
 * Tanpa dependensi: token OAuth diperoleh dengan JWT RS256 lewat `node:crypto`. Kunci dan token
 * TIDAK pernah dicetak. Simpan kunci di folder ini (`*.json` diabaikan git) atau di luar repo.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function parseArgs(argv: string[]): { keyPath: string; folderId: string | null } {
  const keyPath = argv.find((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--folder');
  if (!keyPath) {
    console.error(
      'Pemakaian: bun run scripts/google-sa-check/check.ts <kunci.json> [--folder <idFolder>]',
    );
    process.exit(2);
  }
  const at = argv.indexOf('--folder');
  return { keyPath, folderId: at >= 0 ? (argv[at + 1] ?? null) : null };
}

function readKey(path: string): ServiceAccountKey {
  const key = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) {
    throw new Error('Berkas bukan kunci service account (client_email/private_key tidak ada).');
  }
  return { client_email: key.client_email, private_key: key.private_key, token_uri: key.token_uri };
}

async function accessToken(key: ServiceAccountKey): Promise<string> {
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key);
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${base64Url(signature)}`,
    }),
  });
  if (!response.ok)
    throw new Error(`Gagal meminta token (${response.status}): ${await response.text()}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
}

function bytes(value: string | undefined): string {
  if (value === undefined) return '(tidak ada)';
  const n = Number(value);
  return `${value} byte (${(n / 1024 / 1024).toFixed(2)} MB)`;
}

async function showQuota(token: string): Promise<void> {
  const response = await call(token, `${DRIVE}/about?fields=storageQuota,user(emailAddress)`);
  if (!response.ok)
    throw new Error(`about.get gagal (${response.status}): ${await response.text()}`);
  const about = (await response.json()) as {
    user?: { emailAddress?: string };
    storageQuota?: { limit?: string; usage?: string; usageInDrive?: string };
  };
  console.log('\n[1] Kuota (about.get)');
  console.log(`    akun         : ${about.user?.emailAddress}`);
  console.log(`    limit        : ${bytes(about.storageQuota?.limit)}`);
  console.log(`    usage        : ${bytes(about.storageQuota?.usage)}`);
  console.log(`    usageInDrive : ${bytes(about.storageQuota?.usageInDrive)}`);
}

async function showOwnedFiles(token: string): Promise<void> {
  const query = new URLSearchParams({
    q: "'me' in owners and trashed = false",
    fields: 'files(id,name,size)',
    pageSize: '100',
  });
  const response = await call(token, `${DRIVE}/files?${query}`);
  if (!response.ok)
    throw new Error(`files.list gagal (${response.status}): ${await response.text()}`);
  const { files = [] } = (await response.json()) as {
    files?: { id: string; name: string; size?: string }[];
  };
  const total = files.reduce((sum, file) => sum + Number(file.size ?? 0), 0);
  console.log('\n[2] Berkas milik service account (maks. 100 pertama)');
  console.log(`    jumlah       : ${files.length}`);
  console.log(`    total ukuran : ${bytes(String(total))}`);
  for (const file of files.slice(0, 10))
    console.log(`    - ${file.name} (${file.id}, ${file.size ?? '?'} byte)`);
}

async function writeTest(token: string, folderId: string): Promise<void> {
  console.log(`\n[3] Uji tulis di folder ${folderId}`);
  const boundary = `qc-sa-check-${Date.now()}`;
  const metadata = JSON.stringify({
    name: 'qc-sa-check.txt',
    parents: [folderId],
    mimeType: 'text/plain',
  });
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/plain',
    '',
    'uji kuota service account',
    `--${boundary}--`,
    '',
  ].join('\r\n');
  const response = await call(
    token,
    `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  const text = await response.text();
  if (!response.ok) {
    console.log(`    GAGAL (${response.status}): ${text}`);
    if (text.includes('storageQuotaExceeded')) {
      console.log(
        '    => Service account TIDAK bisa membuat berkas di Drive ini (butuh OAuth pemilik atau Shared Drive).',
      );
    }
    return;
  }
  const { id } = JSON.parse(text) as { id: string };
  console.log(`    BERHASIL membuat berkas ${id}; service account bisa menulis di folder ini.`);
  const removed = await call(token, `${DRIVE}/files/${id}?supportsAllDrives=true`, {
    method: 'DELETE',
  });
  console.log(
    removed.ok
      ? '    berkas uji dihapus.'
      : `    peringatan: berkas uji gagal dihapus (${removed.status}), hapus manual.`,
  );
}

const { keyPath, folderId } = parseArgs(process.argv.slice(2));
const token = await accessToken(readKey(keyPath));
await showQuota(token);
await showOwnedFiles(token);
if (folderId) await writeTest(token, folderId);
else console.log('\n[3] Dilewati (tambahkan --folder <idFolder> untuk uji tulis nyata).');
