import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { listFiles_ } from '@gas/modules/files/repo';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { qrPdfDocumentId, qrRpc, seedQrEnv } from '@gas-test/qrcode-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';

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
const defaultsBody = (extra: Record<string, unknown> = {}) => ({
  title: 'PT Contoh',
  subtitle: 'Label QR',
  footer: 'www.contoh.com',
  layout: { ...DEFAULT_QR_LAYOUT, qrSize: 18 },
  style: DEFAULT_QR_STYLE,
  logoFileIds: [] as string[],
  defaultLogoId: '',
  ...extra,
});
const saveDefaults = (payload: Record<string, unknown> = {}, email = 'qrmanage@gmail.com') =>
  call(email, 'qrcodes.saveDefaults', defaultsBody(payload));

test('belum pernah diatur: bawaan bawaan aplikasi, pustaka logo kosong; view boleh membaca', () => {
  const out = call('qrview@gmail.com', 'qrcodes.getDefaults', null);
  expect(out.ok).toBe(true);
  expect(out.data).toMatchObject({
    title: '',
    subtitle: '',
    footer: '',
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
    logoFileIds: [],
    defaultLogoId: '',
    updatedAt: '',
  });
  expect(call('noqr@gmail.com', 'qrcodes.getDefaults', null).error.code).toBe('FORBIDDEN');
});

test('simpan default: hanya izin kelola; tersimpan dan dikembalikan; audit; tidak membuat hasil ekspor', () => {
  expect(saveDefaults({}, 'qredit@gmail.com').error.code).toBe('FORBIDDEN');
  expect(saveDefaults({}, 'qrview@gmail.com').error.code).toBe('FORBIDDEN');
  const a = logo();
  const b = logo();
  const out = saveDefaults({ logoFileIds: [a, b], defaultLogoId: b });
  expect(out.ok).toBe(true);
  expect(out.data).toMatchObject({
    title: 'PT Contoh',
    footer: 'www.contoh.com',
    logoFileIds: [a, b],
    defaultLogoId: b,
  });
  expect(out.data.layout.qrSize).toBe(18);
  const read = call('qredit@gmail.com', 'qrcodes.getDefaults', null);
  expect(read.data.logoFileIds).toEqual([a, b]);
  expect(listAuditRecords_().map((r) => r.action)).toContain('qrcode.defaults_update');
  // logo pustaka dimiliki bersama sehingga dapat dibaca pengguna qrcode lain
  expect(call('qrview@gmail.com', 'files.get', { id: a }).ok).toBe(true);
  expect(listFiles_().find((f) => f.id === a)?.ownerType).toBe('qrlogo');
});

test('validasi default: logo awal harus bagian pustaka; berkas tak dikenal ditolak; tanpa duplikat', () => {
  const a = logo();
  expect(saveDefaults({ logoFileIds: [a], defaultLogoId: 'lain' }).error.code).toBe('VALIDATION');
  expect(saveDefaults({ logoFileIds: ['tidak-ada'] }).error.code).toBe('VALIDATION');
  const dup = saveDefaults({ logoFileIds: [a, a], defaultLogoId: a });
  expect(dup.ok).toBe(true);
  expect(dup.data.logoFileIds).toEqual([a]);
});

test('konkurensi default: simpan ulang wajib expectedUpdatedAt terkini', () => {
  const first = saveDefaults({});
  expect(first.ok).toBe(true);
  const noVersion = saveDefaults({ title: 'Baru' });
  expect(noVersion.error.code).toBe('VALIDATION');
  clock += 60_000;
  const stale = saveDefaults({ title: 'Baru', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
  expect(stale.error.code).toBe('CONFLICT');
  expect(saveDefaults({ title: 'Baru', expectedUpdatedAt: first.data.updatedAt }).ok).toBe(true);
});

test('simpan QR: logo hanya dari pustaka (atau logo yang sudah dipakai konfigurasi itu); tanpa logo boleh', () => {
  const inLibrary = logo();
  const outside = logo('qredit@gmail.com');
  saveDefaults({ logoFileIds: [inLibrary], defaultLogoId: inLibrary });
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
  // logo dikeluarkan dari pustaka: konfigurasi yang sudah memakainya tetap dapat disimpan ulang tanpa mengubah logo
  const current = call('qrview@gmail.com', 'qrcodes.get', { id: ok.data.id }).data;
  const lib = call('qrview@gmail.com', 'qrcodes.getDefaults', null).data;
  saveDefaults({ logoFileIds: [], defaultLogoId: '', expectedUpdatedAt: lib.updatedAt });
  const resave = call('qredit@gmail.com', 'qrcodes.save', {
    ...body,
    id: ok.data.id,
    expectedUpdatedAt: current.updatedAt,
    title: 'T2',
    logoFileId: inLibrary,
  });
  expect(resave.ok).toBe(true);
});
