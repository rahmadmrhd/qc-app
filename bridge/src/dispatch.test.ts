import { beforeEach, expect, test } from 'bun:test';
import {
  createMemoryBridgePlatform,
  type MemoryBridgePlatform,
  signForTest,
  TEST_BRIDGE_SECRET,
} from '@bridge-test/memory-platform';
import {
  BRIDGE_FAIL_LIMIT,
  BRIDGE_MAX_BODY_CHARS,
  BRIDGE_TS_WINDOW_MS,
  bridgeConstantTimeEqual_,
  verifyBridgeRequest_,
} from './auth';
import { bridgeActions_, handleBridge_ } from './dispatch';
import { setBridgePlatform_ } from './platform';

const DENIED = { ok: false, error: 'UNAUTHENTICATED' };
let platform: MemoryBridgePlatform;

function envelope(
  action: string,
  payload: unknown,
  overrides: { ts?: number; sig?: string; secret?: string } = {},
): string {
  const ts = overrides.ts ?? platform.now();
  const sig = overrides.sig ?? signForTest(action, ts, payload, overrides.secret);
  return JSON.stringify({ action, ts, sig, payload });
}

function call(action: string, payload: unknown, overrides = {}): Record<string, unknown> {
  platform.setNow(platform.now() + 1);
  return JSON.parse(handleBridge_(envelope(action, payload, overrides)));
}

beforeEach(() => {
  platform = createMemoryBridgePlatform({
    properties: { ALLOWED_FOLDER_IDS: 'F1,F2', SPREADSHEET_ID: 'SS' },
  });
  setBridgePlatform_(platform);
  platform.addFolder('F1');
  platform.addFolder('F2');
  platform.addFile('f1', { parents: ['F1'], base64: 'QUJD', mime: 'text/plain' });
  platform.addFile('x1', { parents: ['OUTSIDE'], base64: 'QUJD' });
  platform.effects.length = 0;
});

test('permintaan sah ke aksi Drive berhasil dan mengembalikan data', () => {
  const created = call('drive.createFile', {
    folderId: 'F1',
    name: 'a.txt',
    mime: 'text/plain',
    base64: 'SGFsbw==',
  }) as { ok: true; data: { id: string } };
  expect(created.ok).toBe(true);
  expect(platform.files.get(created.data.id)?.parents).toEqual(['F1']);
  expect(call('drive.readFile', { fileId: created.data.id, folderId: 'F1' })).toEqual({
    ok: true,
    data: { mime: 'text/plain', base64: 'SGFsbw==' },
  });
});

test('Review Focus 4: semua penolakan keamanan berbalasan identik dan tanpa efek Drive', () => {
  const ts = platform.now();
  const goodPayload = { fileId: 'f1' };
  const cases: Array<[string, string]> = [
    ['tanda tangan salah', envelope('drive.trashFile', goodPayload, { sig: 'a'.repeat(64) })],
    ['rahasia lain', envelope('drive.trashFile', goodPayload, { secret: 'lain'.repeat(10) })],
    [
      'ts lama (> 2 menit)',
      envelope('drive.trashFile', goodPayload, { ts: ts - BRIDGE_TS_WINDOW_MS - 1 }),
    ],
    [
      'ts masa depan',
      envelope('drive.trashFile', goodPayload, { ts: ts + BRIDGE_TS_WINDOW_MS + 1 }),
    ],
    ['aksi di luar allowlist', envelope('drive.deleteForever', goodPayload)],
    ['aksi prototipe', envelope('constructor', goodPayload)],
    [
      'badan terlalu besar',
      envelope('drive.createFile', { base64: 'A'.repeat(BRIDGE_MAX_BODY_CHARS) }),
    ],
    ['bukan JSON', 'bukan json'],
    ['badan kosong', ''],
    [
      'payload diubah setelah ditandatangani',
      JSON.stringify({
        action: 'drive.trashFile',
        ts,
        sig: signForTest('drive.trashFile', ts, { fileId: 'f1' }),
        payload: { fileId: 'x1' },
      }),
    ],
    ['folder tidak terdaftar', envelope('drive.readFile', { fileId: 'f1', folderId: 'LAIN' })],
    ['folderId bukan induk berkas', envelope('drive.readFile', { fileId: 'f1', folderId: 'F2' })],
    ['berkas di luar folder terdaftar (trash)', envelope('drive.trashFile', { fileId: 'x1' })],
    [
      'berkas di luar folder terdaftar (rename)',
      envelope('drive.renameFile', { fileId: 'x1', name: 'n' }),
    ],
    [
      'berkas di luar folder terdaftar (share)',
      envelope('drive.shareAnyoneWithLink', { fileId: 'x1' }),
    ],
    [
      'berkas di luar folder terdaftar (replace)',
      envelope('drive.replaceFileContent', { fileId: 'x1', mime: 'a/b', base64: 'QUJD' }),
    ],
    [
      'buat berkas di folder tidak terdaftar',
      envelope('drive.createFile', { folderId: 'OUTSIDE', name: 'a', mime: 'a/b', base64: 'QUJD' }),
    ],
    [
      'salin ke folder tidak terdaftar',
      envelope('drive.copyFile', { fileId: 'f1', folderId: 'OUTSIDE', name: 'a' }),
    ],
  ];
  for (const [label, body] of cases) {
    const reply = JSON.parse(handleBridge_(body));
    expect({ label, reply }).toEqual({ label, reply: DENIED });
  }
  expect(platform.effects).toEqual([]);
  expect(platform.files.get('f1')?.trashed).toBe(false);
  expect(platform.files.get('x1')?.trashed).toBe(false);
});

