import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatalogStatus } from '@countrylock/bridge-contract';
import type { DesktopCatalogDto } from '@shared/desktop-catalog';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createCatalogStore } from './catalog-store';
import { createCatalogSync } from './catalog-sync';

const SERVER = 'https://qc.test';
const TOKEN = 't'.repeat(40);
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function catalogOf(files: { id: string; size: number }[], items = 1): DesktopCatalogDto {
  return {
    version: 1,
    items: Array.from({ length: items }, (_, index) => ({
      id: `i${index}`,
      brand: 'Acme',
      model: `AP-${index}`,
      aliases: [],
      businessUnits: [],
      stickerIds: [],
      stickerPhotos: files.map((file) => ({
        guideId: file.id,
        guideName: 'Depan',
        width: 10,
        height: 10,
        caption: '',
        buId: null,
        marks: [],
      })),
    })),
    stickerTypes: [],
    stickers: [],
    files: files.map((file) => ({ id: file.id, mime: 'image/png', size: file.size })),
  };
}

interface Call {
  url: string;
  headers: Record<string, string>;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qc-catalog-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function setup(
  respond: (url: string, call: Call) => Response | Promise<Response>,
  options: { token?: string | null } = {},
) {
  const calls: Call[] = [];
  const statuses: CatalogStatus[] = [];
  const store = createCatalogStore(dir);
  const sync = createCatalogSync({
    store,
    settings: () => ({ packageDir: null, serverUrl: SERVER }),
    token: options.token === undefined ? TOKEN : options.token,
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      const call = { url: String(input), headers: (init?.headers ?? {}) as Record<string, string> };
      calls.push(call);
      return respond(call.url, call);
    }) as typeof fetch,
    now: () => Date.parse('2026-11-16T10:00:00.000Z'),
    onStatus: (status) => statuses.push(status),
  });
  return { sync, store, calls, statuses };
}

const json = (catalog: DesktopCatalogDto, etag = 'abc123'): Response =>
  new Response(JSON.stringify(catalog), { status: 200, headers: { etag: `"${etag}"` } });

