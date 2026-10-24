import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { attachFiles } from '@worker/modules/files/service';
import { measureCpu } from '@worker-test/measure';
import { qrPdfDocumentId, qrRpc, seedQrEnv } from '@worker-test/qrcode-env';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import { QR_FOLDER_SETTING } from './folders';
import { cleanupQrDocuments } from './service';

let env: TestEnv;
const realError = console.error;
let logged: string[];

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  await seedQrEnv(env);
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.join(' '));
  };
});

import { afterEach } from 'bun:test';

afterEach(() => {
  console.error = realError;
});

const call = (email: string, method: string, payload: unknown) =>
  qrRpc(env, email, method, payload);
const PNG1 = { mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUg==', width: 1, height: 1 };
const PDF = 'JVBERi0xLjQK';

async function input(extra: Record<string, unknown> = {}) {
  return {
    title: 'Panduan',
    linkSource: 'pdf',
    link: '',
    documentId: await qrPdfDocumentId(env),
    subtitle: 'Sub',
    footer: 'foot',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
    ...extra,
  };
}

async function save(payload: Record<string, unknown> = {}, email = 'qredit@gmail.com') {
  const body: Record<string, unknown> = { ...(await input()), ...payload };
  if (body.id) {
    const current = await call('qrview@gmail.com', 'qrcodes.get', { id: body.id });
    if (current.ok) {
      // Mengubah wajib membawa versi yang dimuat; satu PDF hanya untuk satu konfigurasi.
      if (body.expectedUpdatedAt === undefined) body.expectedUpdatedAt = current.data.updatedAt;
      if (payload.documentId === undefined) body.documentId = current.data.documentId;
    }
  }
  return call(email, 'qrcodes.save', body);
}
const upload = (name = 'manual.pdf', email = 'qredit@gmail.com') =>
  call(email, 'qrcodes.uploadPdf', { name, base64: PDF });
const usePdf = (documentId: string, extra: Record<string, unknown> = {}) =>
  save({ linkSource: 'pdf', link: '', documentId, ...extra });

async function audits(): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{
    action: string;
  }>();
  return rows.results.map((r) => r.action);
}
async function lastAudit() {
  const row = await env.DB.prepare(
    'SELECT "before" AS b, "after" AS a FROM audit_log ORDER BY id DESC LIMIT 1',
  ).first<{ b: string; a: string }>();
  return { before: JSON.parse(row?.b ?? 'null'), after: JSON.parse(row?.a ?? 'null') };
}
async function designs() {
  const rows = await env.DB.prepare(
    'SELECT id, title, export_pdf_drive_id FROM qr_designs ORDER BY rowid',
  ).all<{ id: string; title: string; export_pdf_drive_id: string }>();
  return rows.results;
}
async function docs() {
  const rows = await env.DB.prepare(
    'SELECT id, drive_id, name, shared FROM qr_documents ORDER BY rowid',
  ).all<{ id: string; drive_id: string; name: string; shared: string }>();
  return rows.results;
}
const driveIdOf = async (documentId: string) =>
  (await docs()).find((d) => d.id === documentId)?.drive_id ?? '';
const shared = (driveId: string) => env.BRIDGE.state.files.get(driveId)?.shared === true;

