import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertRole_, insertUser_, listAuditRecords_ } from '@gas/modules/access/repo';
import { listFiles_ } from '@gas/modules/files/repo';
import { uploadFile_ } from '@gas/modules/files/service';
import { validateUploadFile_ } from '@gas/modules/files/validate';
import { getRoutes_ } from '@gas/routes';
import { role, user } from '@gas-test/access-fixtures';
import { captureAppError } from '@gas-test/errors';
import { item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { hashText } from '@shared/items';
import type { SaveItemInput } from '@shared/rpc';
import { insertItem_, listItems_ } from './repo';
import { getItemDto_, listItemSummaries_, saveItem_, setItemStatus_ } from './service';

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

let platform: MemoryPlatform;
let admin: UserContext;

const baseInput: SaveItemInput = {
  brand: 'Ubiquiti',
  model: 'ES 24 250W',
  isCountryLock: false,
  aliases: [],
  stickers: [],
  accessories: [],
  attachments: [],
  detail: '',
};

const newFile = () =>
  uploadFile_(validateUploadFile_({ mime: 'image/png', base64: PNG, width: 1, height: 1 }), admin)
    .id;

function lastAudit() {
  const record = listAuditRecords_().at(-1);
  if (!record) throw new Error('audit kosong');
  return record;
}

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

test('membuat item: aktif, kolom sinkron kosong, audit create tanpa teks Markdown penuh', () => {
  const detail = '## Spesifikasi\n'.repeat(200);
  const saved = saveItem_(
    {
      ...baseInput,
      detail,
      aliases: ['ES24'],
      stickers: [
        { name: 'Label SNI', note: 'Belakang', fileId: null },
        { name: 'Garansi', note: '', fileId: null },
      ],
      accessories: [{ name: 'Kabel daya', qty: 2 }],
    },
    admin,
  );
  expect(saved).toMatchObject({
    brand: 'Ubiquiti',
    model: 'ES 24 250W',
    status: 'active',
    externalId: '',
    isCountryLock: false,
    imageCount: 0,
    updatedBy: 'admin@gmail.com',
    createdAt: '2026-10-09T00:00:00.000Z',
  });
  expect(saved.detail).toBe(detail);
  expect(lastAudit()).toMatchObject({
    action: 'item.create',
    target: 'Ubiquiti ES 24 250W',
    before: null,
    after: {
      brand: 'Ubiquiti',
      model: 'ES 24 250W',
      isCountryLock: false,
      status: 'active',
      aliases: ['ES24'],
      stickers: ['Label SNI — Belakang', 'Garansi'],
      accessories: ['Kabel daya ×2'],
      attachments: [],
      detailLength: detail.length,
      detailHash: hashText(detail),
    },
  });
  expect(JSON.stringify(lastAudit().after)).not.toContain('Spesifikasi');
});

test('daftar ringkas terurut merk lalu tipe, memuat nonaktif, tanpa detail Markdown', () => {
  insertItem_(
    item({ id: 'i2', brand: 'Ubiquiti', model: 'B', detail: 'RAHASIA', attachments: ['f1', 'f2'] }),
  );
  insertItem_(item({ id: 'i1', brand: 'Mikrotik', model: 'Z', status: 'inactive' }));
  insertItem_(item({ id: 'i3', brand: 'Ubiquiti', model: 'A', isCountryLock: true }));
  const list = listItemSummaries_();
  expect(list.map((i) => `${i.brand} ${i.model}`)).toEqual([
    'Mikrotik Z',
    'Ubiquiti A',
    'Ubiquiti B',
  ]);
  expect(list.find((i) => i.id === 'i2')?.imageCount).toBe(2);
  expect(list.find((i) => i.id === 'i1')?.status).toBe('inactive');
  expect(JSON.stringify(list)).not.toContain('RAHASIA');
  expect('detail' in (list[0] ?? {})).toBe(false);
});

test('getItemDto_ memuat detail lengkap; id tak dikenal NOT_FOUND', () => {
  insertItem_(
    item({
      id: 'i1',
      brand: 'A',
      model: 'B',
      detail: '# isi',
      accessories: [{ name: 'x', qty: 1 }],
    }),
  );
  expect(getItemDto_({ id: 'i1' })).toMatchObject({
    detail: '# isi',
    accessories: [{ name: 'x', qty: 1 }],
  });
  expect(captureAppError(() => getItemDto_({ id: 'tidak-ada' })).code).toBe('NOT_FOUND');
});

test('merk+tipe unik walau beda huruf besar, tanda baca, dan spasi; pesan di field tipe', () => {
  saveItem_(baseInput, admin);
  for (const variant of ['es-24 250w', 'ES_24  250W', '(ES) 24, 250W']) {
    const error = captureAppError(() =>
      saveItem_({ ...baseInput, brand: 'UBIQUITI', model: variant }, admin),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      fields: { model: 'Merk dan tipe sudah dipakai item lain' },
    });
  }
  expect(listItems_()).toHaveLength(1);
});

