import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicKeyPemOf, signUiManifest } from '@countrylock/ui-manifest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createUiBundleManager, type UiBundleDeps } from './ui-bundle';

const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

function keyPair() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { privatePem, publicPem: publicKeyPemOf(privatePem) };
}
const KEYS = keyPair();
const OTHER_KEYS = keyPair();

interface Built {
  manifest: Record<string, unknown>;
  signature: string;
  files: Map<string, Buffer>;
  uiVersion: string;
}

/** Bangun bundel uji: `files` = isi per jalur; `tweak` mengubah manifest SEBELUM ditandatangani. */
function build(
  files: Record<string, string>,
  opts: { minBridge?: number; tweak?: (m: Record<string, unknown>) => void; key?: string } = {},
): Built {
  const map = new Map<string, Buffer>();
  const entries = Object.keys(files)
    .sort()
    .map((path) => {
      const data = Buffer.from(files[path] ?? '');
      map.set(path, data);
      return { path, sha256: sha(data), size: data.length };
    });
  const uiVersion = sha(entries.map((e) => `${e.path}:${e.sha256}`).join('\n'));
  const manifest: Record<string, unknown> = {
    uiVersion,
    minBridge: opts.minBridge ?? 2,
    files: entries,
    createdAt: Date.now(),
  };
  opts.tweak?.(manifest);
  const signature = signUiManifest(JSON.stringify(manifest), opts.key ?? KEYS.privatePem);
  return { manifest, signature, files: map, uiVersion: manifest.uiVersion as string };
}

const BASE_FILES = { 'index.html': '<html>v1</html>', 'assets/app.js': 'console.log(1)' };

// --- Server palsu --------------------------------------------------------------------------

