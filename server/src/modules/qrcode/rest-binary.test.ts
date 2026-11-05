import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { runPendingJobs } from '@server/jobs/runner';
import { qrPdfDocumentId, seedQrEnv } from '@server-test/qrcode-env';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE, QR_LIMITS } from '@shared/qrcode';

// Kabel REST biner QR: unggah PDF sumber (badan mentah), ekspor (multipart pdf+png), unduh hasil ekspor (aliran).

setDefaultTimeout(30_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const realError = console.error;

const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function fileOf(head: number[], size: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 17 + seed) % 256;
  bytes.set(head, 0);
  return bytes;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  rest = restClient(env);
  await seedQrEnv(env);
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

async function makeDesign() {
  const response = await rest.post('/qrcodes', {
    email: 'qredit@gmail.com',
    body: {
      title: 'Panduan Ö',
      linkSource: 'pdf',
      link: '',
      documentId: await qrPdfDocumentId(env),
      subtitle: 'Sub',
      footer: '',
      logoFileId: '',
      layout: DEFAULT_QR_LAYOUT,
      style: DEFAULT_QR_STYLE,
    },
  });
  expect(response.status).toBe(201);
  return (await jsonOf(response)) as { id: string; updatedAt: string };
}

function multipart(pdf: Uint8Array | null, png: Uint8Array | null): FormData {
  const form = new FormData();
  if (pdf) form.append('pdf', new Blob([pdf], { type: 'application/pdf' }), 'label.pdf');
  if (png) form.append('png', new Blob([png], { type: 'image/png' }), 'label.png');
  return form;
}

const exportRequest = (
  design: { id: string; updatedAt: string },
  form: FormData,
  email = 'qredit@gmail.com',
  ifMatch: string | null = design.updatedAt,
) =>
  rest.post(`/qrcodes/${design.id}/exports`, {
    email,
    raw: form,
    headers: ifMatch === null ? {} : { 'if-match': `"${ifMatch}"` },
  });

describe('POST /qrcode-documents (PDF mentah)', () => {
  const upload = (bytes: Uint8Array, query = '?name=manual.pdf', email = 'qredit@gmail.com') =>
    rest.post(`/qrcode-documents${query}`, {
      email,
      raw: bytes,
      headers: { 'content-type': 'application/pdf' },
    });

  test('PDF multi-MB masuk utuh ke Drive; izin edit; nama lewat query', async () => {
    const bytes = fileOf(PDF_HEAD, 3 * 1024 * 1024 + 5);
    const response = await upload(bytes);
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toMatchObject({ name: 'manual.pdf' });
    const stored = [...env.BRIDGE.state.files.values()].find((f) => f.mime === 'application/pdf');
    expect(stored?.base64).toBe(Buffer.from(bytes).toString('base64'));
    expect((await upload(bytes, '?name=x.pdf', 'qrview@gmail.com')).status).toBe(403);
    expect((await upload(bytes, '?name=x.pdf', 'noqr@gmail.com')).status).toBe(403);
  });

  test('bukan PDF -> 422 fields.bytes; nama kosong -> 422 fields.name', async () => {
    const notPdf = await upload(new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(notPdf.status).toBe(422);
    expect(await jsonOf(notPdf)).toMatchObject({ fields: { bytes: 'Berkas bukan PDF' } });
    const noName = await upload(fileOf(PDF_HEAD, 64), '');
    expect(noName.status).toBe(422);
    expect(env.BRIDGE.state.files.size).toBe(0);
  });

  test('persis 10 MB diterima; lebih satu byte -> 413 berpesan ramah tanpa menyentuh Drive', async () => {
    expect((await upload(fileOf(PDF_HEAD, QR_LIMITS.documentMaxBytes))).status).toBe(200);
    const filesBefore = env.BRIDGE.state.files.size;
    const over = await upload(fileOf(PDF_HEAD, QR_LIMITS.documentMaxBytes + 1), '?name=b.pdf');
    expect(over.status).toBe(413);
    expect(await jsonOf(over)).toMatchObject({
      code: 'VALIDATION',
      detail: 'Ukuran PDF maksimal 10 MB',
    });
    expect(env.BRIDGE.state.files.size).toBe(filesBefore);
  });

  test('pembacaan dihentikan begitu batas terlampaui (tidak memuat seluruh badan)', async () => {
    const chunk = new Uint8Array(512 * 1024);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 80) return controller.close(); // 40 MB bila dibaca semuanya
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const response = await rest.send('POST', '/qrcode-documents?name=besar.pdf', {
      email: 'qredit@gmail.com',
      raw: stream as unknown as Uint8Array,
      headers: { 'content-type': 'application/pdf' },
    });
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(30);
  });
});

describe('POST /qrcodes/{id}/exports (multipart) dan GET /qrcodes/{id}/files/{kind}', () => {
  test('202 + Location /api/v1/jobs/{jobId}; setelah job selesai unduhan = byte yang diunggah (PDF ~700 KB, batas jembatan)', async () => {
    const design = await makeDesign();
    const pdf = fileOf(PDF_HEAD, 700_001, 3);
    const png = fileOf(PNG_HEAD, 70_000, 5);
    const accepted = await exportRequest(design, multipart(pdf, png));
    expect(accepted.status).toBe(202);
    const { jobId } = (await jsonOf(accepted)) as { jobId: string };
    expect(accepted.headers.get('location')).toBe(`/api/v1/jobs/${jobId}`);
    await runPendingJobs(env);
    expect(
      await jsonOf(await rest.get(`/jobs/${jobId}`, { email: 'qredit@gmail.com' })),
    ).toMatchObject({ status: 'done' });

    const file = await rest.get(`/qrcodes/${design.id}/files/pdf`, { email: 'qrview@gmail.com' });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), Buffer.from(pdf))).toBe(0);
    const image = await rest.get(`/qrcodes/${design.id}/files/png`, { email: 'qrview@gmail.com' });
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.compare(Buffer.from(await image.arrayBuffer()), Buffer.from(png))).toBe(0);
  });

  test('unduhan: Content-Disposition attachment (ASCII + filename* UTF-8), ETag, 304; ETag berubah setelah ekspor ulang', async () => {
    const design = await makeDesign();
    await exportRequest(design, multipart(fileOf(PDF_HEAD, 400), fileOf(PNG_HEAD, 400)));
    await runPendingJobs(env);
    const first = await rest.get(`/qrcodes/${design.id}/files/pdf`, { email: 'qrview@gmail.com' });
    const disposition = first.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]*\.pdf"; filename\*=UTF-8''/);
    expect(decodeURIComponent(disposition.split("UTF-8''")[1] ?? '')).toBe('panduan-sub.pdf');
    expect(disposition).not.toMatch(/[\r\n]/);
    const etag = first.headers.get('etag') ?? '';
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{8,}"$/);
    expect(first.headers.get('cache-control')).toContain('private');
    const cached = await rest.get(`/qrcodes/${design.id}/files/pdf`, {
      email: 'qrview@gmail.com',
      headers: { 'if-none-match': etag },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');

    const refreshed = (await jsonOf(
      await rest.get(`/qrcodes/${design.id}`, { email: 'qrview@gmail.com' }),
    )) as { updatedAt: string };
    env.clock.advance(5000);
    await exportRequest(
      { id: design.id, updatedAt: refreshed.updatedAt },
      multipart(fileOf(PDF_HEAD, 500, 9), fileOf(PNG_HEAD, 500, 9)),
    );
    await runPendingJobs(env);
    const second = await rest.get(`/qrcodes/${design.id}/files/pdf`, { email: 'qrview@gmail.com' });
    expect(second.headers.get('etag')).not.toBe(etag);
    const stale = await rest.get(`/qrcodes/${design.id}/files/pdf`, {
      email: 'qrview@gmail.com',
      headers: { 'if-none-match': etag },
    });
    expect(stale.status).toBe(200);
  });

  test('izin diperiksa sebelum cache: tanpa modul qrcode 403 walau isi sudah hangat di cache; belum diekspor 404', async () => {
    const design = await makeDesign();
    expect(
      (await rest.get(`/qrcodes/${design.id}/files/pdf`, { email: 'qrview@gmail.com' })).status,
    ).toBe(404);
    await exportRequest(design, multipart(fileOf(PDF_HEAD, 64), fileOf(PNG_HEAD, 64)));
    await runPendingJobs(env);
    expect(
      (await rest.get(`/qrcodes/${design.id}/files/pdf`, { email: 'qrview@gmail.com' })).status,
    ).toBe(200);
    expect(
      (await rest.get(`/qrcodes/${design.id}/files/pdf`, { email: 'noqr@gmail.com' })).status,
    ).toBe(403);
    expect((await rest.get(`/qrcodes/${design.id}/files/pdf`, { email: null })).status).toBe(401);
    expect(
      (await rest.get(`/qrcodes/${design.id}/files/exe`, { email: 'qrview@gmail.com' })).status,
    ).toBe(422);
  });

  test('ekspor: view 403; tanpa bagian png 422; tanpa bagian pdf 422; PDF/PNG palsu 422; If-Match basi 412', async () => {
    const design = await makeDesign();
    const pdf = fileOf(PDF_HEAD, 100);
    const png = fileOf(PNG_HEAD, 100);
    expect((await exportRequest(design, multipart(pdf, png), 'qrview@gmail.com')).status).toBe(403);
    const noPng = await exportRequest(design, multipart(pdf, null));
    expect(noPng.status).toBe(422);
    expect(await jsonOf(noPng)).toMatchObject({ fields: { png: expect.any(String) } });
    const noPdf = await exportRequest(design, multipart(null, png));
    expect(noPdf.status).toBe(422);
    expect(await jsonOf(noPdf)).toMatchObject({ fields: { pdf: expect.any(String) } });
    const fake = await exportRequest(design, multipart(new Uint8Array([1, 2, 3]), png));
    expect(fake.status).toBe(422);
    const stale = await exportRequest(
      design,
      multipart(pdf, png),
      'qredit@gmail.com',
      '2020-01-01T00:00:00.000Z',
    );
    expect(stale.status).toBe(412);
    expect(await jsonOf(stale)).toMatchObject({ code: 'CONFLICT' });
    expect(
      (await exportRequest(design, multipart(pdf, png), 'qredit@gmail.com', null)).status,
    ).toBe(422);
  });

  test('total PDF+PNG di atas 8 MB -> 422 pada pdf; badan jauh di atas batas -> 413 dan aliran dihentikan', async () => {
    const design = await makeDesign();
    const big = await exportRequest(
      design,
      multipart(fileOf(PDF_HEAD, 5 * 1024 * 1024), fileOf(PNG_HEAD, 3 * 1024 * 1024 + 100)),
    );
    expect(big.status).toBe(422);
    expect(await jsonOf(big)).toMatchObject({
      fields: { pdf: 'Ukuran hasil ekspor maksimal 8 MB' },
    });

    const chunk = new Uint8Array(512 * 1024);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 60) return controller.close(); // 30 MB bila dibaca semuanya
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const response = await rest.send('POST', `/qrcodes/${design.id}/exports`, {
      email: 'qredit@gmail.com',
      raw: stream as unknown as Uint8Array,
      headers: {
        'content-type': 'multipart/form-data; boundary=xyz',
        'if-match': `"${design.updatedAt}"`,
      },
    });
    expect(response.status).toBe(413);
    expect(await jsonOf(response)).toMatchObject({ detail: 'Ukuran hasil ekspor maksimal 8 MB' });
    expect(pulled).toBeLessThan(30);
  });

  test('Content-Type multipart tanpa boundary -> 400/422 problem+json (bukan 500)', async () => {
    const design = await makeDesign();
    const response = await rest.send('POST', `/qrcodes/${design.id}/exports`, {
      email: 'qredit@gmail.com',
      raw: 'bukan multipart',
      headers: { 'content-type': 'text/plain', 'if-match': `"${design.updatedAt}"` },
    });
    expect([400, 415, 422]).toContain(response.status);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });
});
