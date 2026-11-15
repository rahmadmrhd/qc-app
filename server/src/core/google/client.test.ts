import { afterEach, describe, expect, test } from 'bun:test';
import { viaBridge } from '@server/core/bridge-client';
import { bytesToBase64 } from '@server/core/bytes';
import { type AppError, isAppError } from '@server/core/errors';
import { FOLDER_MIME, type RecordedRequest } from '@server-test/fake-google';
import {
  BACKUP_ID,
  createGoogleRig,
  type GoogleRig,
  IMAGES_ID,
  OUTSIDE_ID,
  QR_DOC_ID,
  ROOT_ID,
} from '@server-test/google-rig';

let rig: GoogleRig;
afterEach(() => rig.restoreConsole());

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('diharapkan galat');
}

const BYTES = new TextEncoder().encode('Halo dunia');
const B64 = bytesToBase64(BYTES);
const isDriveCall = (r: RecordedRequest) => r.url.hostname === 'www.googleapis.com';
const driveRequests = () => rig.fake.requests.filter(isDriveCall);

function patternBytes(length: number) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + (i >> 8)) & 0xff;
  return out;
}

describe('dasar Drive: unggah, baca, info, folder', () => {
  test('createFile menaruh berkas di folder, readFile dan fileInfo mengembalikan isi dan ukuran', async () => {
    rig = await createGoogleRig();
    const { client, fake } = rig;
    const id = await client.createFile(IMAGES_ID, 'a.txt', 'text/plain', B64);
    expect(fake.files.get(id)).toMatchObject({
      parents: [IMAGES_ID],
      name: 'a.txt',
      mimeType: 'text/plain',
    });
    expect(await client.readFile(id, IMAGES_ID)).toEqual({ mime: 'text/plain', base64: B64 });
    expect(await client.fileInfo(id, IMAGES_ID)).toEqual({
      mime: 'text/plain',
      size: BYTES.length,
    });
    expect(await client.readFile('TIDAKADAXXXXXXXXX', IMAGES_ID)).toBeNull();
    // Setiap permintaan Drive membawa token Bearer.
    for (const request of driveRequests()) {
      expect(request.headers.get('authorization')).toMatch(/^Bearer ya29\./);
    }
  });

  test('createFolder SELALU membuat folder di bawah induk dan folder itu langsung dapat dipakai', async () => {
    rig = await createGoogleRig();
    const id = await rig.client.createFolder('Folder baru');
    expect(rig.fake.files.get(id)).toMatchObject({
      mimeType: FOLDER_MIME,
      parents: [ROOT_ID],
      name: 'Folder baru',
    });
    expect(await rig.client.folderExists(id)).toBe(true);
    const file = await rig.client.createFile(id, 'x.bin', 'application/octet-stream', B64);
    expect(rig.fake.files.get(file)?.parents).toEqual([id]);
  });

  test('createFolder tanpa folder induk terkonfigurasi ditolak; nama kosong = VALIDATION', async () => {
    rig = await createGoogleRig({ GOOGLE_ROOT_FOLDER_ID: '' });
    expect((await failure(rig.client.createFolder('x'))).code).toBe('UNAVAILABLE');
    expect(rig.fake.requests).toHaveLength(0);
    const ok = await createGoogleRig();
    expect((await failure(ok.client.createFolder('  '))).code).toBe('VALIDATION');
    ok.restoreConsole();
  });

  test('folderExists: ada, hilang, di tempat sampah, dan folder di luar induk yang tak dikonfigurasi ditolak', async () => {
    rig = await createGoogleRig();
    expect(await rig.client.folderExists(IMAGES_ID)).toBe(true);
    expect(await rig.client.folderExists('HILANGXXXXXXXXXX')).toBe(false);
    const trashed = rig.fake.addFolder('TRASHEDFOLDER001', [ROOT_ID]);
    trashed.trashed = true;
    expect(await rig.client.folderExists('TRASHEDFOLDER001')).toBe(false);
    expect((await failure(rig.client.folderExists(OUTSIDE_ID))).code).toBe('UNAVAILABLE');
    // Berkas biasa bukan folder.
    const file = await rig.client.createFile(IMAGES_ID, 'a', 'text/plain', B64);
    expect(await rig.client.folderExists(file)).toBe(false);
  });

  test('trashFile mengirim trashed:true; sukses bila berkas tak ada; fileInfo lalu null', async () => {
    rig = await createGoogleRig();
    const id = await rig.client.createFile(IMAGES_ID, 'a', 'text/plain', B64);
    await rig.client.trashFile(id);
    expect(rig.fake.files.get(id)?.trashed).toBe(true);
    expect(await rig.client.fileInfo(id, IMAGES_ID)).toBeNull();
    await rig.client.trashFile('HILANGXXXXXXXXXX');
  });

  test('renameFile, shareAnyoneWithLink, revokeSharing, replaceFileContent', async () => {
    rig = await createGoogleRig();
    const { client, fake } = rig;
    const id = await client.createFile(QR_DOC_ID, 'a.pdf', 'application/pdf', B64);
    await client.renameFile(id, 'baru.pdf');
    expect(fake.files.get(id)?.name).toBe('baru.pdf');
    await client.shareAnyoneWithLink(id);
    await client.shareAnyoneWithLink(id);
    expect(fake.files.get(id)?.permissions).toEqual([
      { id: 'anyoneWithLink', type: 'anyone', role: 'reader' },
    ]);
    await client.revokeSharing(id);
    expect(fake.files.get(id)?.permissions).toEqual([]);
    await client.revokeSharing(id);
    await client.replaceFileContent(
      id,
      'application/pdf',
      bytesToBase64(new TextEncoder().encode('ganti')),
    );
    expect(new TextDecoder().decode(fake.files.get(id)?.bytes)).toBe('ganti');
    expect(fake.files.get(id)?.id).toBe(id);
  });

  test('revokeSharing pada berkas di sampah sukses tanpa menghapus izin (Drive menolak ubah izin berkas sampah)', async () => {
    rig = await createGoogleRig();
    const { client, fake } = rig;
    const id = await client.createFile(QR_DOC_ID, 'a.pdf', 'application/pdf', B64);
    await client.shareAnyoneWithLink(id);
    await client.trashFile(id);
    await client.revokeSharing(id);
    expect(fake.files.get(id)?.permissions).toEqual([
      { id: 'anyoneWithLink', type: 'anyone', role: 'reader' },
    ]);
  });

  test('revokeSharing: 403 cannotDeletePermission = FORBIDDEN dengan pesan yang dapat ditindaklanjuti, tanpa log Google', async () => {
    rig = await createGoogleRig();
    const { client, fake } = rig;
    const id = await client.createFile(QR_DOC_ID, 'a.pdf', 'application/pdf', B64);
    await client.shareAnyoneWithLink(id);
    fake.intercept = (request) =>
      request.method === 'DELETE' && isDriveCall(request)
        ? new Response(
            JSON.stringify({
              error: { code: 403, errors: [{ reason: 'cannotDeletePermission' }] },
            }),
            {
              status: 403,
            },
          )
        : undefined;
    const error = await failure(client.revokeSharing(id));
    expect(error.code).toBe('FORBIDDEN');
    expect(error.message).toContain('Cabut manual di Google Drive');
    expect(rig.logs.join(' ')).not.toContain('cannotDeletePermission');
  });

  test('404 sesuai kontrak: baca/info null, trash/revoke sukses, rename/replace NOT_FOUND', async () => {
    rig = await createGoogleRig();
    const { client } = rig;
    const gone = 'HILANGXXXXXXXXXX';
    expect(await client.readFile(gone, IMAGES_ID)).toBeNull();
    expect(await client.fileInfo(gone, IMAGES_ID)).toBeNull();
    await client.trashFile(gone);
    await client.revokeSharing(gone);
    expect(await client.externalFileInfo(gone)).toBeNull();
    expect(await client.readExternalFile(gone)).toBeNull();
    expect((await failure(client.renameFile(gone, 'n'))).code).toBe('NOT_FOUND');
    expect((await failure(client.shareAnyoneWithLink(gone))).code).toBe('NOT_FOUND');
    expect((await failure(client.replaceFileContent(gone, 'a/b', B64))).code).toBe('NOT_FOUND');
  });
});

