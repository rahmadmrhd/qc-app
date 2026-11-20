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
import { createUiBundleManager, readBaselineCreatedAt, type UiBundleDeps } from './ui-bundle';

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
    const prefix = '/api/desktop/ui-file/';
    const path = url.startsWith(prefix)
      ? decodeURIComponent(url.slice(prefix.length))
      : '\0tak-ada';
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

describe('identitas aplikasi (kunci publik dan versi jembatan) pada state.json (M6 b/c)', () => {
  /** Unduh, terapkan, lalu kembalikan versinya. */
  async function activateV1(over: Partial<UiBundleDeps> = {}): Promise<string> {
    current = build(BASE_FILES);
    const m = manager(over);
    await m.checkForUpdate();
    expect(m.applyReady()).toBe(true);
    return current.uiVersion;
  }

  test('state.json mencatat sidik kunci publik (bukan kuncinya) dan versi jembatan', async () => {
    await activateV1();
    const raw = readFileSync(join(dir, 'state.json'), 'utf8');
    const state = JSON.parse(raw) as { keyId: string; bridgeVersion: number };
    expect(state.keyId).toBe(sha(KEYS.publicPem.trim()));
    expect(state.bridgeVersion).toBe(2);
    expect(raw).not.toContain('BEGIN PUBLIC KEY');
  });

  test('identitas sama: bundel aktif tetap dipakai pada peluncuran berikutnya', async () => {
    const v = await activateV1();
    expect(manager().activeRoot()).toBe(join(dir, 'versions', v));
  });

  test('kunci publik berganti di rilis aplikasi baru: kembali ke UI dasar dan bundel lama dibuang', async () => {
    const v = await activateV1();
    const m = manager({ publicKeyPem: OTHER_KEYS.publicPem });
    expect(m.activeRoot()).toBe(baseline);
    expect(versionsOnDisk()).toEqual([]);
    expect(existsSync(join(dir, 'versions', v))).toBe(false);
    // keadaan tersimpan sudah memakai identitas baru: peluncuran berikutnya tak mengulang
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as {
      active: string | null;
      keyId: string;
    };
    expect(state.active).toBeNull();
    expect(state.keyId).toBe(sha(OTHER_KEYS.publicPem.trim()));
  });

  test('kunci diganti jadi null (pembaruan dimatikan) juga kembali ke dasar', async () => {
    await activateV1();
    expect(manager({ publicKeyPem: null }).activeRoot()).toBe(baseline);
  });

  test('versi jembatan aplikasi berganti: kembali ke dasar, previous dan ready ikut dibuang', async () => {
    const first = await activateV1();
    // bundel kedua jadi aktif (previous = first), lalu bundel ketiga menunggu (ready)
    manifestEtag = '"etag-2"';
    current = build({ ...BASE_FILES, 'index.html': '<html>v2</html>' });
    const m = manager();
    await m.checkForUpdate();
    m.applyReady();
    manifestEtag = '"etag-3"';
    current = build({ ...BASE_FILES, 'index.html': '<html>v3</html>' });
    await m.checkForUpdate();
    expect(m.readyVersion()).not.toBeNull();
    expect(versionsOnDisk()).toContain(first);

    const upgraded = manager({ bridgeVersion: 3 });
    expect(upgraded.activeRoot()).toBe(baseline);
    expect(upgraded.readyVersion()).toBeNull();
    expect(versionsOnDisk()).toEqual([]);
  });

  test('setelah kembali ke dasar, pemeriksaan berikutnya mengunduh ulang (ETag lama dibuang) dan versi bad diberi kesempatan baru', async () => {
    await activateV1();
    const upgraded = manager({ bridgeVersion: 3 });
    requests = [];
    const result = await upgraded.checkForUpdate();
    expect(result.status).toBe('ready');
    expect(requests.some((r) => r.includes('[inm]'))).toBe(false);
  });

  test('state.json lama tanpa identitas dan berisi bundel aktif: kembali ke dasar', async () => {
    const v = await activateV1();
    const file = join(dir, 'state.json');
    const state = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    delete state.keyId;
    delete state.bridgeVersion;
    writeFileSync(file, JSON.stringify(state));
    expect(manager().activeRoot()).toBe(baseline);
    expect(existsSync(join(dir, 'versions', v))).toBe(false);
  });
});

