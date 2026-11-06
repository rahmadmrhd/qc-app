/**
 * Uji integrasi MANUAL klien Google langsung (T30a; dijalankan LOKAL oleh pemilik, tidak masuk `bun run check`).
 * Memakai klien yang SAMA dengan server (`createGoogleClient`) terhadap Google sungguhan, untuk hal yang tidak dapat
 * dibuktikan dengan server Google palsu: kuota/kepemilikan berkas service account, unggah resumable 9 MB, pembacaan
 * dan penulisan Sheets, serta hak Editor atas berkas/folder lama milik pemilik.
 *
 *   bun run scripts/google-sa-check/qc-integration.ts --config <berkas.json>
 *   bun run scripts/google-sa-check/qc-integration.ts --key <kunci.json> --root <idFolderInduk> \
 *       [--spreadsheet <id>] [--legacy-folder <id>] [--legacy-file <id>]
 *
 * Kunci dan id diberikan lewat argumen atau berkas di luar repositori. Kunci dan token TIDAK pernah dicetak.
 * Skrip membuat subfolder uji di bawah folder induk dan menghapus semua yang dibuatnya di akhir.
 * Petunjuk lengkap: docs/setup-google.md bagian S7.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { bytesToBase64 } from '../../server/src/core/bytes';
import { createTokenProvider, GOOGLE_SCOPES } from '../../server/src/core/google/auth';
import { createGoogleClient } from '../../server/src/core/google/client';
import {
  formatReport,
  type IntegrationArgs,
  parseArgs,
  patternBytes,
  type StepResult,
  USAGE,
} from './qc-integration-lib';

const NINE_MB = 9 * 1024 * 1024;
const TEST_SHEET = 'export_integrasi_qc';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

/** Keterangan galat tanpa rahasia: kode aplikasi dan pesan ringkas (pesan klien tidak memuat token/kunci). */
function describe(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return `${code ?? 'galat'}: ${message}`.slice(0, 200);
}