describe('penjaga folder (parents)', () => {
  test('berkas yang induknya folder lain = galat akses (ditolak), bukan null; folder tak diizinkan ditolak', async () => {
    rig = await createGoogleRig();
    const { client, fake } = rig;
    const id = await client.createFile(IMAGES_ID, 'a', 'text/plain', B64);
    const denied = await failure(client.readFile(id, BACKUP_ID));
    expect(denied.code).toBe('UNAVAILABLE');
    expect(denied.message).toContain('ditolak');
    expect((await failure(client.fileInfo(id, BACKUP_ID))).code).toBe('UNAVAILABLE');
    // Folder di luar induk dan di luar daftar.
    const uploadsBefore = fake.requests.filter((r) => r.url.pathname.startsWith('/upload')).length;
    fake.addFile('ORPHANFILE000001', { parents: [OUTSIDE_ID], bytes: BYTES });
    expect((await failure(client.readFile('ORPHANFILE000001', OUTSIDE_ID))).code).toBe(
      'UNAVAILABLE',
    );
    expect((await failure(client.createFile(OUTSIDE_ID, 'a', 'a/b', B64))).code).toBe(
      'UNAVAILABLE',
    );
    expect(fake.requests.filter((r) => r.url.pathname.startsWith('/upload'))).toHaveLength(
      uploadsBefore,
    );
    // Berkas yang diubah/dibuang harus berada di folder yang diizinkan.
    expect((await failure(client.trashFile('ORPHANFILE000001'))).code).toBe('UNAVAILABLE');
    expect((await failure(client.renameFile('ORPHANFILE000001', 'x'))).code).toBe('UNAVAILABLE');
    expect(fake.files.get('ORPHANFILE000001')?.trashed).toBe(false);
  });

  test('folder di luar induk yang tercantum di ALLOWED_FOLDER_IDS diizinkan', async () => {
    rig = await createGoogleRig({ ALLOWED_FOLDER_IDS: [OUTSIDE_ID] });
    const id = await rig.client.createFile(OUTSIDE_ID, 'a', 'text/plain', B64);
    expect(await rig.client.fileInfo(id, OUTSIDE_ID)).toEqual({
      mime: 'text/plain',
      size: BYTES.length,
    });
  });

  test('folder lama yang dipindah ke bawah induk (id tak berubah) otomatis diizinkan', async () => {
    rig = await createGoogleRig();
    rig.fake.addFolder('LEGACYFOLDER0001', [ROOT_ID]);
    rig.fake.addFile('LEGACYFILE000001', {
      parents: ['LEGACYFOLDER0001'],
      bytes: BYTES,
      mimeType: 'image/png',
    });
    expect(await rig.client.readFile('LEGACYFILE000001', 'LEGACYFOLDER0001')).toEqual({
      mime: 'image/png',
      base64: B64,
    });
  });
});