let server: Server;
let port: number;
let current: Built | null;
let manifestStatus: number;
let tamper: Map<string, Buffer>;
let truncate: string | null;
let requests: string[];
let manifestEtag: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    requests.push(`${req.method} ${url}${req.headers['if-none-match'] ? ' [inm]' : ''}`);
    if (url === '/api/desktop/ui-manifest') {
      if (manifestStatus !== 200 || !current) {
        res.writeHead(manifestStatus);
        res.end('{}');
        return;
      }
      if (req.headers['if-none-match'] === manifestEtag) {
        res.writeHead(304, { ETag: manifestEtag });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ETag: manifestEtag });
      res.end(JSON.stringify({ manifest: current.manifest, signature: current.signature }));
      return;
    }
    const path = decodeURIComponent(url).replace(/^\//, '');
    const body = tamper.get(path) ?? current?.files.get(path);
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (truncate === path) {
      res.writeHead(200, { 'Content-Length': String(body.length) });
      res.write(body.subarray(0, Math.floor(body.length / 2)));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.writeHead(200, { 'Content-Length': String(body.length) });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// --- Peralatan ----------------------------------------------------------------------------

let root: string;
let dir: string;
let baseline: string;
let busy: boolean;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qc-uibundle-'));
  dir = join(root, 'ui');
  baseline = join(root, 'ui-baseline');
  mkdirSync(baseline, { recursive: true });
  writeFileSync(join(baseline, 'index.html'), 'baseline');
  busy = false;
  current = null;
  manifestStatus = 200;
  tamper = new Map();
  truncate = null;
  requests = [];
  manifestEtag = '"etag-1"';
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const manager = (over: Partial<UiBundleDeps> = {}) =>
  createUiBundleManager({
    dir,
    baselineDir: baseline,
    serverUrl: () => `http://127.0.0.1:${port}`,
    publicKeyPem: KEYS.publicPem,
    bridgeVersion: 2,
    isBusy: () => busy,
    ...over,
  });

const fileRequests = () => requests.filter((r) => !r.includes('/api/desktop/ui-manifest'));
const versionsOnDisk = () =>
  existsSync(join(dir, 'versions')) ? readdirSync(join(dir, 'versions')) : [];

describe('checkForUpdate: penolakan (Review Focus 5)', () => {
  test('tanda tangan salah ditolak (kunci lain, atau manifest diubah setelah ditandatangani)', async () => {
    current = build(BASE_FILES, { key: OTHER_KEYS.privatePem });
    const m = manager();
    const result = await m.checkForUpdate();
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/tanda tangan/i);
    expect(fileRequests()).toEqual([]);
    expect(m.activeRoot()).toBe(baseline);
    expect(versionsOnDisk()).toEqual([]);

    // manifest dirusak setelah ditandatangani (mis. hash diganti)
    const good = build(BASE_FILES);
    const files = good.manifest.files as Array<{ sha256: string }>;
    if (files[0]) files[0].sha256 = '0'.repeat(64);
    current = good;
    expect((await manager().checkForUpdate()).status).toBe('rejected');
    expect(fileRequests()).toEqual([]);
  });

  test('hash berkas tak cocok ditolak dan staging dibersihkan', async () => {
    current = build(BASE_FILES);
    tamper.set('assets/app.js', Buffer.from('console.log(9)')); // panjang sama, isi beda
    const m = manager();
    const result = await m.checkForUpdate();
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/hash/i);
    expect(existsSync(join(dir, 'staging'))).toBe(false);
    expect(versionsOnDisk()).toEqual([]);
    expect(m.readyVersion()).toBeNull();
  });

  test('ukuran berkas tak cocok (lebih besar atau lebih kecil) ditolak', async () => {
    current = build(BASE_FILES);
    tamper.set('assets/app.js', Buffer.from('console.log(1);;;;;;;;'));
    expect((await manager().checkForUpdate()).status).toBe('rejected');
    tamper.set('assets/app.js', Buffer.from('x'));
    expect((await manager().checkForUpdate()).status).toBe('rejected');
    expect(existsSync(join(dir, 'staging'))).toBe(false);
  });

  test('path berisi .. atau absolut atau \\ ditolak; tidak ada berkas diminta atau ditulis di luar', async () => {
    const sentinel = join(root, 'luar.txt');
    for (const bad of [
      '../luar.txt',
      '/luar.txt',
      'a\\..\\luar.txt',
      'assets/../../luar.txt',
      'C:/luar.txt',
    ]) {
      requests = [];
      current = build(BASE_FILES, {
        tweak: (m) => {
          const files = m.files as Array<{ path: string; sha256: string; size: number }>;
          files.push({ path: bad, sha256: sha('x'), size: 1 });
          files.sort((a, b) => (a.path < b.path ? -1 : 1));
        },
      });
      const result = await manager().checkForUpdate();
      expect(result.status, bad).toBe('rejected');
      expect(fileRequests(), bad).toEqual([]);
      expect(existsSync(sentinel)).toBe(false);
    }
    expect(versionsOnDisk()).toEqual([]);
  });

  test('minBridge lebih tinggi ditolak dengan reason', async () => {
    current = build(BASE_FILES, { minBridge: 5 });
    const result = await manager({ bridgeVersion: 3 }).checkForUpdate();
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('5');
    expect(result.reason).toMatch(/jembatan/);
    expect(fileRequests()).toEqual([]);
    // minBridge sama dengan versi jembatan diterima
    current = build(BASE_FILES, { minBridge: 3 });
    expect((await manager({ bridgeVersion: 3 }).checkForUpdate()).status).toBe('ready');
  });

  test('bundel tanpa index.html ditolak', async () => {
    current = build({ 'assets/app.js': 'x' });
    expect((await manager().checkForUpdate()).status).toBe('rejected');
    expect(fileRequests()).toEqual([]);
  });
});

