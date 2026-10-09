import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertRole_, insertUser_ } from '@gas/modules/access/repo';
import { getRoutes_ } from '@gas/routes';
import { role, user } from '@gas-test/access-fixtures';
import { captureAppError } from '@gas-test/errors';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { MAX_IMAGE_BYTES } from '@shared/files';
import { listFiles_ } from './repo';
import {
  attachFiles_,
  DRIVE_FOLDER_NAME,
  ensureDriveFolder_,
  readFile_,
  uploadFile_,
} from './service';
import { validateGetFile_, validateUploadFile_ } from './validate';

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
const JPEG = '/9j/4AAQSkZJRg==';

let platform: MemoryPlatform;
let admin: UserContext;

const upload = (overrides: Record<string, unknown> = {}) => ({
  mime: 'image/png',
  base64: PNG,
  width: 1,
  height: 1,
  ...overrides,
});

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
    now: () => Date.parse('2026-10-09T00:00:00.000Z'),
  });
  setPlatform_(platform);
  const ctx = loadUserContext_('admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

test('upload menyimpan ke Drive dan mencatat metadata tanpa pemilik', () => {
  const saved = uploadFile_(validateUploadFile_(upload()), admin);
  expect(saved).toMatchObject({ mime: 'image/png', width: 1, height: 1 });
  expect(saved.size).toBe(Buffer.from(PNG, 'base64').length);
  expect(listFiles_()).toHaveLength(1);
  expect(listFiles_()[0]).toMatchObject({
    id: saved.id,
    ownerType: '',
    ownerId: '',
    createdBy: 'admin@gmail.com',
    createdAt: '2026-10-09T00:00:00.000Z',
  });
  expect(platform.drive.size).toBe(1);
});

test('folder Drive dibuat sekali dan dipakai ulang (setup diulang, upload berturut-turut)', () => {
  const first = ensureDriveFolder_();
  const second = ensureDriveFolder_();
  uploadFile_(validateUploadFile_(upload()), admin);
  uploadFile_(validateUploadFile_(upload({ mime: 'image/jpeg', base64: JPEG })), admin);
  expect(second).toBe(first);
  expect(platform.folders.size).toBe(1);
  expect(platform.folders.get(first)).toBe(DRIVE_FOLDER_NAME);
  expect(platform.getProperty('DRIVE_FOLDER_ID')).toBe(first);
});

test('upload pertama tanpa setup membuat folder sendiri', () => {
  expect(platform.getProperty('DRIVE_FOLDER_ID')).toBeNull();
  uploadFile_(validateUploadFile_(upload()), admin);
  expect(platform.getProperty('DRIVE_FOLDER_ID')).not.toBeNull();
});

test('readFile_ mengembalikan isi dari catatan sheet, dan id tak dikenal NOT_FOUND', () => {
  const saved = uploadFile_(validateUploadFile_(upload()), admin);
  expect(readFile_({ id: saved.id })).toEqual({ id: saved.id, mime: 'image/png', base64: PNG });
  expect(captureAppError(() => readFile_({ id: 'tidak-ada' })).code).toBe('NOT_FOUND');
});

test('readFile_ tidak pernah membaca Drive id yang tidak tercatat di sheet files', () => {
  const folder = ensureDriveFolder_();
  const stray = platform.driveCreateFile(folder, 'rahasia.png', 'image/png', PNG);
  expect(captureAppError(() => readFile_({ id: stray })).code).toBe('NOT_FOUND');
});

test('readFile_ NOT_FOUND bila berkas Drive hilang', () => {
  const saved = uploadFile_(validateUploadFile_(upload()), admin);
  platform.drive.clear();
  expect(captureAppError(() => readFile_({ id: saved.id })).code).toBe('NOT_FOUND');
});

test('validasi upload menolak MIME, base64, tanda tangan, ukuran, dan dimensi yang salah', () => {
  const fieldsOf = (input: unknown) => captureAppError(() => validateUploadFile_(input)).fields;
  expect(fieldsOf(upload({ mime: 'image/gif' }))?.mime).toBe('Hanya JPEG, PNG, atau WebP');
  expect(fieldsOf(upload({ mime: 'text/html' }))?.mime).toBeDefined();
  expect(fieldsOf(upload({ base64: 'bukan base64!' }))?.base64).toBe('Isi gambar tidak valid');
  expect(fieldsOf(upload({ base64: `data:image/png;base64,${PNG}` }))?.base64).toBe(
    'Isi gambar tidak valid',
  );
  expect(fieldsOf(upload({ mime: 'image/jpeg' }))?.base64).toBe(
    'Isi berkas tidak sesuai jenis gambar',
  );
  const huge = `iVBORw0KGgo${'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8)}`;
  expect(fieldsOf(upload({ base64: huge.slice(0, huge.length - (huge.length % 4)) }))?.base64).toBe(
    'Ukuran gambar maksimal 1 MB',
  );
  for (const bad of [0, -1, 4001, 1.5, '1', null]) {
    expect(fieldsOf(upload({ width: bad }))?.width).toBeDefined();
    expect(fieldsOf(upload({ height: bad }))?.height).toBeDefined();
  }
  expect(fieldsOf('teks')?._).toBe('Input harus berupa objek');
  expect(listFiles_()).toHaveLength(0);
  expect(platform.drive.size).toBe(0);
});

test('validateGetFile_ mewajibkan id', () => {
  expect(validateGetFile_({ id: 'f1' })).toEqual({ id: 'f1' });
  expect(captureAppError(() => validateGetFile_({ id: '' })).fields).toEqual({ id: 'Wajib diisi' });
});

test('attachFiles_ menetapkan pemilik sekali; pemilik lain CONFLICT; id tak dikenal VALIDATION', () => {
  const a = uploadFile_(validateUploadFile_(upload()), admin);
  const b = uploadFile_(validateUploadFile_(upload()), admin);
  attachFiles_([a.id, b.id], 'item', 'item-1');
  expect(listFiles_().map((f) => [f.ownerType, f.ownerId])).toEqual([
    ['item', 'item-1'],
    ['item', 'item-1'],
  ]);
  attachFiles_([a.id], 'item', 'item-1'); // pemilik sama: aman diulang
  expect(captureAppError(() => attachFiles_([a.id], 'item', 'item-2')).code).toBe('CONFLICT');
  expect(captureAppError(() => attachFiles_(['hilang'], 'item', 'item-1')).code).toBe('VALIDATION');
  attachFiles_([], 'item', 'item-1');
});

test('rute: upload butuh item edit, baca butuh item view, dan lintas peran ditolak', () => {
  insertRole_(role({ id: 'r-view', name: 'Lihat', permissions: { item: 'view' } }));
  insertRole_(role({ id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } }));
  insertUser_(user({ id: 'u-v', email: 'lihat@gmail.com', roleIds: ['r-view'] }));
  insertUser_(user({ id: 'u-e', email: 'ubah@gmail.com', roleIds: ['r-edit'] }));
  insertUser_(user({ id: 'u-n', email: 'tanpa@gmail.com' }));
  const call = (method: string, payload: unknown, email: string) =>
    handleRpc_(method, JSON.stringify(payload), signSessionToken_(email), getRoutes_());

  const saved = call('files.upload', upload(), 'ubah@gmail.com');
  expect(saved.ok).toBe(true);
  const id = saved.ok ? (saved.data as { id: string }).id : '';
  expect(call('files.upload', upload(), 'lihat@gmail.com')).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
  expect(call('files.upload', upload(), 'tanpa@gmail.com')).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
  expect(call('files.get', { id }, 'lihat@gmail.com')).toMatchObject({
    ok: true,
    data: { mime: 'image/png', base64: PNG },
  });
  expect(call('files.get', { id }, 'tanpa@gmail.com')).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
});