describe('aturan ulang dan token', () => {
  test('401: token diperbarui SEKALI lalu permintaan diulang', async () => {
    rig = await createGoogleRig();
    const id = await rig.client.createFile(IMAGES_ID, 'a', 'text/plain', B64);
    expect(rig.fake.tokenExchanges).toHaveLength(1);
    rig.fake.revokeTokens();
    expect(await rig.client.fileInfo(id, IMAGES_ID)).not.toBeNull();
    expect(rig.fake.tokenExchanges).toHaveLength(2);
  });

  test('401 kedua berturut-turut = UNAVAILABLE (tidak mengulang tanpa akhir)', async () => {
    rig = await createGoogleRig();
    rig.fake.intercept = (request) =>
      isDriveCall(request) ? new Response('{"error":{"code":401}}', { status: 401 }) : undefined;
    const error = await failure(rig.client.fileInfo('ABCDEFGHIJKLMN', IMAGES_ID));
    expect(error.code).toBe('UNAVAILABLE');
    expect(rig.fake.tokenExchanges).toHaveLength(2); // awal + satu pembaruan
    expect(driveRequests()).toHaveLength(2);
  });

  test('429/5xx dicoba ulang dengan jeda bertahap untuk operasi idempoten', async () => {
    rig = await createGoogleRig();
    const id = await rig.client.createFile(IMAGES_ID, 'a', 'text/plain', B64);
    let failures = 2;
    rig.fake.intercept = (request) => {
      if (!isDriveCall(request) || failures === 0) return undefined;
      failures -= 1;
      return new Response('{}', { status: failures === 1 ? 429 : 503 });
    };
    expect(await rig.client.fileInfo(id, IMAGES_ID)).not.toBeNull();
    expect(rig.sleeps).toHaveLength(2);
    expect(rig.sleeps[1]).toBeGreaterThan(rig.sleeps[0] as number);
  });

  test('403 rateLimitExceeded dicoba ulang; 403 lain = akses ditolak tanpa ulang', async () => {
    rig = await createGoogleRig();
    const id = await rig.client.createFile(IMAGES_ID, 'a', 'text/plain', B64);
    let n = 0;
    rig.fake.intercept = (request) => {
      if (!isDriveCall(request)) return undefined;
      n += 1;
      const reason = n === 1 ? 'userRateLimitExceeded' : 'forbidden';
      return new Response(JSON.stringify({ error: { code: 403, errors: [{ reason }] } }), {
        status: 403,
      });
    };
    expect((await failure(rig.client.fileInfo(id, IMAGES_ID))).code).toBe('UNAVAILABLE');
    expect(n).toBe(2); // satu ulang karena rate limit, lalu 403 `forbidden` final tanpa ulang
  });

  test('habis percobaan ulang = UNAVAILABLE dengan jumlah percobaan terbatas', async () => {
    rig = await createGoogleRig();
    rig.fake.intercept = (request) =>
      isDriveCall(request) ? new Response('{}', { status: 503 }) : undefined;
    const error = await failure(rig.client.fileInfo('ABCDEFGHIJKLMN', IMAGES_ID));
    expect(error.code).toBe('UNAVAILABLE');
    expect(driveRequests()).toHaveLength(4); // 1 + 3 ulang
    expect(rig.sleeps).toHaveLength(3);
  });

  test('galat jaringan pada operasi idempoten dicoba ulang', async () => {
    rig = await createGoogleRig();
    const id = await rig.client.createFile(IMAGES_ID, 'a', 'text/plain', B64);
    let thrown = false;
    rig.fake.intercept = (request) => {
      if (isDriveCall(request) && !thrown) {
        thrown = true;
        throw new TypeError('network down');
      }
      return undefined;
    };
    expect(await rig.client.fileInfo(id, IMAGES_ID)).not.toBeNull();
  });

  test('pembuatan berkas/folder dan salinan TIDAK diulang (503 maupun galat jaringan)', async () => {
    rig = await createGoogleRig();
    rig.fake.addFile('SOURCEFILE00001', { parents: [OUTSIDE_ID], bytes: BYTES });
    for (const attempt of [
      () => rig.client.createFile(IMAGES_ID, 'a', 'text/plain', B64),
      () =>
        rig.client.createFile(
          IMAGES_ID,
          'a',
          'text/plain',
          bytesToBase64(patternBytes(6 * 1024 * 1024)),
        ),
      () => rig.client.createFolder('x'),
      () => rig.client.copyFile('SOURCEFILE00001', IMAGES_ID, 'salinan'),
    ]) {
      for (const mode of ['503', 'network'] as const) {
        const before = driveRequests().length;
        rig.fake.intercept = (request) => {
          if (!isDriveCall(request) || request.url.pathname.includes('about')) return undefined;
          if (mode === 'network') throw new TypeError('network down');
          return new Response('{}', { status: 503 });
        };
        const error = await failure(attempt());
        expect(error.code).toBe('UNAVAILABLE');
        const made = driveRequests()
          .slice(before)
          .filter(
            (r) =>
              r.method === 'POST' &&
              (r.url.pathname.startsWith('/upload') ||
                r.url.pathname.endsWith('/files') ||
                r.url.pathname.endsWith('/copy')),
          );
        expect(made).toHaveLength(1);
        rig.fake.intercept = null;
      }
    }
  });
});

