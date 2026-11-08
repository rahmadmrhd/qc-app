import { expect, test, vi } from 'vitest';
import { ApiError } from './api-error';
import { createApiClient } from './client';

function respond(body: unknown, init: ResponseInit = {}, contentType = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { headers: { 'content-type': contentType }, ...init });
}

function setup(response: () => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => response());
  return { fetchImpl, api: createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch }) };
}

function lastCall(fetchImpl: ReturnType<typeof setup>['fetchImpl']) {
  const [url, init] = fetchImpl.mock.calls.at(-1) ?? [];
  return { url: String(url), init: init as RequestInit };
}

test('GET dengan query list: jalur, query, tanpa badan dan tanpa header CSRF', async () => {
  const { api, fetchImpl } = setup(() => respond({ items: [], nextCursor: null, total: 0 }));
  await api('handovers.board', { locationIds: ['l1', 'l2'], status: 'done', limit: 3 });
  const { url, init } = lastCall(fetchImpl);
  expect(url).toBe('/api/v1/handovers?locationIds=l1%2Cl2&status=done&limit=3');
  expect(init.method).toBe('GET');
  expect(init.credentials).toBe('same-origin');
  expect(init.body).toBeUndefined();
  expect(init.headers).not.toHaveProperty('X-Requested-With');
});

test('GET tanpa input: jalur saja', async () => {
  const { api, fetchImpl } = setup(() => respond([]));
  await expect(api('brands.list', null)).resolves.toEqual([]);
  expect(lastCall(fetchImpl).url).toBe('/api/v1/brands');
});

test('PUT: id di jalur (di-encode), If-Match bertanda kutip, badan tanpa id dan expectedUpdatedAt, header CSRF', async () => {
  const { api, fetchImpl } = setup(() => respond({ id: 'i1' }));
  await api('items.save', {
    id: 'a/b',
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    brandId: 'b1',
    model: 'X',
    isCountryLock: false,
    aliases: [],
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
    businessUnitIds: ['bu1'],
  });
  const { url, init } = lastCall(fetchImpl);
  expect(url).toBe('/api/v1/items/a%2Fb');
  expect(init.method).toBe('PUT');
  expect(init.headers).toMatchObject({
    'X-Requested-With': 'qc',
    'Content-Type': 'application/json',
    'If-Match': '"2026-10-09T00:00:00.000Z"',
  });
  const body = JSON.parse(String(init.body));
  expect(body).toMatchObject({ brandId: 'b1', model: 'X' });
  expect(body).not.toHaveProperty('id');
  expect(body).not.toHaveProperty('expectedUpdatedAt');
});

test('POST create (tanpa id): jalur koleksi, tanpa If-Match', async () => {
  const { api, fetchImpl } = setup(() => respond({ id: 'b1' }, { status: 201 }));
  await expect(api('brands.save', { name: 'Sony' })).resolves.toEqual({ id: 'b1' });
  const { url, init } = lastCall(fetchImpl);
  expect(url).toBe('/api/v1/brands');
  expect(init.method).toBe('POST');
  expect(init.headers).not.toHaveProperty('If-Match');
  expect(JSON.parse(String(init.body))).toEqual({ name: 'Sony' });
});

test('PATCH: status di badan, id di jalur', async () => {
  const { api, fetchImpl } = setup(() => respond({ id: 'b1' }));
  await api('brands.setStatus', { id: 'b1', status: 'inactive' });
  const { url, init } = lastCall(fetchImpl);
  expect(url).toBe('/api/v1/brands/b1');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(String(init.body))).toEqual({ status: 'inactive' });
});

test('DELETE: tanpa badan, header CSRF, mengembalikan { id }', async () => {
  const { api, fetchImpl } = setup(() => respond({ id: 'r1' }));
  await expect(api('access.roles.delete', { id: 'r1' })).resolves.toEqual({ id: 'r1' });
  const { url, init } = lastCall(fetchImpl);
  expect(url).toBe('/api/v1/roles/r1');
  expect(init.method).toBe('DELETE');
  expect(init.body).toBeUndefined();
  expect(init.headers).toMatchObject({ 'X-Requested-With': 'qc' });
});

const problem = (code: string, status: number, extra: object = {}) =>
  respond(
    {
      type: `urn:qc:problem:${code.toLowerCase()}`,
      title: 't',
      status,
      detail: 'pesan',
      code,
      requestId: 'req1',
      ...extra,
    },
    { status },
    'application/problem+json',
  );