test('permintaan yang diulang (tanda tangan sama) ditolak', () => {
  const body = envelope('drive.folderExists', { folderId: 'F1' });
  expect(JSON.parse(handleBridge_(body))).toEqual({ ok: true, data: { exists: true } });
  expect(JSON.parse(handleBridge_(body))).toEqual(DENIED);
});

test('pembatas: kegagalan beruntun memblokir sementara, termasuk permintaan sah', () => {
  for (let i = 0; i < BRIDGE_FAIL_LIMIT; i++) {
    expect(call('drive.folderExists', { folderId: 'F1' }, { sig: 'b'.repeat(64) })).toEqual(DENIED);
  }
  expect(call('drive.folderExists', { folderId: 'F1' })).toEqual(DENIED);
  expect(platform.effects).toEqual([]);
});

test('penolakan folder/aksi setelah tanda tangan sah tidak dihitung sebagai percobaan salah', () => {
  for (let i = 0; i < BRIDGE_FAIL_LIMIT + 2; i++) {
    expect(call('drive.readFile', { fileId: 'f1', folderId: 'F2' })).toEqual(DENIED);
  }
  platform.setNow(platform.now() + 1);
  expect(call('drive.folderExists', { folderId: 'F1' })).toEqual({
    ok: true,
    data: { exists: true },
  });
});

test('rahasia kosong atau pendek menolak semuanya', () => {
  platform.properties.set('BRIDGE_SECRET', 'pendek');
  expect(call('drive.folderExists', { folderId: 'F1' }, { secret: 'pendek' })).toEqual(DENIED);
  platform.properties.delete('BRIDGE_SECRET');
  expect(call('drive.folderExists', { folderId: 'F1' })).toEqual(DENIED);
});

test('verifyBridgeRequest_ menerima tanda tangan sah dan batas jendela tepat', () => {
  const ts = platform.now();
  const ok = (offset: number) =>
    verifyBridgeRequest_(
      envelope('drive.folderExists', { folderId: 'F1' }, { ts: ts + offset }),
      TEST_BRIDGE_SECRET,
      ts,
    ).ok;
  expect(ok(0)).toBe(true);
  expect(ok(BRIDGE_TS_WINDOW_MS)).toBe(true);
  expect(ok(-BRIDGE_TS_WINDOW_MS)).toBe(true);
  expect(ok(BRIDGE_TS_WINDOW_MS + 1)).toBe(false);
});

test('bridgeConstantTimeEqual_', () => {
  expect(bridgeConstantTimeEqual_('abc', 'abc')).toBe(true);
  expect(bridgeConstantTimeEqual_('abc', 'abd')).toBe(false);
  expect(bridgeConstantTimeEqual_('abc', 'abcd')).toBe(false);
  expect(bridgeConstantTimeEqual_('', '')).toBe(true);
});

test('allowlist persis 13 aksi Drive + 2 aksi Sheets (Spek 8.1)', () => {
  expect(Object.keys(bridgeActions_()).sort()).toEqual(
    [
      'drive.createFolder',
      'drive.createFile',
      'drive.readFile',
      'drive.fileInfo',
      'drive.folderExists',
      'drive.trashFile',
      'drive.externalFileInfo',
      'drive.readExternalFile',
      'drive.copyFile',
      'drive.renameFile',
      'drive.shareAnyoneWithLink',
      'drive.revokeSharing',
      'drive.replaceFileContent',
      'sheets.dump',
      'sheets.export',
    ].sort(),
  );
});

test('validasi payload setelah autentikasi: VALIDATION dengan pesan, bukan penolakan keamanan', () => {
  const reply = call('drive.createFile', {
    folderId: 'F1',
    name: 'a',
    mime: 'a/b',
    base64: 'bukan base64!',
  });
  expect(reply.ok).toBe(false);
  expect(reply.error).toBe('VALIDATION');
  expect(call('drive.folderExists', { folderId: 123 }).error).toBe('VALIDATION');
});

test('galat tak terduga dari Drive menjadi INTERNAL tanpa bocor detail, dicatat di log', () => {
  platform.driveCopyFile = () => {
    throw new Error('rahasia stack');
  };
  const reply = call('drive.copyFile', { fileId: 'f1', folderId: 'F1', name: 'n' });
  expect(reply.error).toBe('INTERNAL');
  expect(JSON.stringify(reply)).not.toContain('rahasia');
  expect(platform.errors.join('\n')).toContain('rahasia stack');
});