describe('berkas eksternal (resource key)', () => {
  test('X-Goog-Drive-Resource-Keys dikirim untuk info, baca, dan salin; tanpa kunci berkas tak terlihat', async () => {
    rig = await createGoogleRig();
    const { client, fake } = rig;
    fake.addFile('EXTERNALFILE0001', {
      name: 'sumber.pdf',
      mimeType: 'application/pdf',
      parents: [OUTSIDE_ID],
      bytes: BYTES,
      resourceKey: '0-AbCdEf',
      ownedByMe: false,
    });
    expect(await client.externalFileInfo('EXTERNALFILE0001')).toBeNull();
    expect(await client.externalFileInfo('EXTERNALFILE0001', '0-AbCdEf')).toEqual({
      name: 'sumber.pdf',
      mime: 'application/pdf',
      size: BYTES.length,
    });
    expect(await client.readExternalFile('EXTERNALFILE0001', '0-AbCdEf')).toEqual({
      mime: 'application/pdf',
      base64: B64,
    });
    const copy = await client.copyFile('EXTERNALFILE0001', QR_DOC_ID, 'salinan.pdf', '0-AbCdEf');
    expect(fake.files.get(copy)).toMatchObject({ name: 'salinan.pdf', parents: [QR_DOC_ID] });
    const withHeader = driveRequests().filter((r) => r.headers.get('x-goog-drive-resource-keys'));
    expect(withHeader.length).toBeGreaterThanOrEqual(3);
    for (const request of withHeader) {
      expect(request.headers.get('x-goog-drive-resource-keys')).toBe('EXTERNALFILE0001/0-AbCdEf');
    }
    // Tanpa resourceKey, tak ada header sama sekali.
    fake.addFile('PLAINEXTERNAL001', { parents: [OUTSIDE_ID], bytes: BYTES, ownedByMe: false });
    const before = driveRequests().length;
    await client.externalFileInfo('PLAINEXTERNAL001');
    expect(driveRequests()[before]?.headers.get('x-goog-drive-resource-keys')).toBeNull();
  });

  test('berkas eksternal yang tidak dibagikan ke service account (403 non-rate-limit) = null', async () => {
    rig = await createGoogleRig();
    rig.fake.intercept = (request) =>
      request.url.pathname.includes('/files/') && request.url.pathname.includes('NOACCESSFILE0001')
        ? new Response(
            JSON.stringify({ error: { code: 403, errors: [{ reason: 'forbidden' }] } }),
            { status: 403 },
          )
        : undefined;
    expect(await rig.client.externalFileInfo('NOACCESSFILE0001')).toBeNull();
    expect(await rig.client.readExternalFile('NOACCESSFILE0001')).toBeNull();
  });

  test('copyFile ke folder yang tak diizinkan ditolak sebelum menyentuh Drive', async () => {
    rig = await createGoogleRig();
    expect((await failure(rig.client.copyFile('SOURCEFILE00001', OUTSIDE_ID, 'x'))).code).toBe(
      'UNAVAILABLE',
    );
    expect(driveRequests().some((r) => r.url.pathname.endsWith('/copy'))).toBe(false);
  });
});