test('problem 409 menjadi ApiError code CONFLICT dengan requestId dan fields', async () => {
  const { api } = setup(() => problem('CONFLICT', 409, { fields: { name: 'Sudah dipakai' } }));
  const error = await api('brands.save', { name: 'X' }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({
    code: 'CONFLICT',
    status: 409,
    message: 'pesan',
    requestId: 'req1',
    fields: { name: 'Sudah dipakai' },
  });
});

test('problem 412 menjadi CONFLICT walau kodenya lain; status tetap 412', async () => {
  const { api } = setup(() => problem('VALIDATION', 412));
  const error = await api('brands.save', { name: 'X' }).catch((e: unknown) => e);
  expect(error).toMatchObject({ code: 'CONFLICT', status: 412 });
  const { api: plain } = setup(() => problem('CONFLICT', 412));
  expect(await plain('brands.save', { name: 'X' }).catch((e: unknown) => e)).toMatchObject({
    code: 'CONFLICT',
    status: 412,
  });
});

test('kode diambil dari body (bukan dari status): 422, 401, 403, 404, 503, 500', async () => {
  for (const [code, status] of [
    ['VALIDATION', 422],
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['UNAVAILABLE', 503],
    ['INTERNAL', 500],
  ] as const) {
    const { api } = setup(() => problem(code, status));
    expect(await api('brands.list', null).catch((e: unknown) => e)).toMatchObject({
      code,
      status,
    });
  }
  // kode dari body menang walau statusnya berbeda
  const { api } = setup(() => problem('CONFLICT', 400));
  expect(await api('brands.list', null).catch((e: unknown) => e)).toMatchObject({
    code: 'CONFLICT',
  });
});

test('galat jaringan menjadi INTERNAL dengan pesan koneksi', async () => {
  const { api } = setup(() => {
    throw new TypeError('Failed to fetch');
  });
  const error = await api('brands.list', null).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({
    code: 'INTERNAL',
    message: 'Tidak dapat menghubungi server. Periksa koneksi Anda.',
    requestId: '-',
  });
  expect((error as Error).cause).toBeInstanceOf(TypeError);
});

test('badan bukan problem (halaman galat proksi) dipetakan dari status', async () => {
  const cases: Array<[number, string]> = [
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [429, 'UNAVAILABLE'],
    [503, 'UNAVAILABLE'],
    [502, 'INTERNAL'],
  ];
  for (const [status, code] of cases) {
    const { api } = setup(() => respond('<html>Bad gateway</html>', { status }, 'text/html'));
    expect(await api('brands.list', null).catch((e: unknown) => e)).toMatchObject({
      code,
      requestId: '-',
    });
  }
});

test('sukses dengan badan bukan JSON menjadi INTERNAL', async () => {
  const { api } = setup(() => respond('<html>', { status: 200 }, 'text/html'));
  expect(await api('brands.list', null).catch((e: unknown) => e)).toMatchObject({
    code: 'INTERNAL',
    message: 'Respons server tidak valid',
  });
});

test('baseUrl ditambahkan di depan /api/v1', async () => {
  const fetchImpl = vi.fn(async (_url: string) => respond([]));
  const api = createApiClient({
    baseUrl: 'https://qc.test/',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  await api('brands.list', null);
  expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://qc.test/api/v1/brands');
});

test('413 polos dari Bun.serve (bukan problem) menjadi VALIDATION "Badan permintaan terlalu besar"', async () => {
  const { api } = setup(() => respond('Payload Too Large', { status: 413 }, 'text/plain'));
  const error = await api('brands.save', { name: 'X' }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({
    code: 'VALIDATION',
    status: 413,
    message: 'Badan permintaan terlalu besar',
    requestId: '-',
  });
});

test('rute handover: setCheck PUT .../checks, cancel POST .../cancel, comment POST .../comments, batch POST /handovers/batch', async () => {
  const { api, fetchImpl } = setup(() => respond({}));
  await api('handovers.setCheck', {
    id: 'h1',
    locationId: 'l1',
    index: 2,
    text: 'A',
    checked: true,
  });
  let call = lastCall(fetchImpl);
  expect([call.init.method, call.url]).toEqual(['PUT', '/api/v1/handovers/h1/checks']);
  expect(JSON.parse(String(call.init.body))).toEqual({
    locationId: 'l1',
    index: 2,
    text: 'A',
    checked: true,
  });
  await api('handovers.cancel', { id: 'h1', locationId: 'l1' });
  call = lastCall(fetchImpl);
  expect([call.init.method, call.url]).toEqual(['POST', '/api/v1/handovers/h1/cancel']);
  await api('handovers.comment', {
    id: 'h1',
    locationId: 'l1',
    quote: '',
    before: '',
    after: '',
    body: 'x',
  });
  expect(lastCall(fetchImpl).url).toBe('/api/v1/handovers/h1/comments');
  await api('handovers.saveBatch', { locationId: 'l1', tasks: [] });
  call = lastCall(fetchImpl);
  expect([call.init.method, call.url]).toEqual(['POST', '/api/v1/handovers/batch']);
  await api('handovers.get', { id: 'h1', locationIds: ['l1', 'l2'] });
  expect(lastCall(fetchImpl).url).toBe('/api/v1/handovers/h1?locationIds=l1%2Cl2');
});

function bytesOfBody(body: BodyInit | null | undefined): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve([...new Uint8Array(reader.result as ArrayBuffer)]);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(body as Blob);
  });
}

test('files.upload: badan mentah (Blob), Content-Type = mime, lebar/tinggi di query, header CSRF', async () => {
  const { api, fetchImpl } = setup(() =>
    respond({ id: 'f1', mime: 'image/png', size: 3, width: 4, height: 5 }),
  );
  const dto = await api('files.upload', {
    mime: 'image/png',
    bytes: new Uint8Array([1, 2, 3]),
    width: 4,
    height: 5,
  });
  expect(dto.id).toBe('f1');
  const { url, init } = lastCall(fetchImpl);
  expect(url).toBe('/api/v1/files?width=4&height=5');
  expect(init.method).toBe('POST');
  expect(init.headers).toMatchObject({ 'Content-Type': 'image/png', 'X-Requested-With': 'qc' });
  expect(init.body).toBeInstanceOf(Blob);
  expect(await bytesOfBody(init.body)).toEqual([1, 2, 3]);
});

test('qrcodes.uploadPdf: Content-Type application/pdf, nama dan replaceDocumentId di query', async () => {
  const { api, fetchImpl } = setup(() => respond({ id: 'd1', name: 'a b.pdf', link: 'x' }));
  await api('qrcodes.uploadPdf', {
    name: 'a b.pdf',
    bytes: new Uint8Array([37, 80, 68, 70, 45]),
    replaceDocumentId: 'd0',
  });
  const { url, init } = lastCall(fetchImpl);
  expect(url).toBe('/api/v1/qrcode-documents?name=a+b.pdf&replaceDocumentId=d0');
  expect(init.headers).toMatchObject({ 'Content-Type': 'application/pdf' });
});

test('qrcodes.export: multipart pdf+png tanpa Content-Type buatan sendiri, If-Match dari expectedUpdatedAt, 202 { jobId }', async () => {
  const { api, fetchImpl } = setup(() => respond({ jobId: 'j1' }, { status: 202 }));
  const out = await api('qrcodes.export', {
    id: 'q1',
    expectedUpdatedAt: '2026-10-16T00:00:00.000Z',
    pdf: new Uint8Array([1]),
    png: new Uint8Array([2, 3]),
  });
  expect(out).toEqual({ jobId: 'j1' });
  const { url, init } = lastCall(fetchImpl);
  expect(url).toBe('/api/v1/qrcodes/q1/exports');
  expect(init.headers).not.toHaveProperty('Content-Type');
  expect(init.headers).toMatchObject({ 'If-Match': '"2026-10-16T00:00:00.000Z"' });
  const form = init.body as FormData;
  expect(form).toBeInstanceOf(FormData);
  expect(await bytesOfBody(form.get('pdf') as Blob)).toEqual([1]);
  expect(await bytesOfBody(form.get('png') as Blob)).toEqual([2, 3]);
});

test('JSON (GET/tulis) memakai cache no-store; unduhan mengikuti kebijakan cache tabelnya (tanpa opsi)', async () => {
  const { api, fetchImpl } = setup(() => respond({ id: 'h1' }));
  await api('handovers.get', { id: 'h1', locationIds: ['l1'] });
  expect(lastCall(fetchImpl).init.cache).toBe('no-store');
  await api('brands.save', { name: 'Sony' });
  expect(lastCall(fetchImpl).init.cache).toBe('no-store');
  const download = setup(
    () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }),
  );
  await download.api('files.get', { id: 'f1' });
  expect(lastCall(download.fetchImpl).init.cache).toBeUndefined();
});