describe('createCatalogSync', () => {
  test('tanpa token: disabled, tidak menyentuh jaringan', async () => {
    const { sync, calls } = setup(() => new Response('x'), { token: null });
    expect(sync.status().state).toBe('disabled');
    expect((await sync.refresh()).state).toBe('disabled');
    expect(calls).toHaveLength(0);
  });

  test('sinkron pertama: unduh potret + berkas, simpan atomik, token hanya di header Authorization', async () => {
    const catalog = catalogOf([{ id: 'g1', size: PNG.length }]);
    const { sync, store, calls } = setup((url) =>
      url.endsWith('/api/desktop/catalog')
        ? json(catalog)
        : new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    const status = await sync.refresh();
    expect(status).toEqual({
      state: 'ok',
      itemCount: 1,
      syncedAt: '2026-11-16T10:00:00.000Z',
      error: null,
    });
    expect(calls.map((call) => call.url)).toEqual([
      `${SERVER}/api/desktop/catalog`,
      `${SERVER}/api/desktop/catalog/files/g1`,
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(TOKEN);
    }
    expect(store.read()?.etag).toBe('abc123');
    expect(store.readFile('g1')).toEqual({ data: Buffer.from(PNG), mime: 'image/png' });
    // Status yang dikirim ke renderer tidak memuat token.
    expect(JSON.stringify(sync.status())).not.toContain(TOKEN);
  });

  test('304: potret sama, berkas yang masih utuh tidak diunduh ulang, waktu sinkron diperbarui', async () => {
    const catalog = catalogOf([{ id: 'g1', size: PNG.length }]);
    const first = setup((url) =>
      url.endsWith('/api/desktop/catalog') ? json(catalog) : new Response(PNG),
    );
    await first.sync.refresh();
    const second = setup((url, call) => {
      expect(url).toBe(`${SERVER}/api/desktop/catalog`);
      expect(call.headers['If-None-Match']).toBe('"abc123"');
      return new Response(null, { status: 304 });
    });
    const status = await second.sync.refresh();
    expect(status.state).toBe('ok');
    expect(second.calls).toHaveLength(1);
  });

  test('304 tetapi berkas hilang dari disk: diunduh ulang', async () => {
    const catalog = catalogOf([{ id: 'g1', size: PNG.length }]);
    const first = setup((url) =>
      url.endsWith('/api/desktop/catalog') ? json(catalog) : new Response(PNG),
    );
    await first.sync.refresh();
    rmSync(join(dir, 'files', 'g1'));
    const second = setup((url) =>
      url.endsWith('/api/desktop/catalog')
        ? new Response(null, { status: 304 })
        : new Response(PNG),
    );
    expect((await second.sync.refresh()).state).toBe('ok');
    expect(second.calls.map((call) => call.url)).toEqual([
      `${SERVER}/api/desktop/catalog`,
      `${SERVER}/api/desktop/catalog/files/g1`,
    ]);
  });

  test('unduhan terpotong (ukuran beda): katalog lama tetap, status error UNAVAILABLE', async () => {
    const good = catalogOf([{ id: 'g1', size: PNG.length }]);
    const first = setup((url) =>
      url.endsWith('/api/desktop/catalog') ? json(good, 'v1') : new Response(PNG),
    );
    await first.sync.refresh();

    const next = catalogOf([{ id: 'g2', size: 100 }], 2);
    const second = setup((url) =>
      url.endsWith('/api/desktop/catalog') ? json(next, 'v2') : new Response(PNG),
    );
    const status = await second.sync.refresh();
    expect(status.state).toBe('error');
    expect(status.error).toBe('UNAVAILABLE');
    // Potret terakhir yang baik tetap dipakai; berkas lamanya tidak dibuang.
    expect(second.store.read()?.etag).toBe('v1');
    expect(second.store.readFile('g1')).not.toBeNull();
    expect(readdirSync(join(dir, 'files')).some((name) => name.endsWith('.part'))).toBe(false);
  });

  test('potret baru membuang berkas yang tak dirujuk lagi', async () => {
    const first = setup((url) =>
      url.endsWith('/api/desktop/catalog')
        ? json(catalogOf([{ id: 'g1', size: PNG.length }]), 'v1')
        : new Response(PNG),
    );
    await first.sync.refresh();
    const second = setup((url) =>
      url.endsWith('/api/desktop/catalog')
        ? json(catalogOf([{ id: 'g2', size: PNG.length }]), 'v2')
        : new Response(PNG),
    );
    await second.sync.refresh();
    expect(readdirSync(join(dir, 'files'))).toEqual(['g2']);
  });

  test('404/401/403 = REJECTED; 5xx/429/jaringan = UNAVAILABLE', async () => {
    for (const [status, expected] of [
      [404, 'REJECTED'],
      [401, 'REJECTED'],
      [403, 'REJECTED'],
      [503, 'UNAVAILABLE'],
      [429, 'UNAVAILABLE'],
    ] as const) {
      const { sync } = setup(() => new Response('x', { status }));
      expect((await sync.refresh()).error, String(status)).toBe(expected);
    }
    const net = setup(() => {
      throw new Error('jaringan');
    });
    expect((await net.sync.refresh()).error).toBe('UNAVAILABLE');
  });

  test('respons salah isi/versi lain/id berkas tak aman ditolak dan tidak menimpa cache', async () => {
    for (const body of [
      'bukan json',
      JSON.stringify({ version: 2, items: [], stickerTypes: [], stickers: [], files: [] }),
      JSON.stringify({
        ...catalogOf([]),
        files: [{ id: '../../x', mime: 'image/png', size: 1 }],
      }),
    ]) {
      const { sync, store } = setup(
        () => new Response(body, { status: 200, headers: { etag: '"e"' } }),
      );
      expect((await sync.refresh()).state).toBe('error');
      expect(store.read()).toBeNull();
    }
  });

  test('berkas dengan mime bukan gambar ditolak', async () => {
    const catalog = catalogOf([{ id: 'g1', size: 3 }]);
    const bad = { ...catalog, files: [{ id: 'g1', mime: 'text/html', size: 3 }] };
    const { sync, store } = setup((url) =>
      url.endsWith('/api/desktop/catalog') ? json(bad) : new Response('abc'),
    );
    expect((await sync.refresh()).state).toBe('error');
    expect(store.read()).toBeNull();
  });

  test('sinkron serentak berbagi satu permintaan', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sync, calls } = setup(async () => {
      await gate;
      return json(catalogOf([]));
    });
    const a = sync.refresh();
    const b = sync.refresh();
    release?.();
    await Promise.all([a, b]);
    expect(calls).toHaveLength(1);
  });

  test('cache rusak (JSON/bentuk salah) dianggap tak ada, bukan galat', () => {
    const store = createCatalogStore(dir);
    writeFileSync(join(dir, 'catalog.json'), '{rusak');
    expect(store.read()).toBeNull();
    writeFileSync(
      join(dir, 'catalog.json'),
      JSON.stringify({ catalog: {}, etag: 'x', syncedAt: 'y' }),
    );
    expect(store.read()).toBeNull();
    expect(store.readFile('../x')).toBeNull();
  });
});