describe('unggah resumable dan berkas besar', () => {
  test('9 MB lolos utuh lewat sesi resumable (byte masuk = byte keluar), potongan kelipatan 256 KiB', async () => {
    rig = await createGoogleRig();
    const bytes = patternBytes(9 * 1024 * 1024);
    const id = await rig.client.createFile(
      BACKUP_ID,
      'besar.bin',
      'application/octet-stream',
      bytesToBase64(bytes),
    );
    expect(rig.fake.files.get(id)?.bytes).toEqual(bytes);
    const puts = rig.fake.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.headers.get('content-range'))).toEqual([
      `bytes 0-${8 * 1024 * 1024 - 1}/${bytes.length}`,
      `bytes ${8 * 1024 * 1024}-${bytes.length - 1}/${bytes.length}`,
    ]);
    const init = rig.fake.requests.find(
      (r) => r.url.searchParams.get('uploadType') === 'resumable',
    );
    expect(init?.headers.get('x-upload-content-length')).toBe(String(bytes.length));
    expect(JSON.parse(init?.text ?? '{}')).toMatchObject({
      name: 'besar.bin',
      parents: [BACKUP_ID],
    });
    const read = await rig.client.readFile(id, BACKUP_ID);
    expect(read?.base64).toBe(bytesToBase64(bytes));
  });

  test('berkas kecil memakai satu permintaan multipart (tanpa sesi resumable)', async () => {
    rig = await createGoogleRig();
    await rig.client.createFile(IMAGES_ID, 'kecil.txt', 'text/plain', B64);
    const uploads = rig.fake.requests.filter((r) => r.url.pathname.startsWith('/upload'));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.url.searchParams.get('uploadType')).toBe('multipart');
    expect(uploads[0]?.headers.get('content-type')).toMatch(/^multipart\/related; boundary=/);
  });

  test('replaceFileContent besar memakai resumable PATCH dan mempertahankan id', async () => {
    rig = await createGoogleRig();
    const id = await rig.client.createFile(QR_DOC_ID, 'a.pdf', 'application/pdf', B64);
    const bytes = patternBytes(7 * 1024 * 1024);
    await rig.client.replaceFileContent(id, 'application/pdf', bytesToBase64(bytes));
    expect(rig.fake.files.get(id)?.bytes).toEqual(bytes);
    const init = rig.fake.requests.find(
      (r) => r.url.searchParams.get('uploadType') === 'resumable',
    );
    expect(init?.method).toBe('PATCH');
  });

  test('uploadFile menerima Blob, mengembalikan id/ukuran/md5, dan menulis appProperties', async () => {
    rig = await createGoogleRig();
    const bytes = patternBytes(9 * 1024 * 1024);
    const result = await rig.client.uploadFile(
      BACKUP_ID,
      'qc-backup.sql.gz',
      'application/gzip',
      new Blob([bytes]),
      {
        appProperties: { sha256: 'abc123' },
      },
    );
    expect(result.size).toBe(bytes.length);
    expect(result.md5Checksum).toMatch(/^[0-9a-f]{32}$/);
    expect(rig.fake.files.get(result.id)?.appProperties).toEqual({ sha256: 'abc123' });
    expect(rig.fake.files.get(result.id)?.bytes).toEqual(bytes);
    const small = await rig.client.uploadFile(
      BACKUP_ID,
      'k.bin',
      'application/octet-stream',
      BYTES,
    );
    expect(small.size).toBe(BYTES.length);
  });

  test('sesi resumable dengan Location di luar googleapis.com ditolak (tanpa mengirim isi ke sana)', async () => {
    rig = await createGoogleRig();
    rig.fake.intercept = (request) =>
      request.url.searchParams.get('uploadType') === 'resumable'
        ? new Response('', {
            status: 200,
            headers: { location: 'https://evil.example/upload?id=1' },
          })
        : undefined;
    const bytes = patternBytes(6 * 1024 * 1024);
    const error = await failure(rig.client.createFile(IMAGES_ID, 'a', 'a/b', bytesToBase64(bytes)));
    expect(error.code).toBe('UNAVAILABLE');
    expect(rig.fake.requests.some((r) => r.url.hostname === 'evil.example')).toBe(false);
  });

  test('base64 rusak dan MIME berbahaya ditolak sebelum dikirim', async () => {
    rig = await createGoogleRig();
    expect((await failure(rig.client.createFile(IMAGES_ID, 'a', 'a/b', 'AB"CD'))).code).toBe(
      'VALIDATION',
    );
    expect((await failure(rig.client.createFile(IMAGES_ID, 'a', 'a/b\r\nX: y', B64))).code).toBe(
      'VALIDATION',
    );
    expect((await failure(rig.client.createFile(IMAGES_ID, '', 'a/b', B64))).code).toBe(
      'VALIDATION',
    );
    expect(driveRequests()).toHaveLength(0);
  });
});

