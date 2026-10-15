import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listFiles_ } from '@gas/modules/files/repo';
import { ensureDriveFolder_ } from '@gas/modules/files/service';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { probeDriveIds_, registerDriveFiles_ } from './files';
import { handleSync_ } from './handler';
import { getSyncRoutes_ } from './routes';

const TOKEN = 't0k3n'.repeat(8);
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
let platform: MemoryPlatform;
let folder: string;

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', SYNC_API_TOKEN: TOKEN },
  });
  setPlatform_(platform);
  folder = ensureDriveFolder_();
});

const call = (payload: unknown) =>
  handleSync_(
    JSON.stringify({ v: 1, method: 'sync.file.get', token: TOKEN, payload }),
    getSyncRoutes_(),
  );

test('sync.file.get mengembalikan isi berkas di folder aplikasi', () => {
  const driveId = platform.driveCreateFile(folder, 'a.png', 'image/png', PNG);
  expect(call({ driveId })).toEqual({
    ok: true,
    data: { driveId, mime: 'image/png', base64: PNG },
  });
});

test('sync.file.get: id di luar folder, tak dikenal, atau tanpa DRIVE_FOLDER_ID → NOT_FOUND', () => {
  const other = platform.driveCreateFolder('Lain');
  const outside = platform.driveCreateFile(other, 'b.png', 'image/png', PNG);
  expect(call({ driveId: outside })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(call({ driveId: 'tidak-ada' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  platform.properties.delete('DRIVE_FOLDER_ID');
  const inside = platform.driveCreateFile(folder, 'c.png', 'image/png', PNG);
  expect(call({ driveId: inside })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});

test('sync.file.get: payload tidak sah → VALIDATION; berkas > 8 MB → VALIDATION', () => {
  expect(call({})).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION', fields: { driveId: 'Wajib diisi' } },
  });
  expect(call(null)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  const big = platform.driveCreateFile(folder, 'big.png', 'image/png', 'A'.repeat(11_000_000));
  expect(call({ driveId: big })).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION', fields: { driveId: 'Berkas melebihi 8 MB' } },
  });
});

test('registerDriveFiles_: berkas di folder didaftarkan sekali; id tak sah dilaporkan missing; idempoten', () => {
  const good = platform.driveCreateFile(folder, 'a.png', 'image/png', PNG);
  const other = platform.driveCreateFolder('Lain');
  const outside = platform.driveCreateFile(other, 'b.png', 'image/png', PNG);
  const text = platform.driveCreateFile(folder, 't.txt', 'text/plain', PNG);
  const ids = [good, outside, text, 'tidak-ada', good];
  const first = registerDriveFiles_(ids, probeDriveIds_(ids));
  expect(first.missing.sort()).toEqual([outside, text, 'tidak-ada'].sort());
  expect(first.map.size).toBe(1);
  const rows = listFiles_();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    driveId: good,
    mime: 'image/png',
    size: 16,
    ownerType: '',
    createdBy: 'sync:desktop',
  });
  const second = registerDriveFiles_([good], probeDriveIds_([good]));
  expect(second.map.get(good)).toBe(first.map.get(good));
  expect(listFiles_()).toHaveLength(1);
});