test('mengubah item sendiri dengan merk+tipe yang sama tidak dianggap duplikat', () => {
  const first = saveItem_(baseInput, admin);
  const again = saveItem_({ ...baseInput, id: first.id, isCountryLock: true }, admin);
  expect(again.id).toBe(first.id);
  expect(again.isCountryLock).toBe(true);
  expect(listItems_()).toHaveLength(1);
});

test('nama lain: tidak boleh sama dengan merk+tipe sendiri, merk+tipe item lain, atau nama lain item lain', () => {
  saveItem_({ ...baseInput, aliases: ['AirSwitch', 'Ubiquiti ES24'] }, admin);
  const other = { ...baseInput, brand: 'Mikrotik', model: 'CRS' };
  expect(
    captureAppError(() => saveItem_({ ...other, aliases: ['mikrotik-crs'] }, admin)),
  ).toMatchObject({
    code: 'VALIDATION',
    fields: { aliases: 'Nama lain tidak boleh sama dengan merk dan tipe item ini' },
  });
  expect(
    captureAppError(() => saveItem_({ ...other, aliases: ['ubiquiti es 24 250w'] }, admin)).fields
      ?.aliases,
  ).toContain('sudah dipakai item Ubiquiti ES 24 250W');
  expect(
    captureAppError(() => saveItem_({ ...other, aliases: ['air-switch', 'airswitch'] }, admin))
      .code,
  ).toBe('CONFLICT');
  expect(
    captureAppError(() => saveItem_({ ...other, aliases: ['AIRSWITCH'] }, admin)).fields?.aliases,
  ).toContain('"AIRSWITCH" sudah dipakai item Ubiquiti ES 24 250W');
  // merk+tipe baru yang sama dengan nama lain item lain juga ditolak
  expect(
    captureAppError(() => saveItem_({ ...baseInput, brand: 'Ubiquiti', model: 'ES24' }, admin)),
  ).toMatchObject({
    code: 'CONFLICT',
    fields: { model: 'Sama dengan nama lain item Ubiquiti ES 24 250W' },
  });
  expect(listItems_()).toHaveLength(1);
});

test('gambar galeri, contoh stiker, dan Markdown ditautkan ke item dalam satu batch', () => {
  const [gallery, sticker, inText] = [newFile(), newFile(), newFile()];
  const saved = saveItem_(
    {
      ...baseInput,
      attachments: [gallery],
      stickers: [{ name: 'Label', note: '', fileId: sticker }],
      detail: `Teks ![x](qcfile:${inText}) dan ![lagi](qcfile:${gallery})`,
    },
    admin,
  );
  const owned = listFiles_().map((f) => [f.id, f.ownerType, f.ownerId]);
  expect(owned.sort()).toEqual(
    [gallery, sticker, inText].map((id) => [id, 'item', saved.id]).sort(),
  );
  expect(saved.imageCount).toBe(1);
});

test('rujukan berkas yang gagal membatalkan seluruh simpan: tidak ada item dan tidak ada pemilik berubah', () => {
  const [free, taken] = [newFile(), newFile()];
  saveItem_({ ...baseInput, brand: 'Lain', model: 'Item', attachments: [taken] }, admin);
  const before = JSON.stringify(listFiles_());

  // berkas tak dikenal di belakang berkas bebas
  expect(
    captureAppError(() => saveItem_({ ...baseInput, attachments: [free, 'hilang'] }, admin)).code,
  ).toBe('VALIDATION');
  // berkas milik item lain di dalam Markdown
  expect(
    captureAppError(() =>
      saveItem_({ ...baseInput, attachments: [free], detail: `![x](qcfile:${taken})` }, admin),
    ).code,
  ).toBe('CONFLICT');

  expect(JSON.stringify(listFiles_())).toBe(before);
  expect(listItems_().map((i) => i.brand)).toEqual(['Lain']);
});