describe('id Drive di jalur URL (path traversal / SSRF)', () => {
  const hostile = [
    '../../about',
    '..%2F..%2Fabout',
    'abc?alt=media',
    'abc#frag',
    'abcdefghij/permissions',
    'x',
    'a'.repeat(101),
    'abc def',
    'ABCDEFGHIJ\n',
  ];

  test('id berbahaya tidak pernah sampai ke jalur URL: pencarian = null, mutasi = tidak ada/NOT_FOUND', async () => {
    rig = await createGoogleRig();
    const { client } = rig;
    for (const id of hostile) {
      expect(await client.readFile(id, IMAGES_ID)).toBeNull();
      expect(await client.fileInfo(id, IMAGES_ID)).toBeNull();
      expect(await client.externalFileInfo(id)).toBeNull();
      expect(await client.readExternalFile(id)).toBeNull();
      expect(await client.downloadFile(id, IMAGES_ID)).toBeNull();
      await client.trashFile(id);
      await client.revokeSharing(id);
      await client.deleteFile(id);
      expect((await failure(client.renameFile(id, 'n'))).code).toBe('NOT_FOUND');
      expect((await failure(client.shareAnyoneWithLink(id))).code).toBe('NOT_FOUND');
      expect((await failure(client.replaceFileContent(id, 'a/b', B64))).code).toBe('NOT_FOUND');
      expect((await failure(client.copyFile(id, IMAGES_ID, 'n'))).code).toBe('NOT_FOUND');
      expect(await client.folderExists(id)).toBe(false);
    }
    expect(rig.fake.requests).toHaveLength(0);
  });

  test('resourceKey dan folderId berbahaya ditolak/tidak dikirim', async () => {
    rig = await createGoogleRig();
    expect(await rig.client.externalFileInfo('ABCDEFGHIJKLMN', 'kunci\r\nX-Evil: 1')).toBeNull();
    expect((await failure(rig.client.readFile('ABCDEFGHIJKLMN', '../x'))).code).toBe('UNAVAILABLE');
    expect((await failure(rig.client.listFolder(`${IMAGES_ID}' or '1'='1`))).code).toBe(
      'UNAVAILABLE',
    );
    expect(rig.fake.requests).toHaveLength(0);
  });

  test('id sah (huruf, angka, _ dan -) tetap lolos dan di-encode', async () => {
    rig = await createGoogleRig();
    rig.fake.addFile('1aB-_cD3eF4gH5iJ6kL7mN8oP9qR0sT1', { parents: [IMAGES_ID], bytes: BYTES });
    expect(await rig.client.fileInfo('1aB-_cD3eF4gH5iJ6kL7mN8oP9qR0sT1', IMAGES_ID)).not.toBeNull();
  });
});

