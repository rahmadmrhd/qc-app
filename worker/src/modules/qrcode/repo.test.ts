import { beforeEach, expect, test } from 'bun:test';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import { insertQrDesignStmt, listQrDesigns, listQrDocuments, updateQrDesignStmt } from './repo';

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