test('aksi Drive: fileInfo, folderExists, trash, rename, share, revoke, replace, copy, external', () => {
  expect(call('drive.fileInfo', { fileId: 'f1', folderId: 'F1' })).toEqual({
    ok: true,
    data: { mime: 'text/plain', size: 3 },
  });
  expect(call('drive.fileInfo', { fileId: 'tidak-ada', folderId: 'F1' })).toEqual({
    ok: true,
    data: null,
  });
  expect(call('drive.readFile', { fileId: 'tidak-ada', folderId: 'F1' })).toEqual({
    ok: true,
    data: null,
  });
  expect(call('drive.folderExists', { folderId: 'F2' })).toEqual({
    ok: true,
    data: { exists: true },
  });
  platform.folders.get('F2')!.trashed = true;
  expect(call('drive.folderExists', { folderId: 'F2' })).toEqual({
    ok: true,
    data: { exists: false },
  });

  expect(call('drive.renameFile', { fileId: 'f1', name: 'baru' }).ok).toBe(true);
  expect(platform.files.get('f1')?.name).toBe('baru');
  expect(call('drive.shareAnyoneWithLink', { fileId: 'f1' }).ok).toBe(true);
  expect(platform.files.get('f1')?.shared).toBe(true);
  expect(call('drive.revokeSharing', { fileId: 'f1' }).ok).toBe(true);
  expect(platform.files.get('f1')?.shared).toBe(false);
  // Sukses bila berkas tidak ada (revoke/trash), galat NOT_FOUND untuk rename/share/replace.
  expect(call('drive.revokeSharing', { fileId: 'hilang' })).toEqual({ ok: true, data: null });
  expect(call('drive.trashFile', { fileId: 'hilang' })).toEqual({ ok: true, data: null });
  expect(call('drive.renameFile', { fileId: 'hilang', name: 'n' }).error).toBe('NOT_FOUND');
  expect(
    call('drive.replaceFileContent', { fileId: 'f1', mime: 'text/x', base64: 'WFlaMQ==' }).ok,
  ).toBe(true);
  expect(platform.files.get('f1')?.base64).toBe('WFlaMQ==');

  platform.external.set('ext1', { name: 'sumber.pdf', mime: 'application/pdf', base64: 'UERG' });
  expect(call('drive.externalFileInfo', { fileId: 'ext1' })).toEqual({
    ok: true,
    data: { name: 'sumber.pdf', mime: 'application/pdf', size: 3 },
  });
  expect(call('drive.readExternalFile', { fileId: 'ext1' })).toEqual({
    ok: true,
    data: { mime: 'application/pdf', base64: 'UERG' },
  });
  expect(call('drive.externalFileInfo', { fileId: 'nope' })).toEqual({ ok: true, data: null });
  const copied = call('drive.copyFile', {
    fileId: 'ext1',
    folderId: 'F1',
    name: 'salinan.pdf',
  }) as {
    data: { id: string };
  };
  expect(platform.files.get(copied.data.id)?.parents).toEqual(['F1']);

  expect(call('drive.trashFile', { fileId: 'f1' }).ok).toBe(true);
  expect(platform.files.get('f1')?.trashed).toBe(true);
  expect(call('drive.fileInfo', { fileId: 'f1', folderId: 'F1' })).toEqual({
    ok: true,
    data: null,
  });
  expect(call('drive.createFolder', { name: 'Baru' }).ok).toBe(true);
});

test('unggah 1 MB base64 lolos batas badan (spike Task 0.2)', () => {
  const base64 = 'QUJD'.repeat(240000); // 960.000 karakter
  const reply = call('drive.createFile', {
    folderId: 'F1',
    name: 'besar.bin',
    mime: 'a/b',
    base64,
  });
  expect(reply.ok).toBe(true);
});

test('setup: laporan status tanpa membocorkan rahasia', async () => {
  const { runBridgeSetup_ } = await import('./setup');
  platform.addFolder('F1');
  platform.folders.get('F1')!.trashed = false;
  const report = runBridgeSetup_();
  expect(report).toContain('BRIDGE_SECRET: terisi');
  expect(report).toContain('ALLOWED_FOLDER_IDS F1: ok');
  expect(report).toContain('ALLOWED_FOLDER_IDS F2: ok');
  expect(report).not.toContain(TEST_BRIDGE_SECRET);
  platform.properties.set('BRIDGE_SECRET', 'pendek');
  platform.properties.delete('SPREADSHEET_ID');
  platform.properties.set('ALLOWED_FOLDER_IDS', 'HILANG');
  const bad = runBridgeSetup_();
  expect(bad).toContain('BELUM SAH');
  expect(bad).toContain('HILANG: TIDAK TERAKSES');
  expect(bad).toContain('SPREADSHEET_ID: KOSONG');
});