test('files.get: unduhan menjadi { id, mime, bytes } dari Content-Type dan badan mentah', async () => {
  const { api, fetchImpl } = setup(
    () => new Response(new Uint8Array([9, 8, 7]), { headers: { 'content-type': 'image/webp' } }),
  );
  const out = await api('files.get', { id: 'f9' });
  expect(out).toEqual({ id: 'f9', mime: 'image/webp', bytes: new Uint8Array([9, 8, 7]) });
  expect(lastCall(fetchImpl).url).toBe('/api/v1/files/f9');
  expect(lastCall(fetchImpl).init.headers).toMatchObject({ Accept: '*/*' });
});

test('qrcodes.file: nama berkas dari Content-Disposition dan etag dari header ETag', async () => {
  const { api } = setup(
    () =>
      new Response(new Uint8Array([1]), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="a.pdf"; filename*=UTF-8''%C3%A9.pdf`,
          etag: '"v7"',
        },
      }),
  );
  expect(await api('qrcodes.file', { id: 'q1', kind: 'pdf' })).toEqual({
    filename: 'é.pdf',
    mime: 'application/pdf',
    bytes: new Uint8Array([1]),
    etag: 'v7',
  });
});

test('unduhan gagal: badan problem+json dibaca sebagai teks (ApiError), bukan byte', async () => {
  const { api } = setup(() =>
    respond(
      { code: 'NOT_FOUND', detail: 'Berkas tidak ditemukan', requestId: 'r1' },
      { status: 404 },
      'application/problem+json',
    ),
  );
  const error = await api('files.get', { id: 'x' }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code: 'NOT_FOUND', message: 'Berkas tidak ditemukan' });
});
