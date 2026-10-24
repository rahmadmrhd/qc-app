import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { qrPdfDocumentId, qrRpc, seedQrEnv } from '@worker-test/qrcode-env';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  await seedQrEnv(env);
});

const call = (email: string, method: string, payload: unknown) =>
  qrRpc(env, email, method, payload);
const PNG1 = { mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUg==', width: 1, height: 1 };
const logo = async (email = 'qrmanage@gmail.com') => {
  const out = await call(email, 'files.upload', PNG1);
  if (!out.ok) throw new Error('unggah gagal');
  return out.data.id as string;
};
const defaults = async () => (await call('qrview@gmail.com', 'qrcodes.getDefaults', null)).data;
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
const saveLibrary = async (ids: string[], email = 'qrmanage@gmail.com') => {
  const current = await defaults();
  return call(email, 'qrcodes.saveLogoLibrary', {
    ...(current.logoUpdatedAt ? { expectedUpdatedAt: current.logoUpdatedAt } : {}),
    logoFileIds: ids,
  });
};
async function audits() {
  const rows = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{
    action: string;
  }>();
  return rows.results.map((r) => r.action);
}

describe('konfigurasi default dan pustaka logo', () => {
  test('belum ada apa pun: daftar default dan pustaka logo kosong; view boleh membaca, tanpa modul tidak', async () => {
    expect(await defaults()).toMatchObject({ presets: [], logoFileIds: [], logoUpdatedAt: '' });
    expect((await call('noqr@gmail.com', 'qrcodes.getDefaults', null)).error.code).toBe(
      'FORBIDDEN',
    );
  });

  test('buat default: hanya izin kelola; nama wajib dan unik (tanpa beda huruf besar); tersimpan; audit', async () => {
    expect((await savePreset({}, 'qredit@gmail.com')).error.code).toBe('FORBIDDEN');
    expect((await savePreset({}, 'qrview@gmail.com')).error.code).toBe('FORBIDDEN');
    expect((await savePreset({ name: '  ' })).error.code).toBe('VALIDATION');
    const first = await savePreset();
    expect(first.ok).toBe(true);
    expect(first.data).toMatchObject({
      name: 'Standar',
      title: 'PT Contoh',
      footer: 'www.contoh.com',
    });
    expect(first.data.layout.qrSize).toBe(18);
    const duplicate = await savePreset({ name: 'standar' });
    expect(duplicate.error.code).toBe('VALIDATION');
    expect(duplicate.error.fields.name).toContain('sudah dipakai');
    expect((await savePreset({ name: 'Promo', title: '' })).ok).toBe(true);
    expect((await defaults()).presets.map((p: { name: string }) => p.name)).toEqual([
      'Promo',
      'Standar',
    ]);
    expect(await audits()).toEqual(['qrcode.preset_create', 'qrcode.preset_create']);
  });

  test('ubah default: expectedUpdatedAt wajib dan terkini; nama boleh tetap; tanpa perubahan tidak mengaudit', async () => {
    const made = await savePreset();
    const base = { id: made.data.id };
    expect((await savePreset({ ...base, title: 'Baru' })).error.code).toBe('VALIDATION');
    env.clock.advance(60_000);
    expect(
      (await savePreset({ ...base, title: 'Baru', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }))
        .error.code,
    ).toBe('CONFLICT');
    const updated = await savePreset({
      ...base,
      title: 'Baru',
      expectedUpdatedAt: made.data.updatedAt,
    });
    expect(updated.ok).toBe(true);
    expect(updated.data.title).toBe('Baru');
    const count = (await audits()).length;
    const same = await savePreset({
      ...base,
      title: 'Baru',
      expectedUpdatedAt: updated.data.updatedAt,
    });
    expect(same.ok).toBe(true);
    expect(await audits()).toHaveLength(count);
    expect((await savePreset({ id: 'tidak-ada', expectedUpdatedAt: 'x' })).error.code).toBe(
      'NOT_FOUND',
    );
  });

  test('CAS: dua pengubahan default dengan versi sama, hanya satu menang', async () => {
    const made = await savePreset();
    env.clock.advance(1000);
    const body = { id: made.data.id, expectedUpdatedAt: made.data.updatedAt };
    const [a, b] = await Promise.all([
      savePreset({ ...body, title: 'A' }),
      savePreset({ ...body, title: 'B' }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect((await audits()).filter((x) => x === 'qrcode.preset_update')).toHaveLength(1);
  });

  test('hapus default: hanya kelola; hilang dari daftar', async () => {
    const made = await savePreset();
    expect(
      (await call('qredit@gmail.com', 'qrcodes.deletePreset', { id: made.data.id })).error.code,
    ).toBe('FORBIDDEN');
    expect(
      (await call('qrmanage@gmail.com', 'qrcodes.deletePreset', { id: 'tidak-ada' })).error.code,
    ).toBe('NOT_FOUND');
    expect(
      (await call('qrmanage@gmail.com', 'qrcodes.deletePreset', { id: made.data.id })).ok,
    ).toBe(true);
    expect((await defaults()).presets).toEqual([]);
    expect(await audits()).toContain('qrcode.preset_delete');
  });

  test('pustaka logo: hanya kelola; dimiliki bersama dan terbaca pengguna qrcode; maks. 20; tanpa duplikat; basi -> CONFLICT', async () => {
    const a = await logo();
    const b = await logo();
    expect((await saveLibrary([a], 'qredit@gmail.com')).error.code).toBe('FORBIDDEN');
    const saved = await saveLibrary([a, b, a]);
    expect(saved.ok).toBe(true);
    expect(saved.data.logoFileIds).toEqual([a, b]);
    expect((await defaults()).logoFileIds).toEqual([a, b]);
    expect((await call('qrview@gmail.com', 'files.get', { id: a })).ok).toBe(true);
    const owner = await env.DB.prepare('SELECT owner_type FROM files WHERE id = ?')
      .bind(a)
      .first<{ owner_type: string }>();
    expect(owner?.owner_type).toBe('qrlogo');
    expect((await saveLibrary(['tidak-ada'])).error.code).toBe('VALIDATION');
    expect((await saveLibrary(Array.from({ length: 21 }, (_, i) => `id-${i}`))).error.code).toBe(
      'VALIDATION',
    );
    env.clock.advance(1000);
    const stale = await call('qrmanage@gmail.com', 'qrcodes.saveLogoLibrary', {
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      logoFileIds: [a],
    });
    expect(stale.error.code).toBe('CONFLICT');
    expect(await audits()).toContain('qrcode.logo_library_update');
  });

  test('pustaka logo stale tidak mengubah apa pun (batch dibatalkan: pemilik berkas dan default tetap)', async () => {
    const a = await logo();
    const b = await logo();
    expect((await saveLibrary([a])).ok).toBe(true);
    env.clock.advance(1000);
    const stale = await call('qrmanage@gmail.com', 'qrcodes.saveLogoLibrary', {
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      logoFileIds: [a, b],
    });
    expect(stale.error.code).toBe('CONFLICT');
    const owner = await env.DB.prepare('SELECT owner_type FROM files WHERE id = ?')
      .bind(b)
      .first<{ owner_type: string }>();
    expect(owner?.owner_type).toBe('');
    expect((await defaults()).logoFileIds).toEqual([a]);
  });

  test('logo awal default harus bagian pustaka; mengeluarkan logo dari pustaka mengosongkan logo awal default yang memakainya', async () => {
    const a = await logo();
    expect((await savePreset({ defaultLogoId: a })).error.fields.defaultLogoId).toContain(
      'pustaka',
    );
    await saveLibrary([a]);
    const withLogo = await savePreset({ defaultLogoId: a });
    expect(withLogo.data.defaultLogoId).toBe(a);
    env.clock.advance(1000);
    expect((await saveLibrary([])).ok).toBe(true);
    expect((await defaults()).presets[0].defaultLogoId).toBe('');
  });

  test('simpan QR: logo hanya dari pustaka (atau logo yang dipakai konfigurasi lain); tanpa logo boleh', async () => {
    const inLibrary = await logo();
    const outside = await logo('qredit@gmail.com');
    await saveLibrary([inLibrary]);
    const body = async () => ({
      title: 'T',
      subtitle: '',
      footer: '',
      linkSource: 'pdf',
      link: '',
      documentId: await qrPdfDocumentId(env),
      layout: DEFAULT_QR_LAYOUT,
    });
    const bad = await call('qredit@gmail.com', 'qrcodes.save', {
      ...(await body()),
      logoFileId: outside,
    });
    expect(bad.error.code).toBe('VALIDATION');
    expect(bad.error.fields.logoFileId).toContain('pustaka');
    const ok = await call('qredit@gmail.com', 'qrcodes.save', {
      ...(await body()),
      logoFileId: inLibrary,
    });
    expect(ok.ok).toBe(true);
    expect(
      (await call('qredit@gmail.com', 'qrcodes.save', { ...(await body()), logoFileId: '' })).ok,
    ).toBe(true);
    env.clock.advance(1000);
    await saveLibrary([]);
    const current = (await call('qrview@gmail.com', 'qrcodes.get', { id: ok.data.id })).data;
    expect(
      (
        await call('qredit@gmail.com', 'qrcodes.save', {
          ...(await body()),
          id: ok.data.id,
          documentId: current.documentId,
          expectedUpdatedAt: current.updatedAt,
          title: 'T2',
          logoFileId: inLibrary,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await call('qredit@gmail.com', 'qrcodes.save', {
          ...(await body()),
          title: 'T (salinan)',
          logoFileId: inLibrary,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await call('qredit@gmail.com', 'qrcodes.save', {
          ...(await body()),
          logoFileId: await logo('qredit@gmail.com'),
        })
      ).error.code,
    ).toBe('VALIDATION');
  });
});
