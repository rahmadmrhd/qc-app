import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { listFiles_ } from '@gas/modules/files/repo';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { qrPdfDocumentId, qrRpc, seedQrEnv } from '@gas-test/qrcode-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { insertQrDefaults_ } from './repo';
import { migrateQrDefaults_ } from './service';

let platform: MemoryPlatform;
let clock: number;
beforeEach(() => {
  clock = Date.parse('2026-10-16T03:00:00.000Z');
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
    now: () => clock,
  });
  setPlatform_(platform);
  seedQrEnv();
});
// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) =>
  qrRpc(email, method, payload) as Result;
const PNG1 = { mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUg==', width: 1, height: 1 };
const logo = (email = 'qrmanage@gmail.com') => {
  const out = call(email, 'files.upload', PNG1);
  if (!out.ok) throw new Error('unggah gagal');
  return out.data.id as string;
};
const defaults = () => call('qrview@gmail.com', 'qrcodes.getDefaults', null).data;
const presetBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Standar',
  title: 'PT Contoh',
  subtitle: 'Label QR',
  footer: 'www.contoh.com',
  layout: { ...DEFAULT_QR_LAYOUT, qrSize: 18 },
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  ...extra,
});
const savePreset = (payload: Record<string, unknown> = {}, email = 'qrmanage@gmail.com') =>
  call(email, 'qrcodes.savePreset', presetBody(payload));
const saveLibrary = (ids: string[], email = 'qrmanage@gmail.com') => {
  const current = defaults();
  return call(email, 'qrcodes.saveLogoLibrary', {
    ...(current.logoUpdatedAt ? { expectedUpdatedAt: current.logoUpdatedAt } : {}),
    logoFileIds: ids,
  });
};

test('belum ada apa pun: daftar default kosong dan pustaka logo kosong; view boleh membaca, tanpa modul tidak', () => {
  expect(defaults()).toMatchObject({ presets: [], logoFileIds: [], logoUpdatedAt: '' });
  expect(call('noqr@gmail.com', 'qrcodes.getDefaults', null).error.code).toBe('FORBIDDEN');
});

test('buat default: hanya izin kelola; nama wajib dan unik (tanpa beda huruf besar); tersimpan; audit', () => {
  expect(savePreset({}, 'qredit@gmail.com').error.code).toBe('FORBIDDEN');
  expect(savePreset({}, 'qrview@gmail.com').error.code).toBe('FORBIDDEN');
  expect(savePreset({ name: '  ' }).error.code).toBe('VALIDATION');
  const first = savePreset();
  expect(first.ok).toBe(true);
  expect(first.data).toMatchObject({
    name: 'Standar',
    title: 'PT Contoh',
    footer: 'www.contoh.com',
  });
  expect(first.data.layout.qrSize).toBe(18);
  const duplicate = savePreset({ name: 'standar' });
  expect(duplicate.error.code).toBe('VALIDATION');
  expect(duplicate.error.fields.name).toContain('sudah dipakai');
  expect(savePreset({ name: 'Promo', title: '' }).ok).toBe(true); // title boleh kosong
  expect(defaults().presets.map((p: { name: string }) => p.name)).toEqual(['Promo', 'Standar']);
  expect(listAuditRecords_().map((r) => r.action)).toEqual([
    'qrcode.preset_create',
    'qrcode.preset_create',
  ]);
});

test('ubah default: expectedUpdatedAt wajib dan harus terkini; nama boleh tetap; tanpa perubahan tidak mengaudit', () => {
  const made = savePreset();
  const base = { id: made.data.id };
  expect(savePreset({ ...base, title: 'Baru' }).error.code).toBe('VALIDATION');
  clock += 60_000;
  expect(
    savePreset({ ...base, title: 'Baru', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }).error
      .code,
  ).toBe('CONFLICT');
  const updated = savePreset({ ...base, title: 'Baru', expectedUpdatedAt: made.data.updatedAt });
  expect(updated.ok).toBe(true);
  expect(updated.data.title).toBe('Baru');
  const audits = listAuditRecords_().length;
  const same = savePreset({ ...base, title: 'Baru', expectedUpdatedAt: updated.data.updatedAt });
  expect(same.ok).toBe(true);
  expect(listAuditRecords_().length).toBe(audits);
  expect(savePreset({ id: 'tidak-ada', expectedUpdatedAt: 'x' }).error.code).toBe('NOT_FOUND');
});

test('hapus default: hanya kelola; hilang dari daftar; QR yang sudah dibuat tidak terpengaruh', () => {
  const made = savePreset();
  expect(call('qredit@gmail.com', 'qrcodes.deletePreset', { id: made.data.id }).error.code).toBe(
    'FORBIDDEN',
  );
  expect(call('qrmanage@gmail.com', 'qrcodes.deletePreset', { id: 'tidak-ada' }).error.code).toBe(
    'NOT_FOUND',
  );
  expect(call('qrmanage@gmail.com', 'qrcodes.deletePreset', { id: made.data.id }).ok).toBe(true);
  expect(defaults().presets).toEqual([]);
  expect(listAuditRecords_().map((r) => r.action)).toContain('qrcode.preset_delete');
});

