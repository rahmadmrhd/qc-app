import { beforeEach, expect, test } from 'bun:test';
import { seedQrPreset } from '@server-test/qrcode-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import {
  guardChanged,
  insertQrDesignStmt,
  listQrDesigns,
  listQrDocuments,
  listQrPresets,
  runGuardedBatch,
  updateQrDesignStmt,
} from './repo';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});

const design = {
  id: 'q1',
  title: '0815',
  linkSource: 'url' as const,
  link: 'https://a.co/x',
  documentId: '',
  subtitle: '=bukan formula',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  overflow: false,
  exportedHash: '',
  exportedAt: '',
  exportedBy: '',
  exportPdfDriveId: '',
  exportPngDriveId: '',
  name: '',
  namePlacement: '' as const,
  presetId: '',
  createdAt: '2026-10-16T00:00:00.000Z',
  createdBy: 'a@x.com',
  updatedAt: '2026-10-16T00:00:00.000Z',
  updatedBy: 'a@x.com',
};

test('desain: simpan, baca, ubah; teks mirip angka/formula tetap apa adanya, layout kembali utuh', async () => {
  await env.DB.batch([insertQrDesignStmt(env.DB, design)]);
  const [saved] = await listQrDesigns(env);
  expect(saved).toMatchObject({
    id: 'q1',
    title: '0815',
    subtitle: '=bukan formula',
    layout: DEFAULT_QR_LAYOUT,
  });
  await env.DB.batch([
    updateQrDesignStmt(env.DB, {
      ...(saved as typeof design),
      exportedHash: 'abc12345',
      exportPdfDriveId: 'file-9',
    }),
  ]);
  expect((await listQrDesigns(env))[0]).toMatchObject({
    exportedHash: 'abc12345',
    exportPdfDriveId: 'file-9',
  });
});

test('layout/style tersimpan yang rusak atau kosong dipulihkan ke bawaan, bukan melempar', async () => {
  await env.DB.batch([insertQrDesignStmt(env.DB, design)]);
  await env.DB.prepare(
    "UPDATE qr_designs SET layout = '{bukan json', style = '' WHERE id = 'q1'",
  ).run();
  const [row] = await listQrDesigns(env);
  expect(row?.layout).toEqual(DEFAULT_QR_LAYOUT);
  expect(row?.style).toEqual(DEFAULT_QR_STYLE);
  await env.DB.prepare("UPDATE qr_designs SET style = '{bukan json' WHERE id = 'q1'").run();
  expect((await listQrDesigns(env))[0]?.style).toEqual(DEFAULT_QR_STYLE);
});

test('dokumen: kolom shared kosong (baris impor lama) dianggap dibagikan; 0 = dicabut', async () => {
  await env.DB.prepare(
    "INSERT INTO qr_documents (id, drive_id, name, size, shared) VALUES ('d1', 'f1', 'a.pdf', 1200, '')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO qr_documents (id, drive_id, name, size, shared) VALUES ('d2', 'f2', 'b.pdf', 1, '0')",
  ).run();
  const rows = await listQrDocuments(env);
  expect(rows.find((d) => d.id === 'd1')).toMatchObject({ size: 1200, shared: true });
  expect(rows.find((d) => d.id === 'd2')?.shared).toBe(false);
});

test('guardChanged: UPDATE bergaris yang tak mengubah baris membatalkan SELURUH batch; yang berubah lolos', async () => {
  await env.DB.batch([insertQrDesignStmt(env.DB, design)]);
  const stale = { ...design, title: 'Basi', updatedAt: '2026-10-17T00:00:00.000Z' };
  const marker = env.DB.prepare(
    "INSERT INTO qr_documents (id, drive_id, name, size, shared, created_at, created_by, updated_at, updated_by) VALUES ('penanda', 'd', 'n', 1, '1', '', '', '', '')",
  );
  // guard salah (updated_at tidak cocok): 0 baris berubah -> batch dibatalkan, penanda ikut batal
  await expect(
    runGuardedBatch(
      env.DB,
      [updateQrDesignStmt(env.DB, stale, '2026-01-01T00:00:00.000Z'), guardChanged(env.DB), marker],
      () => new Error('basi'),
    ),
  ).rejects.toThrow('basi');
  expect((await listQrDesigns(env))[0]?.title).toBe('0815');
  expect(await listQrDocuments(env)).toHaveLength(0);
  // guard benar: lolos dan semua pernyataan terterapkan
  await runGuardedBatch(
    env.DB,
    [updateQrDesignStmt(env.DB, stale, design.updatedAt), guardChanged(env.DB), marker],
    () => new Error('basi'),
  );
  expect((await listQrDesigns(env))[0]?.title).toBe('Basi');
  expect(await listQrDocuments(env)).toHaveLength(1);
});

test('desain: nama Manual Book, penempatan nama, dan preset asal tersimpan dan terbaca kembali', async () => {
  await env.DB.batch([
    insertQrDesignStmt(env.DB, {
      ...design,
      name: 'PBE M5-400/200',
      namePlacement: 'subtitle',
      presetId: 'p-1',
    }),
  ]);
  expect((await listQrDesigns(env))[0]).toMatchObject({
    name: 'PBE M5-400/200',
    namePlacement: 'subtitle',
    presetId: 'p-1',
  });
  // Nilai penempatan tak dikenal dibaca sebagai kosong.
  await env.DB.prepare("UPDATE qr_designs SET name_placement = 'xyz' WHERE id = 'q1'").run();
  expect((await listQrDesigns(env))[0]?.namePlacement).toBe('');
});

test('preset: kolom BU dan penempatan nama terbaca; bu_id kosong = preset lama tanpa BU', async () => {
  await seedQrPreset(env, { id: 'p1', buId: 'bu-a', namePlacement: 'footer' });
  await seedQrPreset(env, { id: 'p2' });
  const presets = await listQrPresets(env);
  expect(presets.find((p) => p.id === 'p1')).toMatchObject({
    buId: 'bu-a',
    namePlacement: 'footer',
  });
  expect(presets.find((p) => p.id === 'p2')).toMatchObject({ buId: '', namePlacement: '' });
});

test('preset: dua preset dengan bu_id sama ditolak pada indeks qr_presets_bu_unique; bu_id kosong boleh berulang', async () => {
  await seedQrPreset(env, { id: 'p1', buId: 'bu-a' });
  await expect(seedQrPreset(env, { id: 'p2', buId: 'bu-a' })).rejects.toMatchObject({
    kind: 'duplicate',
    key: 'qr_presets_bu_unique_live',
  });
  await seedQrPreset(env, { id: 'p3', buId: 'bu-b' });
  await seedQrPreset(env, { id: 'p4' });
  await seedQrPreset(env, { id: 'p5' });
  expect(await listQrPresets(env)).toHaveLength(4);
});
