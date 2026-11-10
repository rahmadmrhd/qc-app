import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit, seedUser } from '@server-test/access-fixtures';
import { bytesOfBase64 } from '@server-test/bytes';
import { qrCall, qrPdfDocumentId, seedQrEnv, seedQrPreset } from '@server-test/qrcode-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  await seedQrEnv(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedBusinessUnit(env, { id: 'bu-off', code: 'OFF', status: 'inactive' });
});

const call = (email: string, method: string, payload: unknown) =>
  qrCall(env, email, method, payload);
const PNG1 = {
  mime: 'image/png',
  bytes: bytesOfBase64('iVBORw0KGgoAAAANSUhEUg=='),
  width: 1,
  height: 1,
};
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
  buId: 'bu-a',
  namePlacement: 'title',
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
    expect((await savePreset({ name: 'Promo', title: '', buId: 'bu-b' })).ok).toBe(true);
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

describe('preset per BU, kloning, dan opsi BU', () => {
  const clone = (payload: Record<string, unknown>, email = 'qrmanage@gmail.com') =>
    call(email, 'qrcodes.clonePreset', payload);

  test('simpan preset membawa BU dan penempatan nama; tersaji di getDefaults', async () => {
    const made = await savePreset({ buId: 'bu-a', namePlacement: 'subtitle' });
    expect(made.ok).toBe(true);
    expect(made.data).toMatchObject({ buId: 'bu-a', namePlacement: 'subtitle' });
    expect((await defaults()).presets[0]).toMatchObject({
      buId: 'bu-a',
      namePlacement: 'subtitle',
    });
  });

  test('BU wajib ada dan aktif; BU yang sudah punya preset ditolak CONFLICT pada field buId', async () => {
    expect((await savePreset({ buId: '' })).error.code).toBe('VALIDATION');
    const unknown = await savePreset({ buId: 'tidak-ada' });
    expect(unknown.error.code).toBe('VALIDATION');
    expect(unknown.error.fields.buId).toBeDefined();
    expect((await savePreset({ buId: 'bu-off' })).error.code).toBe('VALIDATION');
    expect((await savePreset()).ok).toBe(true);
    const dup = await savePreset({ name: 'Lain', buId: 'bu-a' });
    expect(dup.error.code).toBe('CONFLICT');
    expect(dup.error.fields.buId).toBe('BU ini sudah punya konfigurasi default');
    expect((await defaults()).presets).toHaveLength(1);
  });

  test('menyimpan preset yang sama dengan BU sendiri boleh; pindah ke BU yang sudah dipakai ditolak', async () => {
    const a = await savePreset();
    const b = await savePreset({ name: 'Kedua', buId: 'bu-b' });
    env.clock.advance(1000);
    const same = await savePreset({
      id: a.data.id,
      expectedUpdatedAt: a.data.updatedAt,
      title: 'Baru',
    });
    expect(same.ok).toBe(true);
    const move = await savePreset({
      id: b.data.id,
      expectedUpdatedAt: b.data.updatedAt,
      name: 'Kedua',
      buId: 'bu-a',
    });
    expect(move.error.code).toBe('CONFLICT');
    expect(move.error.fields.buId).toBeDefined();
  });

  test('dua penyimpanan serentak untuk BU sama: tepat satu berhasil (indeks unik menjaga)', async () => {
    const [x, y] = await Promise.all([
      savePreset({ name: 'X', buId: 'bu-b' }),
      savePreset({ name: 'Y', buId: 'bu-b' }),
    ]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    const failed = x.ok ? y : x;
    expect(failed.error.code).toBe('CONFLICT');
    expect((await defaults()).presets).toHaveLength(1);
  });

  test('preset lama tanpa BU tetap terdaftar dan dapat diberi BU lewat savePreset', async () => {
    await seedQrPreset(env, { id: 'lama', name: 'Lama', title: 'PT Lama' });
    const listed = (await defaults()).presets;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 'lama', buId: '', namePlacement: '' });
    const given = await savePreset({
      id: 'lama',
      expectedUpdatedAt: listed[0].updatedAt,
      name: 'Lama',
      title: 'PT Lama',
      buId: 'bu-b',
      namePlacement: 'footer',
    });
    expect(given.ok).toBe(true);
    expect(given.data).toMatchObject({ buId: 'bu-b', namePlacement: 'footer' });
  });

  test('clonePreset menyalin gaya dan penempatan ke BU lain dengan nama baru; audit; sumber tak berubah', async () => {
    const style = { ...DEFAULT_QR_STYLE, title: { ...DEFAULT_QR_STYLE.title, bold: false } };
    const source = await savePreset({ namePlacement: 'footer', style });
    env.clock.advance(1000);
    const copy = await clone({ id: source.data.id, buId: 'bu-b', name: 'Salinan B' });
    expect(copy.ok).toBe(true);
    expect(copy.data.id).not.toBe(source.data.id);
    expect(copy.data).toMatchObject({
      name: 'Salinan B',
      buId: 'bu-b',
      namePlacement: 'footer',
      title: 'PT Contoh',
      footer: 'www.contoh.com',
    });
    expect(copy.data.style).toEqual(style);
    expect(copy.data.layout).toEqual(source.data.layout);
    const presets = (await defaults()).presets;
    expect(presets).toHaveLength(2);
    expect(presets.find((p: { id: string }) => p.id === source.data.id)).toMatchObject({
      name: 'Standar',
      buId: 'bu-a',
      updatedAt: source.data.updatedAt,
    });
    expect(await audits()).toContain('qrcode.preset_clone');
  });

  test('clonePreset ditolak: BU sudah punya preset, BU tak dikenal atau nonaktif, nama kembar, sumber hilang, tanpa izin kelola', async () => {
    const source = await savePreset();
    await savePreset({ name: 'Punya B', buId: 'bu-b' });
    const taken = await clone({ id: source.data.id, buId: 'bu-b', name: 'Salinan' });
    expect(taken.error.code).toBe('CONFLICT');
    expect(taken.error.fields.buId).toBeDefined();
    expect((await clone({ id: source.data.id, buId: 'tidak-ada', name: 'S' })).error.code).toBe(
      'VALIDATION',
    );
    expect((await clone({ id: source.data.id, buId: 'bu-off', name: 'S' })).error.code).toBe(
      'VALIDATION',
    );
    const dupName = await clone({ id: source.data.id, buId: 'bu-off', name: 'standar' });
    expect(dupName.error.code).toBe('VALIDATION');
    expect(dupName.error.fields.name).toContain('sudah dipakai');
    expect((await clone({ id: 'tidak-ada', buId: 'bu-b', name: 'S' })).error.code).toBe(
      'NOT_FOUND',
    );
    expect(
      (await clone({ id: source.data.id, buId: 'bu-b', name: 'S' }, 'qredit@gmail.com')).error.code,
    ).toBe('FORBIDDEN');
    expect((await defaults()).presets).toHaveLength(2);
  });

  test('businessUnits.options: pengguna qrcode:view dapat memanggil, tanpa modul tidak', async () => {
    const ok = await call('qrview@gmail.com', 'businessUnits.options', null);
    expect(ok.ok).toBe(true);
    expect(ok.data.map((bu: { id: string }) => bu.id).sort()).toEqual(['bu-a', 'bu-b', 'bu-off']);
    await seedUser(env, { id: 'u-none', email: 'nobody@gmail.com' });
    expect((await call('nobody@gmail.com', 'businessUnits.options', null)).error.code).toBe(
      'FORBIDDEN',
    );
  });
});