describe('checkForUpdate: unduhan', () => {
  test('unduhan terputus di tengah tidak mengubah aktif dan staging dibersihkan', async () => {
    current = build({ ...BASE_FILES, 'assets/besar.js': 'x'.repeat(50_000) });
    truncate = 'assets/besar.js';
    const m = manager();
    const result = await m.checkForUpdate();
    expect(result.status).toBe('error');
    expect(m.activeRoot()).toBe(baseline);
    expect(m.readyVersion()).toBeNull();
    expect(existsSync(join(dir, 'staging'))).toBe(false);
    expect(versionsOnDisk()).toEqual([]);
    // percobaan berikutnya (server pulih) berhasil
    truncate = null;
    expect((await m.checkForUpdate()).status).toBe('ready');
  });

  test('berkas 404 saat unduh = error, bukan penerapan setengah jadi', async () => {
    current = build(BASE_FILES);
    tamper = new Map();
    current.files.delete('assets/app.js');
    const m = manager();
    expect((await m.checkForUpdate()).status).toBe('error');
    expect(versionsOnDisk()).toEqual([]);
  });

  test('sukses = ready; activeRoot baru berganti setelah diterapkan (ui.reload atau peluncuran berikutnya)', async () => {
    current = build(BASE_FILES);
    const m = manager();
    const result = await m.checkForUpdate();
    expect(result).toEqual({ status: 'ready', uiVersion: current.uiVersion });
    // belum berganti di tengah sesi
    expect(m.activeRoot()).toBe(baseline);
    expect(m.readyVersion()).toBe(current.uiVersion);
    expect(readFileSync(join(dir, 'versions', current.uiVersion, 'assets', 'app.js'), 'utf8')).toBe(
      'console.log(1)',
    );
    expect(existsSync(join(dir, 'staging'))).toBe(false);

    // ui.reload()
    expect(m.applyReady()).toBe(true);
    expect(m.activeRoot()).toBe(join(dir, 'versions', current.uiVersion));
    expect(m.readyVersion()).toBeNull();

    // peluncuran berikutnya: manajer baru memakai bundel aktif tersimpan
    expect(manager().activeRoot()).toBe(join(dir, 'versions', current.uiVersion));
  });

  test('bundel ready diterapkan otomatis pada peluncuran berikutnya (manajer baru)', async () => {
    current = build(BASE_FILES);
    const first = manager();
    await first.checkForUpdate();
    expect(first.activeRoot()).toBe(baseline);
    const second = manager();
    expect(second.activeRoot()).toBe(join(dir, 'versions', current.uiVersion));
  });

  test('isBusy true = status busy tanpa mengganti; applyReady menolak saat sibuk', async () => {
    current = build(BASE_FILES);
    const m = manager();
    busy = true;
    expect((await m.checkForUpdate()).status).toBe('busy');
    expect(requests).toEqual([]);
    busy = false;
    await m.checkForUpdate();
    busy = true;
    expect(m.applyReady()).toBe(false);
    expect(m.activeRoot()).toBe(baseline);
    busy = false;
    expect(m.applyReady()).toBe(true);
  });

  test('uiVersion sama dengan aktif = none walau createdAt (byte manifest) berbeda', async () => {
    current = build(BASE_FILES);
    const m = manager();
    await m.checkForUpdate();
    m.applyReady();
    manifestEtag = '"etag-2"';
    current = build(BASE_FILES); // createdAt baru, uiVersion sama
    requests = [];
    const result = await m.checkForUpdate();
    expect(result.status).toBe('none');
    expect(fileRequests()).toEqual([]);
  });

  test('ETag dipakai: permintaan kedua membawa If-None-Match dan 304 = none', async () => {
    current = build(BASE_FILES);
    const m = manager();
    await m.checkForUpdate();
    requests = [];
    const result = await m.checkForUpdate();
    expect(result.status).toBe('none');
    expect(requests).toEqual(['GET /api/desktop/ui-manifest [inm]']);
  });

  test('tanpa manifest (404) = none tanpa galat; 500 atau JSON rusak tidak melempar', async () => {
    manifestStatus = 404;
    expect((await manager().checkForUpdate()).status).toBe('none');
    manifestStatus = 500;
    expect((await manager().checkForUpdate()).status).toBe('error');
    manifestStatus = 200;
    current = null;
    const result = await manager().checkForUpdate();
    expect(['none', 'error', 'rejected']).toContain(result.status);
  });

  test('server mati = error tanpa membocorkan alamat', async () => {
    const result = await manager({ serverUrl: () => 'http://127.0.0.1:1' }).checkForUpdate();
    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain('127.0.0.1');
  });

  test('kunci publik null = none tanpa permintaan (pembaruan dinonaktifkan)', async () => {
    current = build(BASE_FILES);
    const result = await manager({ publicKeyPem: null }).checkForUpdate();
    expect(result.status).toBe('none');
    expect(requests).toEqual([]);
  });

  test('hanya 3 versi terbaru disimpan', async () => {
    const m = manager();
    for (let i = 1; i <= 5; i += 1) {
      current = build({ ...BASE_FILES, 'index.html': `<html>v${i}</html>` });
      manifestEtag = `"e${i}"`;
      expect((await m.checkForUpdate()).status).toBe('ready');
      m.applyReady();
    }
    expect(versionsOnDisk().length).toBeLessThanOrEqual(3);
    expect(versionsOnDisk()).toContain(current?.uiVersion);
  });

  test('pemeriksaan serentak berbagi satu unduhan', async () => {
    current = build(BASE_FILES);
    const m = manager();
    const [a, b] = await Promise.all([m.checkForUpdate(), m.checkForUpdate()]);
    expect(a).toEqual(b);
    expect(fileRequests().filter((r) => r.includes('index.html'))).toHaveLength(1);
  });
});

