import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetBusyForTests } from '@/app/pwa/busy';
import { ApiError } from './api-error';
import { createApiClient } from './client';
import { XHR_PROGRESS_ON_DESKTOP, xhrSend } from './xhr-upload';

/** XHR palsu: tes memicu progres/hasil sendiri. */
class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  responseType = '';
  status = 0;
  responseText = '';
  aborted = false;
  upload: { onprogress: ((e: ProgressEventInit) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  responseHeaders = 'content-type: application/json\r\n';
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getAllResponseHeaders() {
    return this.responseHeaders;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ loaded, total, lengthComputable });
  }
  finish(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

const fetchStub = vi.fn();

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  fetchStub.mockReset();
  resetBusyForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'qcBridge');
});

const base = { method: 'POST', headers: { 'X-Requested-With': 'qc' }, body: new Blob(['abc']) };

test('xhrSend melaporkan progres bertahap dan mengembalikan status, header, teks', async () => {
  const onUploadProgress = vi.fn();
  const promise = xhrSend('/api/v1/files', { ...base, onUploadProgress });
  const xhr = FakeXhr.last;
  expect(xhr.method).toBe('POST');
  expect(xhr.url).toBe('/api/v1/files');
  expect(xhr.headers).toEqual({ 'X-Requested-With': 'qc' });
  xhr.progress(10, 100);
  xhr.progress(60, 100);
  xhr.progress(100, 100);
  xhr.progress(5, 0, false);
  xhr.finish(201, '{"id":"f1"}');
  const result = await promise;
  expect(onUploadProgress.mock.calls).toEqual([
    [10, 100],
    [60, 100],
    [100, 100],
  ]);
  expect(result.status).toBe(201);
  expect(result.text).toBe('{"id":"f1"}');
  expect(result.headers.get('content-type')).toBe('application/json');
});

test('xhrSend: onerror, timeout, dan abort menjadi ApiError UNAVAILABLE "Tidak ada koneksi"', async () => {
  const a = xhrSend('/x', base);
  FakeXhr.last.onerror?.();
  await expect(a).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'Tidak ada koneksi' });
  const b = xhrSend('/x', base);
  FakeXhr.last.ontimeout?.();
  await expect(b).rejects.toBeInstanceOf(ApiError);
});

test('xhrSend: signal.abort() membatalkan permintaan; signal yang sudah abort ditolak tanpa mengirim', async () => {
  const controller = new AbortController();
  const promise = xhrSend('/x', { ...base, signal: controller.signal });
  const xhr = FakeXhr.last;
  controller.abort();
  expect(xhr.aborted).toBe(true);
  await expect(promise).rejects.toMatchObject({ code: 'UNAVAILABLE' });

  const done = new AbortController();
  done.abort();
  const before = FakeXhr.last;
  await expect(xhrSend('/x', { ...base, signal: done.signal })).rejects.toMatchObject({
    code: 'UNAVAILABLE',
  });
  expect(FakeXhr.last).toBe(before);
});

function client() {
  return createApiClient({ fetchImpl: fetchStub as unknown as typeof fetch });
}

const uploadInput = { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), width: 4, height: 5 };

test('api dengan onUploadProgress memakai XHR di peramban: header sama, progres sampai, DTO terurai', async () => {
  const onUploadProgress = vi.fn();
  const promise = client()('files.upload', uploadInput, { onUploadProgress });
  const xhr = FakeXhr.last;
  expect(fetchStub).not.toHaveBeenCalled();
  expect(xhr.method).toBe('POST');
  expect(xhr.url).toBe('/api/v1/files?width=4&height=5');
  expect(xhr.headers).toMatchObject({
    'Content-Type': 'image/png',
    'X-Requested-With': 'qc',
    Accept: 'application/json',
  });
  expect(xhr.body).toBeInstanceOf(Blob);
  xhr.progress(1, 3);
  xhr.finish(201, JSON.stringify({ id: 'f1', mime: 'image/png', size: 3, width: 4, height: 5 }));
  await expect(promise).resolves.toMatchObject({ id: 'f1' });
  expect(onUploadProgress).toHaveBeenCalledWith(1, 3);
});

test('api XHR: status non-2xx dipetakan errorFromResponse yang sama dengan fetch', async () => {
  const problem = JSON.stringify({
    code: 'VALIDATION',
    detail: 'Format tidak didukung',
    fields: { bytes: 'x' },
  });
  const promise = client()('files.upload', uploadInput, { onUploadProgress: vi.fn() });
  FakeXhr.last.finish(400, problem);
  await expect(promise).rejects.toMatchObject({
    code: 'VALIDATION',
    message: 'Format tidak didukung',
    fields: { bytes: 'x' },
  });
  const tooBig = client()('files.upload', uploadInput, { onUploadProgress: vi.fn() });
  FakeXhr.last.finish(413, '');
  await expect(tooBig).rejects.toMatchObject({ code: 'VALIDATION' });
});

test('api XHR: galat jaringan menjadi UNAVAILABLE dan pembatalan lewat signal', async () => {
  const net = client()('files.upload', uploadInput, { onUploadProgress: vi.fn() });
  FakeXhr.last.onerror?.();
  await expect(net).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'Tidak ada koneksi' });
  const controller = new AbortController();
  const cancelled = client()('files.upload', uploadInput, {
    onUploadProgress: vi.fn(),
    signal: controller.signal,
  });
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});

test('tanpa onUploadProgress tetap fetch', async () => {
  fetchStub.mockResolvedValue(
    new Response(JSON.stringify({ id: 'f1' }), { headers: { 'content-type': 'application/json' } }),
  );
  await client()('files.upload', uploadInput);
  expect(fetchStub).toHaveBeenCalledTimes(1);
});

test('di desktop (XHR_PROGRESS_ON_DESKTOP = false) onUploadProgress tetap lewat fetch', async () => {
  expect(XHR_PROGRESS_ON_DESKTOP).toBe(false);
  (window as unknown as { qcBridge: object }).qcBridge = {};
  fetchStub.mockResolvedValue(
    new Response(JSON.stringify({ id: 'f1' }), { headers: { 'content-type': 'application/json' } }),
  );
  const onUploadProgress = vi.fn();
  await client()('files.upload', uploadInput, { onUploadProgress });
  expect(fetchStub).toHaveBeenCalledTimes(1);
  expect(onUploadProgress).not.toHaveBeenCalled();
});

test('rute unduhan tidak pernah memakai XHR walau onUploadProgress diberikan', async () => {
  fetchStub.mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
  );
  await client()('files.get', { id: 'f1' }, { onUploadProgress: vi.fn() });
  expect(fetchStub).toHaveBeenCalledTimes(1);
});