describe('konfigurasi QR', () => {
  test('izin: view membaca, edit menyimpan, manage menghapus; tanpa modul qrcode FORBIDDEN', async () => {
    expect((await call('qrview@gmail.com', 'qrcodes.list', null)).ok).toBe(true);
    expect((await call('qrview@gmail.com', 'qrcodes.save', await input())).error.code).toBe(
      'FORBIDDEN',
    );
    expect((await call('noqr@gmail.com', 'qrcodes.list', null)).error.code).toBe('FORBIDDEN');
    const made = await save();
    expect(made.ok).toBe(true);
    expect(
      (await call('qredit@gmail.com', 'qrcodes.delete', { id: made.data.id })).error.code,
    ).toBe('FORBIDDEN');
    expect((await call('qrmanage@gmail.com', 'qrcodes.delete', { id: made.data.id })).ok).toBe(
      true,
    );
  });

  test('buat: status Belum diekspor, audit qrcode.create, pembuat tercatat', async () => {
    const out = await save();
    expect(out.data).toMatchObject({
      title: 'Panduan',
      linkSource: 'pdf',
      link: expect.any(String),
      exportStatus: 'none',
      createdBy: 'qredit@gmail.com',
      layout: DEFAULT_QR_LAYOUT,
    });
    expect(await audits()).toEqual(['qrcode.create']);
    expect((await call('qrview@gmail.com', 'qrcodes.get', { id: out.data.id })).data.title).toBe(
      'Panduan',
    );
    expect((await call('qrview@gmail.com', 'qrcodes.get', { id: 'tidak-ada' })).error.code).toBe(
      'NOT_FOUND',
    );
  });

  test('ubah: audit qrcode.update dengan before/after; tanpa perubahan tidak mencatat apa pun dan updatedAt tetap', async () => {
    const made = await save();
    env.clock.advance(60_000);
    const same = await save({ id: made.data.id });
    expect(same.data.updatedAt).toBe(made.data.updatedAt);
    expect(await audits()).toEqual(['qrcode.create']);
    const changed = await save({ id: made.data.id, title: 'Baru' });
    expect(changed.data.title).toBe('Baru');
    expect(changed.data.updatedAt).not.toBe(made.data.updatedAt);
    expect(await audits()).toEqual(['qrcode.create', 'qrcode.update']);
    const entry = await lastAudit();
    expect(entry.before).toMatchObject({ title: 'Panduan' });
    expect(entry.after).toMatchObject({ title: 'Baru' });
  });

  test('konkurensi optimistis: expectedUpdatedAt basi -> CONFLICT dan data tidak berubah', async () => {
    const made = await save();
    const stale = await save({
      id: made.data.id,
      title: 'Timpa',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(stale.error.code).toBe('CONFLICT');
    expect((await designs())[0]?.title).toBe('Panduan');
    expect(
      (await save({ id: made.data.id, title: 'Cocok', expectedUpdatedAt: made.data.updatedAt })).ok,
    ).toBe(true);
  });

  test('CAS atomik: dua penyimpanan berversi sama, hanya satu menang dan audit tidak ganda', async () => {
    const made = await save();
    env.clock.advance(1000);
    const base = {
      ...(await input()),
      id: made.data.id,
      documentId: made.data.documentId,
      expectedUpdatedAt: made.data.updatedAt,
    };
    const [a, b] = await Promise.all([
      call('qredit@gmail.com', 'qrcodes.save', { ...base, title: 'A' }),
      call('qredit@gmail.com', 'qrcodes.save', { ...base, title: 'B' }),
    ]);
    const outcomes = [a.ok, b.ok].sort();
    expect(outcomes).toEqual([false, true]);
    expect((await audits()).filter((x) => x === 'qrcode.update')).toHaveLength(1);
  });

  test('sumber pdf: dokumen harus dikenal; link efektif = URL berbagi; satu PDF hanya untuk satu konfigurasi', async () => {
    expect(
      (await save({ linkSource: 'pdf', link: '', documentId: 'tidak-ada' })).error.fields
        .documentId,
    ).toBeDefined();
    const doc = await qrPdfDocumentId(env);
    const driveId = await driveIdOf(doc);
    const a = await save({ linkSource: 'pdf', link: '', documentId: doc });
    expect(a.data.link).toBe(`https://drive.google.com/file/d/${driveId}/view`);
    expect(a.data.documentName).toBe('sumber.pdf');
    const second = await save({ title: 'Kedua', linkSource: 'pdf', link: '', documentId: doc });
    expect(second.error.code).toBe('VALIDATION');
    expect(second.error.fields.documentId).toContain('sudah dipakai');
    expect(
      (
        await save({
          id: a.data.id,
          title: 'Pertama baru',
          linkSource: 'pdf',
          link: '',
          documentId: doc,
        })
      ).ok,
    ).toBe(true);
    expect(await designs()).toHaveLength(1);
  });

  test('daftar: terbaru dahulu', async () => {
    await save({ title: 'Pertama' });
    env.clock.advance(60_000);
    await save({ title: 'Kedua' });
    expect(
      (await call('qrview@gmail.com', 'qrcodes.list', null)).data.map(
        (d: { title: string }) => d.title,
      ),
    ).toEqual(['Kedua', 'Pertama']);
  });

  const framedStyle = {
    title: { bold: false, italic: true, underline: false, strike: false, uppercase: true },
    subtitle: { bold: false, italic: false, underline: true, strike: false, uppercase: false },
    footer: { bold: false, italic: false, underline: false, strike: true, uppercase: false },
    frame: { kind: 'corners', line: 'dotted', thickness: 0.6, gap: 1.2, radius: 2, arm: 30 },
  };

  test('gaya teks dan bingkai: tersimpan dan dikembalikan; tanpa style = bawaan; tak sah ditolak', async () => {
    expect((await save()).data.style).toEqual(DEFAULT_QR_STYLE);
    const styled = await save({ title: 'Bergaya', style: framedStyle });
    expect(styled.data.style).toEqual(framedStyle);
    expect(
      (await call('qrview@gmail.com', 'qrcodes.get', { id: styled.data.id })).data.style,
    ).toEqual(framedStyle);
    expect(
      (await save({ style: { ...framedStyle, frame: { ...framedStyle.frame, kind: 'bulat' } } }))
        .error.fields.style,
    ).toBeDefined();
    expect(
      (await save({ style: { ...framedStyle, frame: { ...framedStyle.frame, thickness: 99 } } }))
        .error.code,
    ).toBe('VALIDATION');
    expect((await save({ style: null })).error.code).toBe('VALIDATION');
    expect(
      (await save({ style: { ...framedStyle, frame: { ...framedStyle.frame, line: 'zigzag' } } }))
        .error.fields.style,
    ).toBeDefined();
  });

  test('mengubah gaya saja = perubahan; ubah tanpa style mempertahankan gaya yang ada', async () => {
    const made = await save();
    env.clock.advance(60_000);
    const changed = await save({ id: made.data.id, style: framedStyle });
    expect(changed.data.updatedAt).not.toBe(made.data.updatedAt);
    const entry = await lastAudit();
    expect(entry.before).toMatchObject({ frame: 'none' });
    expect(entry.after).toMatchObject({ frame: 'corners' });
    env.clock.advance(60_000);
    const { style: _omit, ...withoutStyle } = {
      ...(await input()),
      id: made.data.id,
      documentId: made.data.documentId,
      expectedUpdatedAt: changed.data.updatedAt,
      title: 'Judul Baru',
    } as Record<string, unknown>;
    const out = await call('qredit@gmail.com', 'qrcodes.save', withoutStyle);
    expect(out.ok).toBe(true);
    expect(out.data.style).toEqual(framedStyle);
  });

  test('mengganti PDF sumber ke dokumen lain TERSIMPAN', async () => {
    const d1 = await qrPdfDocumentId(env);
    const d2 = await qrPdfDocumentId(env);
    const made = await save({ documentId: d1 });
    env.clock.advance(60_000);
    const swapped = await save({ id: made.data.id, documentId: d2 });
    expect(swapped.data.documentId).toBe(d2);
    expect(swapped.data.link).toBe(`https://drive.google.com/file/d/${await driveIdOf(d2)}/view`);
    expect((await audits()).at(-1)).toBe('qrcode.update');
  });

  test('hapus: baris hilang, audit qrcode.delete, berkas ekspor masuk sampah, dokumen tidak dibuang', async () => {
    const made = await save();
    const folder = 'EXPORT';
    env.BRIDGE.state.folders.add(folder);
    const pdfId = await env.BRIDGE.createFile(folder, 'a.pdf', 'application/pdf', 'QUJD');
    await env.DB.prepare('UPDATE qr_designs SET export_pdf_drive_id = ? WHERE id = ?')
      .bind(pdfId, made.data.id)
      .run();
    const docDrive = await driveIdOf(made.data.documentId);
    expect((await call('qrmanage@gmail.com', 'qrcodes.delete', { id: made.data.id })).ok).toBe(
      true,
    );
    expect(await designs()).toHaveLength(0);
    expect(env.BRIDGE.state.files.get(pdfId)?.trashed).toBe(true);
    expect(env.BRIDGE.state.files.get(docDrive)?.trashed).toBe(false);
    expect((await audits()).at(-1)).toBe('qrcode.delete');
    expect(
      (await call('qrmanage@gmail.com', 'qrcodes.delete', { id: made.data.id })).error.code,
    ).toBe('NOT_FOUND');
  });

  test('simpan-ubah wajib menyertakan expectedUpdatedAt', async () => {
    const made = await save();
    const without = await call('qredit@gmail.com', 'qrcodes.save', {
      ...(await input()),
      id: made.data.id,
      documentId: made.data.documentId,
      title: 'Baru',
    });
    expect(without.error.code).toBe('VALIDATION');
    expect(without.error.fields.expectedUpdatedAt).toBeDefined();
    expect((await save({ title: 'Buat baru tanpa id' })).ok).toBe(true);
  });

  test('flag overflow: tersimpan, bawaan false, dipertahankan; hanya flag berubah = diam-diam tanpa audit/updatedAt', async () => {
    expect((await save({ title: 'Biasa' })).data.overflow).toBe(false);
    const made = await save({ title: 'Meluber', overflow: true });
    expect(made.data.overflow).toBe(true);
    expect(
      (await call('qrview@gmail.com', 'qrcodes.get', { id: made.data.id })).data.overflow,
    ).toBe(true);
    env.clock.advance(60_000);
    expect((await save({ id: made.data.id, title: 'Meluber 2' })).data.overflow).toBe(true);
    expect((await save({ title: 'x', overflow: 'ya' })).error.code).toBe('VALIDATION');
    const only = await save({ overflow: true });
    env.clock.advance(60_000);
    const audited = (await audits()).length;
    const out = await save({ id: only.data.id, overflow: false });
    expect(out.data.overflow).toBe(false);
    expect(out.data.updatedAt).toBe(only.data.updatedAt);
    expect(await audits()).toHaveLength(audited);
  });
});

describe('link, logo, dan berkas', () => {
  test('link harus dari Drive; konfigurasi lama berlink manual tetap dapat disimpan ulang tanpa mengubah link', async () => {
    const rejected = await save({
      linkSource: 'url',
      link: 'https://contoh.com/a',
      documentId: '',
    });
    expect(rejected.error.code).toBe('VALIDATION');
    expect(rejected.error.fields.link).toContain('Drive');
    const now = '2026-10-16T00:00:00.000Z';
    await env.DB.prepare(
      "INSERT INTO qr_designs (id, title, link_source, link, layout, style, created_at, created_by, updated_at, updated_by) VALUES ('legacy', 'Lama', 'url', 'https://contoh.com/lama', ?, ?, ?, 'seed@gmail.com', ?, 'seed@gmail.com')",
    )
      .bind(JSON.stringify(DEFAULT_QR_LAYOUT), JSON.stringify(DEFAULT_QR_STYLE), now, now)
      .run();
    const legacy = { linkSource: 'url', link: 'https://contoh.com/lama', documentId: '' };
    const same = await save({
      id: 'legacy',
      title: 'Lama diubah',
      expectedUpdatedAt: now,
      ...legacy,
    });
    expect(same.ok).toBe(true);
    const changed = await save({
      id: 'legacy',
      expectedUpdatedAt: same.data.updatedAt,
      ...legacy,
      link: 'https://contoh.com/baru',
    });
    expect(changed.error.code).toBe('VALIDATION');
  });

  test('logo: berkas tak dikenal ditolak; logo yang sama boleh dirujuk banyak konfigurasi', async () => {
    expect((await save({ logoFileId: 'tidak-ada' })).error.code).toBe('VALIDATION');
    const up = await call('qredit@gmail.com', 'files.upload', PNG1);
    expect(up.ok).toBe(true);
    const logo = up.data.id as string;
    expect((await save({ title: 'A', logoFileId: logo })).error.code).toBe('VALIDATION');
    await addToLibrary(logo);
    expect((await save({ title: 'A', logoFileId: logo })).ok).toBe(true);
    expect((await save({ title: 'B', logoFileId: logo })).ok).toBe(true);
    const row = await env.DB.prepare('SELECT owner_type, owner_id FROM files WHERE id = ?')
      .bind(logo)
      .first();
    expect(row).toEqual({ owner_type: 'qrlogo', owner_id: 'shared' });
  });

  async function addToLibrary(...ids: string[]) {
    const current = (await call('qrview@gmail.com', 'qrcodes.getDefaults', null)).data;
    const out = await call('qrmanage@gmail.com', 'qrcodes.saveLogoLibrary', {
      ...(current.logoUpdatedAt ? { expectedUpdatedAt: current.logoUpdatedAt } : {}),
      logoFileIds: [...current.logoFileIds, ...ids],
    });
    if (!out.ok) throw new Error(`simpan pustaka gagal: ${JSON.stringify(out.error)}`);
    env.clock.advance(1000);
  }
  const uploadAs = async (email: string) => {
    const out = await call(email, 'files.upload', PNG1);
    if (!out.ok) throw new Error('unggah gagal');
    return out.data.id as string;
  };

  test('mengganti logo ke logo lain TERSIMPAN dan tercatat di audit', async () => {
    const a = await uploadAs('qredit@gmail.com');
    const b = await uploadAs('qredit@gmail.com');
    await addToLibrary(a, b);
    const made = await save({ logoFileId: a });
    env.clock.advance(60_000);
    const swapped = await save({ id: made.data.id, logoFileId: b });
    expect(swapped.data.logoFileId).toBe(b);
    expect(swapped.data.updatedAt).not.toBe(made.data.updatedAt);
    expect(await audits()).toEqual([
      'qrcode.logo_library_update',
      'qrcode.create',
      'qrcode.update',
    ]);
  });

  test('files.get untuk pengguna qrcode tanpa izin item: hanya logo (qrlogo) dan unggahannya sendiri yang belum terpasang', async () => {
    const logo = await uploadAs('qredit@gmail.com');
    await addToLibrary(logo);
    const itemFile = await uploadAs('qredit@gmail.com');
    await attachFiles(env, [itemFile], 'item', 'item-1');
    const mine = await uploadAs('qredit@gmail.com');
    expect((await call('qrview@gmail.com', 'files.get', { id: logo })).ok).toBe(true);
    expect((await call('qrview@gmail.com', 'files.get', { id: itemFile })).error.code).toBe(
      'NOT_FOUND',
    );
    expect((await call('qrview@gmail.com', 'files.get', { id: mine })).error.code).toBe(
      'NOT_FOUND',
    );
    expect((await call('qredit@gmail.com', 'files.get', { id: mine })).ok).toBe(true);
    expect((await call('noqr@gmail.com', 'files.get', { id: itemFile })).ok).toBe(true);
    expect((await call('noqr@gmail.com', 'files.get', { id: logo })).ok).toBe(true);
  });

  test('qrcodes.file meneruskan base64 hasil ekspor apa adanya; belum diekspor/hilang -> NOT_FOUND', async () => {
    const made = await save();
    expect(
      (await call('qrview@gmail.com', 'qrcodes.file', { id: made.data.id, kind: 'pdf' })).error
        .code,
    ).toBe('NOT_FOUND');
    const folder = await (async () => {
      env.BRIDGE.state.folders.add('QRF');
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, 'QRF')")
        .bind(QR_FOLDER_SETTING)
        .run();
      return 'QRF';
    })();
    const pdf = await env.BRIDGE.createFile(folder, 'x.pdf', 'application/pdf', PDF);
    await env.DB.prepare('UPDATE qr_designs SET export_pdf_drive_id = ? WHERE id = ?')
      .bind(pdf, made.data.id)
      .run();
    const out = await call('qrview@gmail.com', 'qrcodes.file', { id: made.data.id, kind: 'pdf' });
    expect(out.data).toMatchObject({ mime: 'application/pdf', base64: PDF });
    expect(out.data.filename).toMatch(/\.pdf$/);
    expect(
      (await call('qrview@gmail.com', 'qrcodes.file', { id: made.data.id, kind: 'png' })).error
        .code,
    ).toBe('NOT_FOUND');
    expect(
      (await call('qrview@gmail.com', 'qrcodes.file', { id: 'x', kind: 'pdf' })).error.code,
    ).toBe('NOT_FOUND');
  });
});

describe('pencabutan berbagi PDF sumber', () => {
  test('menghapus konfigurasi yang terakhir memakai PDF mencabut berbagi PDF itu', async () => {
    const doc = (await upload()).data;
    const design = (await usePdf(doc.id)).data;
    const drive = await driveIdOf(doc.id);
    expect(shared(drive)).toBe(true);
    expect((await call('qrmanage@gmail.com', 'qrcodes.delete', { id: design.id })).ok).toBe(true);
    expect(shared(drive)).toBe(false);
    expect((await docs()).find((d) => d.id === doc.id)?.shared).toBe('0');
    expect(env.BRIDGE.state.files.get(drive)?.trashed).toBe(false);
  });

  test('mengganti PDF sumber ke dokumen lain mencabut berbagi PDF yang tidak lagi dipakai', async () => {
    const doc = (await upload()).data;
    const other = (await upload('lain.pdf')).data;
    const design = (await usePdf(doc.id)).data;
    expect(
      (await usePdf(other.id, { id: design.id, expectedUpdatedAt: design.updatedAt })).ok,
    ).toBe(true);
    expect(shared(await driveIdOf(doc.id))).toBe(false);
    expect(shared(await driveIdOf(other.id))).toBe(true);
  });

  test('memakai kembali PDF yang sudah dicabut membagikannya lagi', async () => {
    const doc = (await upload()).data;
    const design = (await usePdf(doc.id)).data;
    await call('qrmanage@gmail.com', 'qrcodes.delete', { id: design.id });
    expect(shared(await driveIdOf(doc.id))).toBe(false);
    expect((await usePdf(doc.id, { title: 'Pakai lagi' })).ok).toBe(true);
    expect(shared(await driveIdOf(doc.id))).toBe(true);
    expect((await docs()).find((d) => d.id === doc.id)?.shared).toBe('1');
  });

  test('unggahan yatim dicabut setelah masa tenggang 1 jam; yang baru dan yang dipakai tetap', async () => {
    const orphan = (await upload('yatim.pdf')).data;
    const used = (await upload('dipakai.pdf')).data;
    await usePdf(used.id);
    env.clock.advance(30 * 60_000);
    const fresh = (await upload('baru.pdf')).data;
    expect(shared(await driveIdOf(orphan.id))).toBe(true);
    env.clock.advance(45 * 60_000);
    await upload('pemicu.pdf');
    expect(shared(await driveIdOf(orphan.id))).toBe(false);
    expect(shared(await driveIdOf(fresh.id))).toBe(true);
    expect(shared(await driveIdOf(used.id))).toBe(true);
  });

  test('gagal mencabut berbagi di Drive tidak menggagalkan hapus; galat dicatat; dicoba lagi kemudian', async () => {
    const doc = (await upload()).data;
    const design = (await usePdf(doc.id)).data;
    const original = env.BRIDGE.revokeSharing;
    env.BRIDGE.revokeSharing = async () => {
      throw new Error('Drive menolak');
    };
    expect((await call('qrmanage@gmail.com', 'qrcodes.delete', { id: design.id })).ok).toBe(true);
    expect(logged.some((m) => m.includes('Drive menolak'))).toBe(true);
    expect((await docs()).find((d) => d.id === doc.id)?.shared).toBe('1');
    env.BRIDGE.revokeSharing = original;
    env.clock.advance(2 * 60 * 60 * 1000);
    expect((await upload('lain.pdf')).ok).toBe(true);
    expect((await docs()).find((d) => d.id === doc.id)?.shared).toBe('0');
  });

  test('simpan basi yang membagikan ulang PDF dan ditolak CONFLICT: berbagi dicabut lagi', async () => {
    const doc = (await upload()).data.id;
    const made = await usePdf(doc);
    const stale = made.data.updatedAt;
    env.clock.advance(1000);
    // dialihkan ke dokumen lain: PDF lepas dan berbaginya dicabut
    const other = (await upload('lain.pdf')).data.id;
    expect((await usePdf(other, { id: made.data.id, expectedUpdatedAt: stale })).ok).toBe(true);
    expect((await docs()).find((d) => d.id === doc)?.shared).toBe('0');
    const result = await usePdf(doc, { id: made.data.id, expectedUpdatedAt: stale });
    expect(result.error.code).toBe('CONFLICT');
    expect((await docs()).find((d) => d.id === doc)?.shared).toBe('0');
    expect(shared(await driveIdOf(doc))).toBe(false);
  });

  test('cleanupQrDocuments (cron) mencabut yatim setelah masa tenggang, tidak sebelumnya; tidak mencabut yang dipakai', async () => {
    const orphan = (await upload()).data.id;
    const used = (await upload('dipakai.pdf')).data.id;
    await usePdf(used);
    expect(await cleanupQrDocuments(env)).toBe(0);
    env.clock.advance(61 * 60 * 1000);
    expect(await cleanupQrDocuments(env)).toBe(1);
    expect((await docs()).find((d) => d.id === orphan)?.shared).toBe('0');
    expect((await docs()).find((d) => d.id === used)?.shared).toBe('1');
    expect(await cleanupQrDocuments(env)).toBe(0);
  });

  test('pencabutan dibatasi per pemanggilan (batas subrequest) dan dilanjutkan pemanggilan berikutnya', async () => {
    for (let i = 0; i < 5; i++) await upload(`y${i}.pdf`);
    env.clock.advance(2 * 60 * 60 * 1000);
    expect(await cleanupQrDocuments(env, 2)).toBe(2);
    expect(await cleanupQrDocuments(env, 2)).toBe(2);
    expect(await cleanupQrDocuments(env, 2)).toBe(1);
  });

  test('menyimpan dengan PDF sumber mengganti nama berkas Drive menjadi {title}-{subtitle}-{timestamp}.pdf', async () => {
    const doc = (await upload('FM BAK.09 form.pdf')).data.id;
    expect((await usePdf(doc, { title: 'Panduan Instalasi', subtitle: 'U7-Pro' })).ok).toBe(true);
    const expected = 'Panduan Instalasi-U7-Pro-20261016-100000.pdf'; // 03:00 UTC = 10:00 WIB
    expect(env.BRIDGE.state.files.get(await driveIdOf(doc))?.name).toBe(expected);
    expect((await docs()).find((d) => d.id === doc)?.name).toBe(expected);
    const doc2 = (await upload('lain.pdf')).data.id;
    await usePdf(doc2, { title: 'Tanpa Sub', subtitle: '' });
    expect(env.BRIDGE.state.files.get(await driveIdOf(doc2))?.name).toBe(
      'Tanpa Sub-20261016-100000.pdf',
    );
  });

  test('setelah diekspor, PDF hanya boleh diganti isinya: memilih dokumen lain ditolak', async () => {
    const doc = (await upload()).data.id;
    const made = await usePdf(doc);
    await env.DB.prepare(
      "UPDATE qr_designs SET exported_hash = 'abc12345', exported_at = ? WHERE id = ?",
    )
      .bind(made.data.updatedAt, made.data.id)
      .run();
    const other = (await upload('baru.pdf')).data.id;
    const result = await usePdf(other, {
      id: made.data.id,
      expectedUpdatedAt: made.data.updatedAt,
    });
    expect(result.error.code).toBe('VALIDATION');
    expect(result.error.fields.documentId).toContain('diekspor');
    expect(
      (await usePdf(doc, { id: made.data.id, expectedUpdatedAt: made.data.updatedAt })).ok,
    ).toBe(true);
  });

  test('langkah pasca-simpan yang gagal (ubah nama berkas) tidak menggagalkan RPC setelah konfigurasi tersimpan', async () => {
    const doc = (await upload()).data.id;
    env.BRIDGE.renameFile = async () => {
      throw new Error('Drive sementara gagal');
    };
    const made = await usePdf(doc, { title: 'Tetap Tersimpan' });
    expect(made.ok).toBe(true);
    expect((await call('qrview@gmail.com', 'qrcodes.get', { id: made.data.id })).data.title).toBe(
      'Tetap Tersimpan',
    );
  });
});

describe('P6: CPU kasar', () => {
  test('daftar 300 konfigurasi QR murah', async () => {
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 300; i++) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO qr_designs (id, title, link_source, link, layout, style, created_at, updated_at) VALUES (?, ?, 'url', 'https://x.id', ?, ?, '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:00.000Z')",
        ).bind(
          `q${i}`,
          `Judul ${i}`,
          JSON.stringify(DEFAULT_QR_LAYOUT),
          JSON.stringify(DEFAULT_QR_STYLE),
        ),
      );
    }
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    const measured = await measureCpu(() => call('qrview@gmail.com', 'qrcodes.list', null));
    expect(measured.result.data).toHaveLength(300);
    expect(measured.ms).toBeLessThan(30);
  });
});
