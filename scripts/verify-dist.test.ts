import { describe, expect, test } from 'bun:test';
import {
  checkDist,
  checkPwa,
  type DistFile,
  MAX_CHUNK_GZIP_BYTES,
  PRECACHE_BUDGET_BYTES,
} from './verify-dist';

const html: DistFile = {
  file: 'index.html',
  text: '<html><script type="module" crossorigin src="/assets/index-abc.js"></script></html>',
  gzipBytes: 100,
};
const js = (name: string, text = 'ok', gzipBytes = 1000): DistFile => ({
  file: `assets/${name}`,
  text,
  gzipBytes,
});

describe('checkDist', () => {
  test('keluaran berpotongan yang sehat lolos', () => {
    expect(checkDist([html, js('index-abc.js'), js('route-x.js')])).toEqual([]);
  });
  test('tanpa index.html atau tanpa JS gagal', () => {
    expect(checkDist([js('a.js')])).toContain('server/dist/index.html tidak ada');
    expect(checkDist([html]).join()).toContain('tidak ada potongan JS');
  });
  test('penanda boot Apps Script dan kode mock ditolak', () => {
    const bad = { ...html, text: `${html.text}<script>window.__BOOT__='__QC_BOOT__'</script>` };
    expect(checkDist([bad, js('a.js')]).join()).toContain('penanda boot');
    expect(checkDist([html, js('a.js', 'const k="mock-secret"')]).join()).toContain('mock');
  });
  test('potongan melebihi anggaran gzip ditolak per potongan', () => {
    const problems = checkDist([
      html,
      js('besar.js', 'x', MAX_CHUNK_GZIP_BYTES + 1),
      js('kecil.js'),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('besar.js');
  });
});

// --- checkPwa (FR-P6, P8, P10; NFR-P2, P3) -------------------------------------------------------------------

/** PNG minimal: tanda tangan + IHDR (cukup untuk `readPngSize`). */
function pngOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const binary = (file: string, bytes: Uint8Array): DistFile => ({
  file,
  text: '',
  gzipBytes: bytes.byteLength,
  bytes,
});

const textFile = (file: string, body: string): DistFile => ({
  file,
  text: body,
  gzipBytes: body.length,
});

const MANIFEST = {
  name: 'QC App',
  short_name: 'QC',
  lang: 'id',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: '#ffffff',
  background_color: '#ffffff',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: '/icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

const INDEX_HTML = `<!doctype html><html><head>
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a">
<script type="module" crossorigin src="/assets/index-abc.js"></script>
<link rel="manifest" href="/manifest.webmanifest">
</head></html>`;

const DENYLIST = String.raw`[/^\/api(?:[/?]|$)/,/^\/auth(?:[/?]|$)/,/^\/sync(?:[/?]|$)/,/^[^?]*\/[^/?]+\.[^/?]+(?:\?|$)/]`;

/** Bentuk `sw.js` hasil `generateSW` (diperkecil) dengan daftar pra-cache dan denylist yang dapat diganti. */
function swOf(
  options: {
    urls?: string[];
    denylist?: string;
    extra?: string;
    handler?: boolean;
    imports?: string[];
  } = {},
): string {
  const urls = options.urls ?? [
    'index.html',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon-180.png',
    'assets/index-abc.js',
    'manifest.webmanifest',
  ];
  const entries = urls.map((url) => `{url:"${url}",revision:null}`).join(',');
  const handler =
    options.handler === false
      ? ''
      : 'self.addEventListener("message",s=>{s.data&&"SKIP_WAITING"===s.data.type&&self.skipWaiting()}),';
  const denylist = options.denylist ?? DENYLIST;
  // Skrip impor Workbox (`workbox.importScripts`) muncul sebagai pemanggilan `importScripts("...")` di awal sw.js.
  const imports = options.imports ?? ['push-sw.js', 'sync-sw.js'];
  const importCall =
    imports.length > 0 ? `importScripts(${imports.map((name) => `"${name}"`).join(',')});` : '';
  return `${importCall}define(["./workbox-1"],function(s){"use strict";${handler}s.clientsClaim(),s.precacheAndRoute([${entries}],{}),s.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:${denylist}}))${options.extra ?? ''}});`;
}

function healthyDist(
  overrides: { sw?: string; manifest?: unknown; html?: string; extra?: DistFile[] } = {},
): DistFile[] {
  return [
    textFile('index.html', overrides.html ?? INDEX_HTML),
    textFile('assets/index-abc.js', 'export {}'),
    textFile('sw.js', overrides.sw ?? swOf()),
    textFile('manifest.webmanifest', JSON.stringify(overrides.manifest ?? MANIFEST)),
    textFile('push-sw.js', '(() => {})();'),
    textFile('sync-sw.js', '(() => {})();'),
    binary('icons/icon-192.png', pngOf(192, 192)),
    binary('icons/icon-512.png', pngOf(512, 512)),
    binary('icons/icon-maskable-512.png', pngOf(512, 512)),
    binary('icons/apple-touch-icon-180.png', pngOf(180, 180)),
    ...(overrides.extra ?? []),
  ];
}

const without = (files: DistFile[], name: string) => files.filter((entry) => entry.file !== name);
const replace = (files: DistFile[], next: DistFile) =>
  files.map((entry) => (entry.file === next.file ? next : entry));

describe('checkPwa', () => {
  test('dist PWA yang sehat lolos', () => {
    expect(checkPwa(healthyDist())).toEqual([]);
  });

  test('tanpa sw.js atau manifest.webmanifest', () => {
    expect(checkPwa(without(healthyDist(), 'sw.js')).join()).toContain('sw.js');
    expect(checkPwa(without(healthyDist(), 'manifest.webmanifest')).join()).toContain(
      'manifest.webmanifest',
    );
  });

  test('manifest bukan JSON', () => {
    const files = replace(healthyDist(), textFile('manifest.webmanifest', '{bukan json'));
    expect(checkPwa(files).join()).toContain('bukan JSON');
  });

  test('manifest kurang field FR-P1', () => {
    for (const field of [
      'name',
      'short_name',
      'lang',
      'start_url',
      'scope',
      'display',
      'theme_color',
      'background_color',
    ]) {
      const rest: Record<string, unknown> = { ...MANIFEST };
      delete rest[field];
      const problems = checkPwa(healthyDist({ manifest: rest }));
      expect(problems.join(), field).toContain(field);
    }
  });

  test('ikon wajib: 192, 512, dan 512 maskable ada di manifest', () => {
    const icons = MANIFEST.icons;
    expect(
      checkPwa(healthyDist({ manifest: { ...MANIFEST, icons: icons.slice(1) } })).join(),
    ).toContain('192');
    expect(
      checkPwa(healthyDist({ manifest: { ...MANIFEST, icons: [icons[0], icons[2]] } })).join(),
    ).toContain('512 any');
    expect(
      checkPwa(healthyDist({ manifest: { ...MANIFEST, icons: icons.slice(0, 2) } })).join(),
    ).toContain('maskable');
  });

  test('berkas ikon tidak ada', () => {
    const files = without(healthyDist(), 'icons/icon-512.png');
    expect(checkPwa(files).join()).toContain('icons/icon-512.png');
  });

  test('ukuran PNG nyata berbeda dari deklarasi manifest', () => {
    const files = replace(healthyDist(), binary('icons/icon-192.png', pngOf(144, 144)));
    const problems = checkPwa(files).join();
    expect(problems).toContain('icons/icon-192.png');
    expect(problems).toContain('144');
  });

  test('apple-touch-icon: tag hilang, berkas hilang, atau bukan 180x180', () => {
    const noTag = INDEX_HTML.replace(/<link rel="apple-touch-icon"[^>]*>/, '');
    expect(checkPwa(healthyDist({ html: noTag })).join()).toContain('apple-touch-icon');
    const noFile = without(healthyDist(), 'icons/apple-touch-icon-180.png');
    expect(checkPwa(noFile).join()).toContain('apple-touch-icon');
    const wrong = replace(healthyDist(), binary('icons/apple-touch-icon-180.png', pngOf(192, 192)));
    expect(checkPwa(wrong).join()).toContain('180');
  });

  test('index.html tanpa atau dengan ganda rel="manifest"', () => {
    const none = INDEX_HTML.replace(/<link rel="manifest"[^>]*>/, '');
    expect(checkPwa(healthyDist({ html: none })).join()).toContain('rel="manifest"');
    const twice = INDEX_HTML.replace(
      '</head>',
      '<link rel="manifest" href="/manifest.webmanifest"></head>',
    );
    expect(checkPwa(healthyDist({ html: twice })).join()).toContain('rel="manifest"');
  });

  test('index.html kurang dua theme-color bermedia', () => {
    const one = INDEX_HTML.replace(
      /<meta name="theme-color" media="\(prefers-color-scheme: dark\)"[^>]*>/,
      '',
    );
    expect(checkPwa(healthyDist({ html: one })).join()).toContain('theme-color');
    const noMedia = INDEX_HTML.replaceAll(' media="(prefers-color-scheme: light)"', '').replaceAll(
      ' media="(prefers-color-scheme: dark)"',
      '',
    );
    expect(checkPwa(healthyDist({ html: noMedia })).join()).toContain('theme-color');
  });

  test('daftar pra-cache: wajib memuat index.html dan hanya berkas yang ada di dist', () => {
    const noIndex = swOf({ urls: ['assets/index-abc.js'] });
    expect(checkPwa(healthyDist({ sw: noIndex })).join()).toContain('index.html');
    const ghost = swOf({ urls: ['index.html', 'assets/hantu-abc.js'] });
    expect(checkPwa(healthyDist({ sw: ghost })).join()).toContain('assets/hantu-abc.js');
  });

  test('daftar pra-cache memuat rute server (dengan atau tanpa / di depan)', () => {
    for (const url of ['api/ping', '/api/v1/me', 'auth/login', '/sync', 'sync/x']) {
      const sw = swOf({ urls: ['index.html', url] });
      const problems = checkPwa(healthyDist({ sw })).join();
      expect(problems, url).toContain(url);
    }
  });

  test('berkas bernama mirip rute server (auth-abc.js) tidak dianggap rute server', () => {
    const sw = swOf({ urls: ['index.html', 'assets/auth-abc.js', 'assets/api-x.js'] });
    const extra = [textFile('assets/auth-abc.js', 'x'), textFile('assets/api-x.js', 'x')];
    expect(checkPwa(healthyDist({ sw, extra }))).toEqual([]);
  });

  test('total ukuran berkas pra-cache melebihi anggaran', () => {
    const big = binary('assets/besar.woff2', new Uint8Array(PRECACHE_BUDGET_BYTES + 1));
    const sw = swOf({ urls: ['index.html', 'assets/besar.woff2'] });
    expect(checkPwa(healthyDist({ sw, extra: [big] })).join()).toContain('anggaran');
    const ok = binary('assets/besar.woff2', new Uint8Array(PRECACHE_BUDGET_BYTES - 1_000));
    expect(checkPwa(healthyDist({ sw, extra: [ok] }))).toEqual([]);
  });

  test('denylist navigasi hilang, kosong, atau tidak mencocokkan rute server', () => {
    const empty = swOf({ denylist: '[]' });
    expect(checkPwa(healthyDist({ sw: empty })).join()).toContain('/auth/callback?code=1');
    const missingAuth = swOf({
      denylist: String.raw`[/^\/api(?:[/?]|$)/,/^\/sync(?:[/?]|$)/]`,
    });
    expect(checkPwa(healthyDist({ sw: missingAuth })).join()).toContain('/auth/callback?code=1');
    const noDenylistAtAll = swOf().replace(/\{denylist:.*\}\)\)/, '{})');
    expect(checkPwa(healthyDist({ sw: noDenylistAtAll })).join()).toContain('denylist');
  });

  test('denylist yang mengenai titik di dalam query (/handover?q=a/b.c) ditolak', () => {
    const queryDot = swOf({
      denylist: String.raw`[/^\/api(?:[/?]|$)/,/^\/auth(?:[/?]|$)/,/^\/sync(?:[/?]|$)/,/\/[^/?]+\.[^/]+$/]`,
    });
    expect(checkPwa(healthyDist({ sw: queryDot })).join()).toContain('/handover?q=a/b.c');
  });

  test('denylist berawalan luas (/api tanpa pembatas) menolak rute klien /apiary dan /authors', () => {
    const prefixy = swOf({
      denylist: String.raw`[/^\/api/,/^\/auth/,/^\/sync(?:[/?]|$)/,/^[^?]*\/[^/?]+\.[^/?]+(?:\?|$)/]`,
    });
    const text = checkPwa(healthyDist({ sw: prefixy })).join();
    expect(text).toContain('/apiary');
    expect(text).toContain('/authors');
  });

  test('denylist yang terlalu luas (menolak rute klien) ditolak', () => {
    const greedy = swOf({ denylist: String.raw`[/^\/api/,/^\/auth/,/^\/sync/,/^\/handover/]` });
    expect(checkPwa(healthyDist({ sw: greedy })).join()).toContain('/handover?x=1');
  });

  test('skipWaiting di luar penangan SKIP_WAITING ditolak', () => {
    const topLevel = swOf({ handler: false, extra: ',self.skipWaiting()' });
    expect(checkPwa(healthyDist({ sw: topLevel })).join()).toContain('SKIP_WAITING');
    const twice = swOf({ extra: ',self.skipWaiting()' });
    expect(checkPwa(healthyDist({ sw: twice })).join()).toContain('skipWaiting');
    const noHandler = swOf({ handler: false });
    expect(checkPwa(healthyDist({ sw: noHandler })).join()).toContain('SKIP_WAITING');
  });
  test('skrip impor (push-sw.js, sync-sw.js): berkas hilang, tak diimpor, atau ikut pra-cache ditolak', () => {
    expect(checkPwa(without(healthyDist(), 'sync-sw.js')).join()).toContain('sync-sw.js');
    expect(checkPwa(without(healthyDist(), 'push-sw.js')).join()).toContain('push-sw.js');
    const notImported = swOf({ imports: ['push-sw.js'] });
    expect(checkPwa(healthyDist({ sw: notImported })).join()).toContain(
      'sw.js: sync-sw.js tidak diimpor',
    );
    const inPrecache = swOf({
      urls: [
        'index.html',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon-180.png',
        'assets/index-abc.js',
        'manifest.webmanifest',
        'sync-sw.js',
      ],
    });
    expect(checkPwa(healthyDist({ sw: inPrecache })).join()).toContain(
      'sw.js: pra-cache memuat sync-sw.js',
    );
  });
});