describe('pemulihan (markLoadFailed / markLoadOk)', () => {
  async function activate(html: string): Promise<{ m: ReturnType<typeof manager>; v: string }> {
    current = build({ ...BASE_FILES, 'index.html': html });
    manifestEtag = `"e-${html}"`;
    const m = manager();
    await m.checkForUpdate();
    m.applyReady();
    return { m, v: current.uiVersion };
  }

  test('dua markLoadFailed kembali ke previous lalu dasar dan menandai bad', async () => {
    const first = await activate('<html>v1</html>');
    const second = await activate('<html>v2</html>');
    const m = second.m;
    expect(m.activeRoot()).toBe(join(dir, 'versions', second.v));

    expect(m.markLoadFailed()).toBe('retry');
    expect(m.activeRoot()).toBe(join(dir, 'versions', second.v)); // belum, baru satu kegagalan
    expect(m.markLoadFailed()).toBe('rolled-back');
    expect(m.activeRoot()).toBe(join(dir, 'versions', first.v));

    expect(m.markLoadFailed()).toBe('retry');
    expect(m.markLoadFailed()).toBe('rolled-back');
    expect(m.activeRoot()).toBe(baseline);
    expect(m.markLoadFailed()).toBe('none'); // dasar tak punya apa-apa lagi untuk dikembalikan

    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as {
      bad: string[];
      active: string | null;
    };
    expect(state.bad).toEqual([second.v, first.v]);
    expect(state.active).toBeNull();
    // keadaan bertahan setelah peluncuran ulang
    expect(manager().activeRoot()).toBe(baseline);
  });

  test('markLoadOk di antaranya mengulang hitungan; kegagalan tak berurutan tidak memicu rollback', async () => {
    const { m, v } = await activate('<html>v1</html>');
    expect(m.markLoadFailed()).toBe('retry');
    m.markLoadOk();
    expect(m.markLoadFailed()).toBe('retry');
    expect(m.activeRoot()).toBe(join(dir, 'versions', v));
  });

  test('versi bad tidak diunduh ulang', async () => {
    const { m, v } = await activate('<html>v1</html>');
    m.markLoadFailed();
    m.markLoadFailed();
    expect(m.activeRoot()).toBe(baseline);
    requests = [];
    manifestEtag = '"e-baru"';
    const result = await m.checkForUpdate();
    expect(result.status).toBe('none');
    expect(result.uiVersion).toBe(v);
    expect(fileRequests()).toEqual([]);
    expect(versionsOnDisk()).toEqual([]);
  });

  test('bundel aktif yang berkasnya hilang saat peluncuran kembali ke dasar', async () => {
    const { v } = await activate('<html>v1</html>');
    rmSync(join(dir, 'versions', v, 'index.html'));
    expect(manager().activeRoot()).toBe(baseline);
  });

  test('state.json rusak = dasar tanpa melempar; tanpa berkas sementara tersisa', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), '{ rusak');
    expect(manager().activeRoot()).toBe(baseline);
    await activate('<html>v1</html>');
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});