test('mengubah item mempertahankan id MySQL, revisi sinkron, dan waktu dibuat', () => {
  insertItem_(
    item({
      id: 'i1',
      brand: 'Ubiquiti',
      model: 'ES 24 250W',
      externalId: '12',
      syncRev: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  );
  const saved = saveItem_({ ...baseInput, id: 'i1', isCountryLock: true }, admin);
  expect(saved).toMatchObject({
    externalId: '12',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
  });
  expect(listItems_()[0]).toMatchObject({ externalId: '12', syncRev: 7, status: 'active' });
});

test('mengubah item mencatat snapshot sebelum dan sesudah; id tak dikenal NOT_FOUND', () => {
  const first = saveItem_({ ...baseInput, accessories: [{ name: 'Kabel', qty: 1 }] }, admin);
  saveItem_(
    {
      ...baseInput,
      id: first.id,
      accessories: [
        { name: 'Kabel', qty: 2 },
        { name: 'Adaptor', qty: 1 },
      ],
      detail: 'baru',
    },
    admin,
  );
  expect(lastAudit()).toMatchObject({
    action: 'item.update',
    before: { accessories: ['Kabel ×1'], detailLength: 0 },
    after: {
      accessories: ['Kabel ×2', 'Adaptor ×1'],
      detailLength: 4,
      detailHash: hashText('baru'),
    },
  });
  expect(captureAppError(() => saveItem_({ ...baseInput, id: 'tidak-ada' }, admin)).code).toBe(
    'NOT_FOUND',
  );
});

test('nonaktifkan dan aktifkan dicatat; status sama tidak mencatat apa pun', () => {
  const saved = saveItem_(baseInput, admin);
  expect(setItemStatus_({ id: saved.id, status: 'inactive' }, admin).status).toBe('inactive');
  expect(lastAudit()).toMatchObject({
    action: 'item.deactivate',
    target: 'Ubiquiti ES 24 250W',
    before: { status: 'active' },
    after: { status: 'inactive' },
  });
  const count = listAuditRecords_().length;
  setItemStatus_({ id: saved.id, status: 'inactive' }, admin);
  expect(listAuditRecords_()).toHaveLength(count);
  expect(setItemStatus_({ id: saved.id, status: 'active' }, admin).status).toBe('active');
  expect(lastAudit().action).toBe('item.activate');
  expect(captureAppError(() => setItemStatus_({ id: 'x', status: 'active' }, admin)).code).toBe(
    'NOT_FOUND',
  );
});

test('item nonaktif dapat diubah dan tetap nonaktif', () => {
  const saved = saveItem_(baseInput, admin);
  setItemStatus_({ id: saved.id, status: 'inactive' }, admin);
  const edited = saveItem_({ ...baseInput, id: saved.id, isCountryLock: true }, admin);
  expect(edited.status).toBe('inactive');
});

test('rute: view membaca, edit menyimpan, hanya manage menonaktifkan; daftar tanpa detail', () => {
  insertRole_(role({ id: 'r-view', name: 'Lihat', permissions: { item: 'view' } }));
  insertRole_(role({ id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } }));
  insertRole_(role({ id: 'r-manage', name: 'Kelola', permissions: { item: 'manage' } }));
  insertUser_(user({ id: 'u-v', email: 'lihat@gmail.com', roleIds: ['r-view'] }));
  insertUser_(user({ id: 'u-e', email: 'ubah@gmail.com', roleIds: ['r-edit'] }));
  insertUser_(user({ id: 'u-m', email: 'kelola@gmail.com', roleIds: ['r-manage'] }));
  insertUser_(user({ id: 'u-n', email: 'tanpa@gmail.com' }));
  const call = (method: string, payload: unknown, email: string) =>
    handleRpc_(method, JSON.stringify(payload), signSessionToken_(email), getRoutes_());
  const code = (result: ReturnType<typeof call>) => (result.ok ? 'OK' : result.error.code);

  const saved = call('items.save', baseInput, 'ubah@gmail.com');
  expect(code(saved)).toBe('OK');
  const id = saved.ok ? (saved.data as { id: string }).id : '';

  expect(code(call('items.save', baseInput, 'lihat@gmail.com'))).toBe('FORBIDDEN');
  expect(code(call('items.save', baseInput, 'tanpa@gmail.com'))).toBe('FORBIDDEN');
  expect(code(call('items.list', null, 'lihat@gmail.com'))).toBe('OK');
  expect(code(call('items.get', { id }, 'lihat@gmail.com'))).toBe('OK');
  expect(code(call('items.list', null, 'tanpa@gmail.com'))).toBe('FORBIDDEN');
  expect(code(call('items.setStatus', { id, status: 'inactive' }, 'ubah@gmail.com'))).toBe(
    'FORBIDDEN',
  );
  expect(code(call('items.setStatus', { id, status: 'inactive' }, 'kelola@gmail.com'))).toBe('OK');

  const list = call('items.list', null, 'lihat@gmail.com');
  expect(list.ok && JSON.stringify(list.data).includes('"detail"')).toBe(false);
});