describe('metode tambahan untuk cadangan', () => {
  test('listFolder berhalaman: nextPageToken diteruskan; hanya berkas folder itu yang tidak di sampah', async () => {
    rig = await createGoogleRig();
    for (const n of [1, 2, 3, 4, 5]) {
      rig.fake.addFile(`BKP${n}FILEXXXXXXXXX`, {
        name: `qc-backup-2026110${n}-0200.sql.gz`,
        parents: [BACKUP_ID],
        bytes: BYTES,
        appProperties: { sha256: `h${n}` },
      });
    }
    const first = await rig.client.listFolder(BACKUP_ID, { pageSize: 3 });
    expect(first.files).toHaveLength(3);
    expect(first.nextPageToken).toBeDefined();
    expect(first.files[0]).toMatchObject({
      name: 'qc-backup-20261101-0200.sql.gz',
      size: BYTES.length,
      appProperties: { sha256: 'h1' },
    });
    expect(first.files[0]?.md5Checksum).toMatch(/^[0-9a-f]{32}$/);
    const second = await rig.client.listFolder(BACKUP_ID, {
      pageSize: 3,
      pageToken: first.nextPageToken,
    });
    expect(second.files).toHaveLength(2);
    expect(second.nextPageToken).toBeUndefined();
    expect((await failure(rig.client.listFolder(OUTSIDE_ID))).code).toBe('UNAVAILABLE');
  });

  test('listFolder dengan name: hanya berkas bernama persis itu; tanda kutip dan garis miring di-escape', async () => {
    rig = await createGoogleRig();
    rig.fake.addFile('NAMEFILE0000001A', {
      name: 'proof-a.webp',
      parents: [BACKUP_ID],
      bytes: BYTES,
    });
    rig.fake.addFile('NAMEFILE0000002B', {
      name: 'proof-b.webp',
      parents: [BACKUP_ID],
      bytes: BYTES,
    });
    rig.fake.addFile('NAMEFILE0000003C', { name: "o'neil\\x", parents: [BACKUP_ID], bytes: BYTES });
    const one = await rig.client.listFolder(BACKUP_ID, { name: 'proof-b.webp' });
    expect(one.files.map((file) => file.name)).toEqual(['proof-b.webp']);
    expect((await rig.client.listFolder(BACKUP_ID, { name: 'proof-zzz.webp' })).files).toEqual([]);
    const odd = await rig.client.listFolder(BACKUP_ID, { name: "o'neil\\x" });
    expect(odd.files.map((file) => file.name)).toEqual(["o'neil\\x"]);
  });

  test('downloadFile mengalirkan isi (alt=media) dengan pemeriksaan induk; null bila tak ada', async () => {
    rig = await createGoogleRig();
    const bytes = patternBytes(300_000);
    rig.fake.addFile('STREAMFILE000001', {
      parents: [BACKUP_ID],
      bytes,
      mimeType: 'application/gzip',
    });
    const download = await rig.client.downloadFile('STREAMFILE000001', BACKUP_ID);
    expect(download?.mime).toBe('application/gzip');
    expect(download?.size).toBe(bytes.length);
    expect(
      new Uint8Array(await new Response(download?.body as unknown as ReadableStream).arrayBuffer()),
    ).toEqual(bytes);
    expect(await rig.client.downloadFile('HILANGXXXXXXXXXX', BACKUP_ID)).toBeNull();
    expect((await failure(rig.client.downloadFile('STREAMFILE000001', IMAGES_ID))).code).toBe(
      'UNAVAILABLE',
    );
  });

  test('deleteFile menghapus permanen hanya berkas milik service account di folder yang diizinkan', async () => {
    rig = await createGoogleRig();
    rig.fake.addFile('OWNEDFILE0000001', { parents: [BACKUP_ID], bytes: BYTES });
    rig.fake.addFile('FOREIGNFILE000001', { parents: [BACKUP_ID], bytes: BYTES, ownedByMe: false });
    rig.fake.addFile('OUTSIDEFILE000001', { parents: [OUTSIDE_ID], bytes: BYTES });
    await rig.client.deleteFile('OWNEDFILE0000001');
    expect(rig.fake.files.has('OWNEDFILE0000001')).toBe(false);
    await rig.client.deleteFile('OWNEDFILE0000001'); // sudah hilang: sukses
    expect((await failure(rig.client.deleteFile('FOREIGNFILE000001'))).code).toBe('UNAVAILABLE');
    expect((await failure(rig.client.deleteFile('OUTSIDEFILE000001'))).code).toBe('UNAVAILABLE');
    expect(rig.fake.files.has('FOREIGNFILE000001')).toBe(true);
    expect(rig.fake.files.has('OUTSIDEFILE000001')).toBe(true);
  });

  test('storageQuota melaporkan batas dan pemakaian; tanpa limit = null (tak terbatas)', async () => {
    rig = await createGoogleRig();
    expect(await rig.client.storageQuota()).toEqual({ limit: 16106127360, usage: 46137344 });
    delete rig.fake.quota.limit;
    expect(await rig.client.storageQuota()).toEqual({ limit: null, usage: 46137344 });
  });
});