describe('UI dasar yang lebih baru menang (keputusan pemilik 2026-11-20)', () => {
  const OLD = 1_000;
  const BASELINE_AT = 2_000;
  const NEW = 3_000;

  /** Pengubah manifest untuk `build`: menetapkan `createdAt`. */
  const at =
    (createdAt: number) =>
    (manifest: Record<string, unknown>): void => {
      manifest.createdAt = createdAt;
    };

  /** Tulis `ui-manifest.json` UI dasar (isi sama dengan manifest bundel uji; `raw` menimpa isinya). */
  function writeBaselineManifest(createdAt: number, raw?: string): void {
    const built = build(BASE_FILES, { tweak: at(createdAt) });
    writeFileSync(join(baseline, 'ui-manifest.json'), raw ?? JSON.stringify(built.manifest));
  }

  /** Unduh dan terapkan bundel ber-`createdAt` tertentu (saat UI dasar belum punya manifest). */
  async function activate(html: string, createdAt: number): Promise<string> {
    current = build({ ...BASE_FILES, 'index.html': html }, { tweak: at(createdAt) });
    manifestEtag = `"e-${html}"`;
    const m = manager();
    expect((await m.checkForUpdate()).status).toBe('ready');
    expect(m.applyReady()).toBe(true);
    return current.uiVersion;
  }

  const readState = () =>
    JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as {
      active: string | null;
      etag: string | null;
      created: Record<string, number>;
    };

  function stripCreated(): void {
    const file = join(dir, 'state.json');
    const state = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    delete state.created;
    writeFileSync(file, JSON.stringify(state));
  }

  test('readBaselineCreatedAt: manifest sah dibaca, hilang/rusak = null', () => {
    expect(readBaselineCreatedAt(baseline)).toBeNull();
    writeBaselineManifest(BASELINE_AT);
    expect(readBaselineCreatedAt(baseline)).toBe(BASELINE_AT);
    writeBaselineManifest(BASELINE_AT, 'sampah { bukan json');
    expect(readBaselineCreatedAt(baseline)).toBeNull();
  });

  test('bundel aktif yang lebih lama dari UI dasar dibuang saat peluncuran (state dibersihkan)', async () => {
    const v = await activate('<html>lama</html>', OLD);
    expect(readState().created[v]).toBe(OLD);
    writeBaselineManifest(BASELINE_AT);
    const m = manager();
    expect(m.activeRoot()).toBe(baseline);
    expect(readState().active).toBeNull();
    expect(readState().etag).toBeNull();
    expect(versionsOnDisk()).toEqual([]);
  });

  test('bundel aktif yang lebih baru dari UI dasar tetap dipakai', async () => {
    const v = await activate('<html>baru</html>', NEW);
    writeBaselineManifest(BASELINE_AT);
    expect(manager().activeRoot()).toBe(join(dir, 'versions', v));
  });

  test('state lama tanpa catatan created dibuang bila UI dasar punya manifest', async () => {
    await activate('<html>lama</html>', NEW);
    stripCreated();
    writeBaselineManifest(BASELINE_AT);
    expect(manager().activeRoot()).toBe(baseline);
  });

  test('UI dasar tanpa manifest atau berisi sampah: perilaku lama (bundel dipertahankan, termasuk tanpa created)', async () => {
    const v = await activate('<html>lama</html>', OLD);
    stripCreated();
    expect(manager().activeRoot()).toBe(join(dir, 'versions', v)); // tanpa ui-manifest.json
    writeBaselineManifest(BASELINE_AT, '{ rusak');
    expect(manager().activeRoot()).toBe(join(dir, 'versions', v)); // manifest rusak
  });

  test('previous dan ready yang kalah ikut dibuang', async () => {
    await activate('<html>satu</html>', OLD);
    const keep = await activate('<html>dua</html>', NEW); // aktif = dua, previous = satu
    current = build({ ...BASE_FILES, 'index.html': '<html>tiga</html>' }, { tweak: at(OLD + 1) });
    manifestEtag = '"e-tiga"';
    expect((await manager().checkForUpdate()).status).toBe('ready'); // ready = tiga
    expect(versionsOnDisk()).toHaveLength(3);
    writeBaselineManifest(BASELINE_AT);
    const next = manager();
    expect(next.readyVersion()).toBeNull();
    expect(next.activeRoot()).toBe(join(dir, 'versions', keep));
    expect(versionsOnDisk()).toEqual([keep]);
  });

  test('check: manifest server yang tak lebih baru dari UI dasar = none tanpa mengunduh berkas', async () => {
    writeBaselineManifest(BASELINE_AT);
    current = build(BASE_FILES, { tweak: at(BASELINE_AT) });
    const m = manager();
    const result = await m.checkForUpdate();
    expect(result.status).toBe('none');
    expect(result.reason).toMatch(/UI dasar lebih baru/);
    expect(fileRequests()).toEqual([]);
    expect(m.activeRoot()).toBe(baseline);
    expect(versionsOnDisk()).toEqual([]);
  });

  test('check: manifest server yang lebih baru = ready dan createdAt tercatat di state', async () => {
    writeBaselineManifest(BASELINE_AT);
    current = build(BASE_FILES, { tweak: at(NEW) });
    const m = manager();
    expect((await m.checkForUpdate()).status).toBe('ready');
    expect(readState().created[current.uiVersion]).toBe(NEW);
  });

  test('setelah bundel dibuang, server yang lebih baru diunduh ulang walau ETag-nya sama (tidak macet pada 304)', async () => {
    await activate('<html>lama</html>', OLD); // manifestEtag = "e-<html>lama</html>"
    writeBaselineManifest(BASELINE_AT);
    // Server kini menyajikan bundel yang lebih baru dari UI dasar dengan ETag yang SAMA.
    current = build({ ...BASE_FILES, 'index.html': '<html>baru</html>' }, { tweak: at(NEW) });
    const m = manager();
    expect(m.activeRoot()).toBe(baseline);
    requests = [];
    const result = await m.checkForUpdate();
    expect(result.status).toBe('ready');
    expect(requests.some((r) => r.includes('[inm]'))).toBe(false);
    expect(fileRequests().length).toBeGreaterThan(0);
  });

  test('tanpa bundel dipegang, ETag lama tak dipakai pada peluncuran berikutnya (UI dasar diganti installer lebih lama)', async () => {
    writeBaselineManifest(BASELINE_AT);
    current = build(BASE_FILES, { tweak: at(BASELINE_AT) });
    expect((await manager().checkForUpdate()).status).toBe('none'); // ETag tersimpan
    expect(readState().etag).toBe('"etag-1"');
    // UI dasar diganti installer yang lebih lama, server menyajikan bundel yang kini lebih baru dari UI dasar.
    writeBaselineManifest(OLD);
    requests = [];
    const m = manager();
    expect((await m.checkForUpdate()).status).toBe('ready');
    expect(requests.some((r) => r.includes('[inm]'))).toBe(false);
  });

  describe('rollback server ke build yang tak lebih baru dari UI dasar (keputusan pemilik 2026-11-20)', () => {
    /** Server menyajikan bundel lain (ETag baru) ber-`createdAt` tertentu. */
    function serve(html: string, createdAt: number): void {
      current = build({ ...BASE_FILES, 'index.html': html }, { tweak: at(createdAt) });
      manifestEtag = `"s-${html}"`;
    }
    const readStateFull = () =>
      JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as {
        active: string | null;
        previous: string | null;
        ready: string | null;
      };

    test('bundel aktif dibuang dari state, tetapi sesi berjalan tetap memakai berkasnya', async () => {
      const a = await activate('<html>a</html>', NEW);
      writeBaselineManifest(BASELINE_AT);
      const m = manager();
      expect(m.activeRoot()).toBe(join(dir, 'versions', a));
      serve('<html>rollback</html>', BASELINE_AT);
      requests = [];
      const result = await m.checkForUpdate();
      expect(result.status).toBe('none');
      expect(result.reason).toMatch(/UI dasar lebih baru.*dibuang/);
      expect(fileRequests()).toEqual([]);
      const state = readStateFull();
      expect(state.active).toBeNull();
      expect(state.previous).toBeNull();
      expect(state.ready).toBeNull();
      // Root sesi ini tak berganti di tengah jalan (potongan lazy masih dibaca dari sana).
      expect(m.activeRoot()).toBe(join(dir, 'versions', a));
      expect(existsSync(join(dir, 'versions', a, 'index.html'))).toBe(true);
    });

    test('peluncuran berikutnya memakai UI dasar dan direktori bundel dihapus', async () => {
      const a = await activate('<html>a</html>', NEW);
      writeBaselineManifest(BASELINE_AT);
      const m = manager();
      serve('<html>rollback</html>', BASELINE_AT);
      await m.checkForUpdate();
      const next = manager();
      expect(next.activeRoot()).toBe(baseline);
      expect(existsSync(join(dir, 'versions', a))).toBe(false);
      expect(versionsOnDisk()).toEqual([]);
    });

    test('previous dan ready ikut dibuang', async () => {
      await activate('<html>satu</html>', NEW);
      await activate('<html>dua</html>', NEW + 1); // aktif = dua, previous = satu
      writeBaselineManifest(BASELINE_AT);
      const m = manager();
      serve('<html>tiga</html>', NEW + 2);
      expect((await m.checkForUpdate()).status).toBe('ready'); // ready = tiga
      expect(readStateFull().ready).not.toBeNull();
      serve('<html>rollback</html>', BASELINE_AT);
      expect((await m.checkForUpdate()).reason).toMatch(/dibuang/);
      const state = readStateFull();
      expect([state.active, state.previous, state.ready]).toEqual([null, null, null]);
      expect(manager().activeRoot()).toBe(baseline);
      expect(versionsOnDisk()).toEqual([]);
    });

    test('unduhan berikutnya tidak menghapus berkas bundel yang sedang dipakai sesi', async () => {
      const a = await activate('<html>a</html>', NEW);
      writeBaselineManifest(BASELINE_AT);
      const m = manager();
      serve('<html>rollback</html>', BASELINE_AT);
      await m.checkForUpdate();
      serve('<html>baru</html>', NEW + 9);
      expect((await m.checkForUpdate()).status).toBe('ready');
      expect(existsSync(join(dir, 'versions', a, 'index.html'))).toBe(true);
      expect(m.activeRoot()).toBe(join(dir, 'versions', a));
    });

    test('tanpa bundel dipegang: alasan lama, tak ada yang dibuang, tak melempar', async () => {
      writeBaselineManifest(BASELINE_AT);
      serve('<html>rollback</html>', BASELINE_AT);
      const m = manager();
      const result = await m.checkForUpdate();
      expect(result.status).toBe('none');
      expect(result.reason).toBe('UI dasar lebih baru dari bundel server');
      expect(m.activeRoot()).toBe(baseline);
    });

    test('manifest server lebih baru dari UI dasar: alur unduh normal, bundel yang dipegang tak dibuang', async () => {
      const a = await activate('<html>a</html>', NEW);
      writeBaselineManifest(BASELINE_AT);
      const m = manager();
      serve('<html>lebih-baru</html>', NEW + 5);
      const result = await m.checkForUpdate();
      expect(result.status).toBe('ready');
      expect(readStateFull().active).toBe(a);
      expect(readStateFull().ready).toBe(current?.uiVersion ?? null);
    });
  });
});