test('pustaka logo bersama: hanya kelola; logo dimiliki bersama dan terbaca pengguna qrcode; maks. 20; tanpa duplikat', () => {
  const a = logo();
  const b = logo();
  expect(saveLibrary([a], 'qredit@gmail.com').error.code).toBe('FORBIDDEN');
  const saved = saveLibrary([a, b, a]);
  expect(saved.ok).toBe(true);
  expect(saved.data.logoFileIds).toEqual([a, b]);
  expect(defaults().logoFileIds).toEqual([a, b]);
  expect(call('qrview@gmail.com', 'files.get', { id: a }).ok).toBe(true);
  expect(listFiles_().find((f) => f.id === a)?.ownerType).toBe('qrlogo');
  expect(saveLibrary(['tidak-ada']).error.code).toBe('VALIDATION');
  const many = Array.from({ length: 21 }, (_, i) => `id-${i}`);
  expect(saveLibrary(many).error.code).toBe('VALIDATION');
  clock += 1000;
  const stale = call('qrmanage@gmail.com', 'qrcodes.saveLogoLibrary', {
    expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    logoFileIds: [a],
  });
  expect(stale.error.code).toBe('CONFLICT');
  expect(listAuditRecords_().map((r) => r.action)).toContain('qrcode.logo_library_update');
});

test('logo awal default harus bagian pustaka; mengeluarkan logo dari pustaka mengosongkan logo awal default yang memakainya', () => {
  const a = logo();
  expect(savePreset({ defaultLogoId: a }).error.fields.defaultLogoId).toContain('pustaka');
  saveLibrary([a]);
  const withLogo = savePreset({ defaultLogoId: a });
  expect(withLogo.ok).toBe(true);
  expect(withLogo.data.defaultLogoId).toBe(a);
  clock += 1000;
  expect(saveLibrary([]).ok).toBe(true);
  expect(defaults().presets[0].defaultLogoId).toBe('');
});

test('simpan QR: logo hanya dari pustaka (atau logo yang sudah dipakai konfigurasi lain); tanpa logo boleh', () => {
  const inLibrary = logo();
  const outside = logo('qredit@gmail.com');
  saveLibrary([inLibrary]);
  const body = {
    title: 'T',
    subtitle: '',
    footer: '',
    linkSource: 'pdf',
    link: '',
    get documentId() {
      return qrPdfDocumentId();
    },
    layout: DEFAULT_QR_LAYOUT,
  };
  const bad = call('qredit@gmail.com', 'qrcodes.save', { ...body, logoFileId: outside });
  expect(bad.error.code).toBe('VALIDATION');
  expect(bad.error.fields.logoFileId).toContain('pustaka');
  const ok = call('qredit@gmail.com', 'qrcodes.save', { ...body, logoFileId: inLibrary });
  expect(ok.ok).toBe(true);
  expect(call('qredit@gmail.com', 'qrcodes.save', { ...body, logoFileId: '' }).ok).toBe(true);
  // logo dikeluarkan dari pustaka: QR yang memakainya tetap dapat disimpan ulang dan diduplikat
  clock += 1000;
  saveLibrary([]);
  const current = call('qrview@gmail.com', 'qrcodes.get', { id: ok.data.id }).data;
  expect(
    call('qredit@gmail.com', 'qrcodes.save', {
      ...body,
      id: ok.data.id,
      expectedUpdatedAt: current.updatedAt,
      title: 'T2',
      logoFileId: inLibrary,
    }).ok,
  ).toBe(true);
  expect(
    call('qredit@gmail.com', 'qrcodes.save', {
      ...body,
      title: 'T (salinan)',
      logoFileId: inLibrary,
    }).ok,
  ).toBe(true);
  // logo yang tidak dipakai siapa pun dan di luar pustaka tetap ditolak
  expect(
    call('qredit@gmail.com', 'qrcodes.save', { ...body, logoFileId: logo('qredit@gmail.com') })
      .error.code,
  ).toBe('VALIDATION');
});

test('migrasi: default tunggal lama menjadi satu default bernama "Default"; idempoten; tanpa default lama tidak membuat apa pun', () => {
  expect(migrateQrDefaults_()).toBe(0);
  const a = logo();
  insertQrDefaults_({
    title: 'PT Lama',
    subtitle: 'S',
    footer: 'F',
    layout: { ...DEFAULT_QR_LAYOUT, qrSize: 19 },
    style: DEFAULT_QR_STYLE,
    logoFileIds: [a],
    defaultLogoId: a,
    updatedAt: '2026-10-15T00:00:00.000Z',
    updatedBy: 'admin@gmail.com',
  });
  expect(migrateQrDefaults_()).toBe(1);
  expect(migrateQrDefaults_()).toBe(0);
  const read = defaults();
  expect(read.logoFileIds).toEqual([a]);
  expect(read.presets).toHaveLength(1);
  expect(read.presets[0]).toMatchObject({
    name: 'Default',
    title: 'PT Lama',
    footer: 'F',
    defaultLogoId: a,
  });
  expect(read.presets[0].layout.qrSize).toBe(19);
});