describe('konfigurasi dan kerahasiaan', () => {
  test('tanpa GOOGLE_SA_KEY_FILE: setiap operasi = UNAVAILABLE jelas tanpa permintaan jaringan', async () => {
    rig = await createGoogleRig({ GOOGLE_SA_KEY_FILE: '' });
    const error = await failure(rig.client.createFile(IMAGES_ID, 'a', 'a/b', B64));
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toContain('belum dikonfigurasi');
    expect(rig.fake.requests).toHaveLength(0);
  });

  test('galat Drive tidak membocorkan token/kunci di pesan galat maupun console (sentinel)', async () => {
    rig = await createGoogleRig();
    const id = await rig.client.createFile(IMAGES_ID, 'a', 'text/plain', B64);
    const token = rig.fake.requests.find(isDriveCall)?.headers.get('authorization') ?? '';
    expect(token).toContain('ya29.');
    rig.fake.intercept = (request) =>
      isDriveCall(request)
        ? new Response(
            JSON.stringify({
              error: {
                code: 500,
                message: `${request.headers.get('authorization')} PRIVATE KEY SENTINEL-9`,
              },
            }),
            { status: 500 },
          )
        : undefined;
    const errors: AppError[] = [];
    errors.push(await failure(rig.client.fileInfo(id, IMAGES_ID)));
    errors.push(await failure(rig.client.createFile(IMAGES_ID, 'b', 'text/plain', B64)));
    errors.push(await failure(rig.client.storageQuota()));
    const everything = [...errors.flatMap((e) => [e.message, e.stack ?? '']), ...rig.logs].join(
      '\n',
    );
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(token.replace('Bearer ', ''));
    expect(everything).not.toContain('SENTINEL-9');
    expect(everything).not.toContain('PRIVATE KEY');
    expect(everything).not.toContain(rig.privateKeyPem.split('\n')[1] as string);
  });
});

describe('pemetaan galat HTTP ke kode aplikasi (kontrak jembatan lama)', () => {
  const FILE_ID = 'FILEIDXXXXXXXXXXX1';

  /** Klien dengan `fetch` yang menimpa permintaan ke Drive; penukaran token tetap ke server Google palsu. */
  async function clientWithDrive(drive: (init?: RequestInit) => Promise<Response>) {
    rig = await createGoogleRig();
    const real = rig.fake.fetch;
    const stub = ((url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      new URL(String(url)).hostname === 'www.googleapis.com'
        ? drive(init)
        : real(url, init)) as typeof fetch;
    return rig.make({}, { fetch: stub });
  }

  test('TimeoutError -> UNAVAILABLE yang menyebut batas waktu', async () => {
    const client = await clientWithDrive(async () => {
      throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    });
    const error = await failure(client.fileInfo(FILE_ID, IMAGES_ID));
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toContain('batas waktu');
  });

  test('HTTP 400 berbadan galat Google -> VALIDATION (badan tidak ikut ke pesan)', async () => {
    const client = await clientWithDrive(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 400, message: 'RAHASIA-DETAIL', errors: [{ reason: 'invalid' }] },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    );
    const error = await failure(client.fileInfo(FILE_ID, IMAGES_ID));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).not.toContain('RAHASIA-DETAIL');
  });

  test('HTTP 200 berbadan HTML pada fileInfo lewat viaBridge -> UNAVAILABLE', async () => {
    const client = await clientWithDrive(
      async () => new Response('<html>Error 411</html>', { status: 200 }),
    );
    const error = await failure(viaBridge(() => client.fileInfo(FILE_ID, IMAGES_ID)));
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toContain('tidak dapat dihubungi');
  });
});