async function main(): Promise<number> {
  let args: IntegrationArgs;
  try {
    args = parseArgs(process.argv.slice(2), (path) => JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  const results: StepResult[] = [];
  const step = async (name: string, run: () => Promise<string | undefined>) => {
    try {
      results.push({ name, ok: true, ...optionalDetail(await run()) });
    } catch (error) {
      results.push({ name, ok: false, detail: describe(error) });
    }
  };
  const optionalDetail = (detail: string | undefined) => (detail ? { detail } : {});
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };

  // Token untuk panggilan mentah (bersih-bersih, verifikasi Sheets, `capabilities`); klien memakai penyedia sendiri.
  const readKeyFile = async (path: string) => readFileSync(path, 'utf8');
  const tokens = createTokenProvider({
    keyFile: args.key,
    scopes: GOOGLE_SCOPES,
    fetch,
    readKeyFile,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const raw = async (method: string, url: string, body?: unknown): Promise<Response> =>
    fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${await tokens.getAccessToken()}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const settings = {
    GOOGLE_SA_KEY_FILE: args.key,
    GOOGLE_ROOT_FOLDER_ID: args.root,
    GOOGLE_SPREADSHEET_ID: args.spreadsheet ?? '',
    ITEM_IMAGES_FOLDER_ID: '',
    QR_FOLDER_ID: '',
    QR_DOC_FOLDER_ID: '',
    BACKUP_FOLDER_ID: '',
    ALLOWED_FOLDER_IDS: [args.legacyFolder].filter((id): id is string => id !== undefined),
  };
  const client = createGoogleClient(settings);

  const createdFiles: string[] = [];
  let testFolder = '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  // --- Folder induk dan kuota ---
  await step(
    'folder induk terbaca dan dapat ditulis (buat subfolder uji di bawah induk)',
    async () => {
      testFolder = await client.createFolder(`qc-integrasi-${stamp}`);
      assert(await client.folderExists(testFolder), 'subfolder uji tidak terbaca setelah dibuat');
      return `subfolder ${testFolder}`;
    },
  );
  await step('kuota penyimpanan service account', async () => {
    const quota = await client.storageQuota();
    return `limit ${quota.limit ?? 'tak terbatas'} byte, terpakai ${quota.usage} byte`;
  });
  if (testFolder === '') {
    console.log(formatReport(results).text);
    return 1;
  }

  // --- Berkas kecil (multipart) ---
  const small = patternBytes(10_000);
  let smallId = '';
  await step('unggah berkas kecil (multipart) lalu baca kembali (byte sama)', async () => {
    smallId = await client.createFile(
      testFolder,
      'kecil.bin',
      'application/octet-stream',
      bytesToBase64(small),
    );
    createdFiles.push(smallId);
    const read = await client.readFile(smallId, testFolder);
    assert(read !== null && read.base64 === bytesToBase64(small), 'isi berbeda');
    const info = await client.fileInfo(smallId, testFolder);
    assert(info?.size === small.length, 'ukuran berbeda');
    return `${small.length} byte`;
  });
  await step('ganti nama, ganti isi (id tetap), lalu berbagi dan cabut berbagi', async () => {
    await client.renameFile(smallId, 'kecil-baru.bin');
    await client.replaceFileContent(
      smallId,
      'application/octet-stream',
      bytesToBase64(patternBytes(2048)),
    );
    const read = await client.readFile(smallId, testFolder);
    assert(read?.base64 === bytesToBase64(patternBytes(2048)), 'isi tidak berganti');
    await client.shareAnyoneWithLink(smallId);
    const shared = await (
      await raw('GET', `${DRIVE}/files/${smallId}/permissions?fields=permissions(type)`)
    ).json();
    assert(JSON.stringify(shared).includes('anyone'), 'izin anyone tidak terbentuk');
    await client.revokeSharing(smallId);
    const after = await (
      await raw('GET', `${DRIVE}/files/${smallId}/permissions?fields=permissions(type)`)
    ).json();
    assert(!JSON.stringify(after).includes('anyone'), 'izin anyone tidak tercabut');
  });

  // --- Berkas besar (resumable) ---
  const big = patternBytes(NINE_MB);
  let bigId = '';
  await step('unggah 9 MB (resumable): ukuran dan MD5 Drive sama dengan lokal', async () => {
    const uploaded = await client.uploadFile(
      testFolder,
      'besar.bin',
      'application/octet-stream',
      new Blob([big]),
      {
        appProperties: { sha256: sha256(big) },
      },
    );
    bigId = uploaded.id;
    createdFiles.push(bigId);
    assert(uploaded.size === big.length, `ukuran ${uploaded.size} != ${big.length}`);
    assert(uploaded.md5Checksum === md5(big), 'MD5 Drive berbeda dari MD5 lokal');
    return `${big.length} byte, md5 sama`;
  });
  await step('unduh 9 MB sebagai aliran: SHA-256 sama dengan lokal', async () => {
    const download = await client.downloadFile(bigId, testFolder);
    if (download === null) throw new Error('tidak ditemukan');
    const bytes = new Uint8Array(
      await new Response(download.body as unknown as ReadableStream).arrayBuffer(),
    );
    assert(sameBytes(bytes, big), 'isi berbeda');
    return `${bytes.length} byte`;
  });
  await step('unggah 9 MB lewat createFile (base64) lalu baca kembali', async () => {
    const id = await client.createFile(
      testFolder,
      'besar-b64.bin',
      'application/octet-stream',
      bytesToBase64(big),
    );
    createdFiles.push(id);
    const read = await client.readFile(id, testFolder);
    assert(read?.base64 === bytesToBase64(big), 'isi berbeda');
  });
  await step(
    'listFolder: kedua berkas besar dan kecil terdaftar dengan md5/appProperties',
    async () => {
      const page = await client.listFolder(testFolder, { pageSize: 2 });
      const all = [...page.files];
      let token = page.nextPageToken;
      while (token) {
        const next = await client.listFolder(testFolder, { pageSize: 2, pageToken: token });
        all.push(...next.files);
        token = next.nextPageToken;
      }
      assert(
        all.length === createdFiles.length,
        `${all.length} entri, diharapkan ${createdFiles.length}`,
      );
      const entry = all.find((f) => f.id === bigId);
      assert(entry?.appProperties.sha256 === sha256(big), 'appProperties.sha256 tidak tersimpan');
      return `${all.length} berkas`;
    },
  );
  await step('berkas uji milik service account dan dapat dihapus permanen', async () => {
    const owned = await (await raw('GET', `${DRIVE}/files/${bigId}?fields=ownedByMe`)).json();
    assert((owned as { ownedByMe?: boolean }).ownedByMe === true, 'bukan milik service account');
  });

  // --- Sheets ---
  if (args.spreadsheet) {
    await step('Sheets: sheetsDump membaca sheet sumber (tanpa export_)', async () => {
      const dump = await client.sheetsDump();
      const names = Object.keys(dump);
      return `${names.length} sheet: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', ...' : ''}`;
    });
    await step(
      `Sheets: export replace + append ke ${TEST_SHEET} (nilai tersimpan sebagai teks)`,
      async () => {
        await client.sheetsExport({
          sheet: TEST_SHEET,
          columns: ['id', 'nama'],
          rows: [
            ['1', '=1+1'],
            ['2', '007'],
          ],
          mode: 'replace',
        });
        await client.sheetsExport({
          sheet: TEST_SHEET,
          columns: ['id', 'nama'],
          rows: [['3', '+x']],
          mode: 'append',
        });
        const range = encodeURIComponent(`'${TEST_SHEET}'`);
        const res = await raw(
          'GET',
          `${SHEETS}/${args.spreadsheet}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`,
        );
        const body = (await res.json()) as { values?: string[][] };
        const expected = JSON.stringify([
          ['id', 'nama'],
          ['1', '=1+1'],
          ['2', '007'],
          ['3', '+x'],
        ]);
        assert(
          JSON.stringify(body.values) === expected,
          `isi sheet tak sesuai: ${JSON.stringify(body.values)}`,
        );
      },
    );
  } else {
    results.push({ name: 'Sheets', ok: true, detail: 'dilewati: --spreadsheet tidak diberikan' });
  }

  // --- Folder/berkas lama milik pemilik (hanya membaca hak; rename lalu kembalikan) ---
  const capabilityFields =
    'id,name,mimeType,parents,capabilities(canEdit,canTrash,canDelete,canRename,canMoveItemWithinDrive,canAddMyDriveParent,canRemoveMyDriveParent)';
  for (const [label, id] of [
    ['folder lama', args.legacyFolder],
    ['berkas lama', args.legacyFile],
  ] as const) {
    if (!id) continue;
    // Hak dibaca sekali lalu DIPECAH menjadi langkah PASS/FAIL sendiri: hak membuang/memindah sering tidak ada pada
    // Editor non-pemilik di My Drive, dan itu tidak boleh terkubur di dalam satu baris PASS.
    let caps: Record<string, boolean> | null = null;
    await step(
      `${label} milik pemilik: terbaca oleh service account (sudah dibagikan sebagai Editor)`,
      async () => {
        const res = await raw(
          'GET',
          `${DRIVE}/files/${id}?fields=${encodeURIComponent(capabilityFields)}`,
        );
        assert(res.ok, `HTTP ${res.status} (belum dibagikan ke service account sebagai Editor?)`);
        caps = ((await res.json()) as { capabilities: Record<string, boolean> }).capabilities;
        return Object.entries(caps)
          .map(([key, value]) => `${key}=${value}`)
          .join(' ');
      },
    );
    const known = caps as Record<string, boolean> | null;
    if (known === null) continue;
    const need: Array<[string, string, string[]]> = [
      ['mengubah (Editor)', 'canEdit', []],
      ['mengganti nama', 'canRename', []],
      ['membuang ke sampah (migrasi: hapus gambar lama)', 'canTrash', []],
      [
        'memindahkan di dalam Drive (migrasi: folder lama ke bawah induk)',
        'canMoveItemWithinDrive',
        ['canAddMyDriveParent', 'canRemoveMyDriveParent'],
      ],
    ];
    for (const [what, main, extra] of need) {
      await step(`${label}: hak ${what}`, async () => {
        const failed = [main, ...extra].filter((key) => known[key] !== true);
        assert(failed.length === 0, `tidak ada hak: ${failed.join(', ')}`);
        return [main, ...extra].map((key) => `${key}=true`).join(' ');
      });
    }
  }
  if (args.legacyFile) {
    await step(
      'berkas lama: rename lalu kembalikan nama asli (membuktikan hak Editor atas isi lama)',
      async () => {
        const id = args.legacyFile as string;
        const before = (await (await raw('GET', `${DRIVE}/files/${id}?fields=name`)).json()) as {
          name: string;
        };
        const patch = async (name: string) => {
          const res = await raw('PATCH', `${DRIVE}/files/${id}?fields=name`, { name });
          assert(res.ok, `PATCH HTTP ${res.status}`);
        };
        await patch(`${before.name}~uji`);
        await patch(before.name);
      },
    );
  }

  // --- Bersih-bersih: hanya yang dibuat skrip ini ---
  await step('bersih-bersih: hapus permanen berkas uji, subfolder uji, dan sheet uji', async () => {
    for (const id of createdFiles) await client.deleteFile(id);
    // Subfolder uji: induknya adalah folder induk (bukan folder fungsi), jadi dihapus lewat panggilan mentah.
    const del = await raw('DELETE', `${DRIVE}/files/${testFolder}`);
    assert(del.status === 204 || del.status === 404, `hapus subfolder HTTP ${del.status}`);
    if (args.spreadsheet) {
      const meta = (await (
        await raw('GET', `${SHEETS}/${args.spreadsheet}?fields=sheets.properties(sheetId,title)`)
      ).json()) as {
        sheets?: Array<{ properties: { sheetId: number; title: string } }>;
      };
      const sheet = meta.sheets?.find((s) => s.properties.title === TEST_SHEET);
      if (sheet) {
        const res = await raw('POST', `${SHEETS}/${args.spreadsheet}:batchUpdate`, {
          requests: [{ deleteSheet: { sheetId: sheet.properties.sheetId } }],
        });
        assert(res.ok, `hapus sheet uji HTTP ${res.status}`);
      }
    }
  });

  const report = formatReport(results);
  console.log(`\n${report.text}`);
  return report.failed > 0 ? 1 : 0;
}

process.exit(await main());
