import path from 'node:path';
import { WEB_DIST_DIR } from './paths';
import { readPngSize } from './png';

/**
 * Anggaran per potongan JS (gzip). Rencana Task 4.2 mulai 500 KB; dinaikkan ke 600 KB karena potongan rute QR
 * (pdf-lib + fontkit + font label, dimuat lazy) terukur ≈ 510 KB gzip. Potongan terbesar berikutnya ≈ 168 KB.
 */
export const MAX_CHUNK_GZIP_BYTES = 600_000;

/** Anggaran total pra-cache service worker, tidak terkompres (PRD PWA NFR-P2). */
export const PRECACHE_BUDGET_BYTES = 5_000_000;

export interface DistFile {
  file: string;
  /** Isi berkas teks; kosong (`''`) untuk berkas biner. */
  text: string;
  gzipBytes: number;
  /** Isi berkas biner (mis. PNG, woff2); tidak ada untuk berkas teks. */
  bytes?: Uint8Array;
}

/** Memeriksa keluaran build web berpotongan; mengembalikan daftar masalah (kosong = lolos). */
export function checkDist(files: DistFile[]): string[] {
  const problems: string[] = [];
  const index = files.find((entry) => entry.file === 'index.html');
  if (!index) {
    problems.push('server/dist/index.html tidak ada');
  } else {
    if (!/<script[^>]+type=["']module["'][^>]+\bsrc=/i.test(index.text)) {
      problems.push('index.html tidak memuat skrip modul utama');
    }
    if (index.text.includes('__QC_BOOT__') || index.text.includes('__BOOT__')) {
      problems.push('index.html masih memuat penanda boot Apps Script');
    }
  }
  if (!files.some((entry) => entry.file.endsWith('.js'))) problems.push('tidak ada potongan JS');
  for (const entry of files) {
    if (entry.file.endsWith('.js')) {
      if (entry.text.includes('mock-secret')) {
        problems.push(`${entry.file}: kode mock backend ikut ter-bundle ke build produksi`);
      }
      if (entry.gzipBytes > MAX_CHUNK_GZIP_BYTES) {
        problems.push(
          `${entry.file}: ${entry.gzipBytes} byte gzip melebihi anggaran ${MAX_CHUNK_GZIP_BYTES}`,
        );
      }
    }
  }
  return problems;
}

const sizeOf = (entry: DistFile): number =>
  entry.bytes?.byteLength ?? Buffer.byteLength(entry.text);

/** Jalur berkas di dist dari `src`/`href` yang diawali `/` (atau tidak). */
const distPath = (reference: string): string => reference.replace(/^\/+/, '');

/** Rute server yang tidak boleh ada di pra-cache (dengan atau tanpa `/` di depan). */
const SERVER_ROUTE = /^\/?(?:api|auth|sync)(?:[/?]|$)/;

/** Rute yang harus tertolak oleh denylist navigasi (FR-P8) dan rute klien yang harus tetap dijawab cangkang. */
const MUST_DENY = [
  '/auth/callback?code=1',
  '/api/ping',
  '/sync',
  '/sw.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];
const MUST_ALLOW = [
  '/',
  '/?authError=x',
  '/handover?x=1',
  '/handover?q=a/b.c',
  '/apiary',
  '/authors',
  '/item/brands/abc',
];

const MANIFEST_FIELDS = [
  'name',
  'short_name',
  'lang',
  'start_url',
  'scope',
  'display',
  'theme_color',
  'background_color',
] as const;

interface ManifestIcon {
  src?: unknown;
  sizes?: unknown;
  purpose?: unknown;
}

/** Ikon wajib FR-P2: ukuran, tujuan (`any` bila `purpose` kosong). */
const REQUIRED_ICONS = [
  { size: 192, purpose: 'any' },
  { size: 512, purpose: 'any' },
  { size: 512, purpose: 'maskable' },
] as const;

function tagsOf(html: string, tag: 'meta' | 'link'): string[] {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) ?? [];
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? '') : null;
}

/** Mengurai larik literal regex (`[/a/,/b/i]`) mulai dari `[` di `start`; `null` bila bentuknya tak dikenali. */
function parseRegexArray(source: string, start: number): RegExp[] | null {
  const patterns: RegExp[] = [];
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === ',' || char === ' ' || char === '\n') {
      i++;
    } else if (char === ']') {
      return patterns;
    } else if (char === '/') {
      let body = '';
      let inClass = false;
      i++;
      for (; i < source.length; i++) {
        const c = source[i] as string;
        if (c === '\\') {
          body += c + (source[i + 1] ?? '');
          i++;
        } else if (c === '[') {
          inClass = true;
          body += c;
        } else if (c === ']') {
          inClass = false;
          body += c;
        } else if (c === '/' && !inClass) {
          break;
        } else {
          body += c;
        }
      }
      i++; // penutup `/`
      let flags = '';
      while (i < source.length && /[a-z]/.test(source[i] as string)) flags += source[i++];
      try {
        patterns.push(new RegExp(body, flags));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  return null;
}

function checkManifest(files: DistFile[], problems: string[]): void {
  const entry = files.find((file) => file.file === 'manifest.webmanifest');
  if (!entry) {
    problems.push('manifest.webmanifest tidak ada di dist');
    return;
  }
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(entry.text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    manifest = parsed as Record<string, unknown>;
  } catch {
    problems.push('manifest.webmanifest bukan JSON objek yang valid');
    return;
  }
  for (const field of MANIFEST_FIELDS) {
    const value = manifest[field];
    if (typeof value !== 'string' || value === '') {
      problems.push(`manifest.webmanifest kurang field ${field}`);
    }
  }
  const icons = Array.isArray(manifest.icons) ? (manifest.icons as ManifestIcon[]) : [];
  for (const required of REQUIRED_ICONS) {
    const declared = `${required.size}x${required.size}`;
    const match = icons.find((icon) => {
      const sizes = typeof icon.sizes === 'string' ? icon.sizes.split(/\s+/) : [];
      const purposes = typeof icon.purpose === 'string' ? icon.purpose.split(/\s+/) : ['any'];
      return sizes.includes(declared) && purposes.includes(required.purpose);
    });
    if (!match || typeof match.src !== 'string') {
      problems.push(`manifest.webmanifest: ikon ${required.size} ${required.purpose} tidak ada`);
      continue;
    }
    const file = distPath(match.src);
    const iconFile = files.find((candidate) => candidate.file === file);
    if (!iconFile) {
      problems.push(`berkas ikon ${file} tidak ada di dist`);
      continue;
    }
    const size = iconFile.bytes ? readPngSize(iconFile.bytes) : null;
    if (!size) {
      problems.push(`berkas ikon ${file} bukan PNG yang valid`);
    } else if (size.width !== required.size || size.height !== required.size) {
      problems.push(
        `berkas ikon ${file} berukuran ${size.width}x${size.height}, manifest menyatakan ${declared}`,
      );
    }
  }
}

function checkIndexHtml(files: DistFile[], problems: string[]): void {
  const index = files.find((file) => file.file === 'index.html');
  if (!index) return; // sudah dilaporkan `checkDist`
  const links = tagsOf(index.text, 'link');
  const manifests = links.filter((tag) => attr(tag, 'rel')?.toLowerCase() === 'manifest');
  if (manifests.length !== 1) {
    problems.push(`index.html harus memuat tepat satu rel="manifest" (ada ${manifests.length})`);
  }
  const themeColors = tagsOf(index.text, 'meta').filter(
    (tag) => attr(tag, 'name') === 'theme-color' && attr(tag, 'media') !== null,
  );
  if (themeColors.length < 2) {
    problems.push(
      `index.html kurang meta theme-color bermedia terang/gelap (ada ${themeColors.length}, perlu 2)`,
    );
  }
  const apple = links.find((tag) => attr(tag, 'rel')?.toLowerCase() === 'apple-touch-icon');
  const href = apple ? attr(apple, 'href') : null;
  if (!href) {
    problems.push('index.html tidak memuat link apple-touch-icon');
    return;
  }
  const file = files.find((candidate) => candidate.file === distPath(href));
  const size = file?.bytes ? readPngSize(file.bytes) : null;
  if (!file) {
    problems.push(`berkas apple-touch-icon ${distPath(href)} tidak ada di dist`);
  } else if (size?.width !== 180 || size.height !== 180) {
    problems.push(
      `apple-touch-icon ${distPath(href)} harus PNG 180x180 (ada ${size ? `${size.width}x${size.height}` : 'bukan PNG'})`,
    );
  }
}

/** Skrip klasik yang diimpor sw.js lewat `workbox.importScripts` (sama dengan `pwa-config.ts`). */
const IMPORTED_SCRIPTS = ['push-sw.js', 'sync-sw.js'];

function checkServiceWorker(files: DistFile[], problems: string[]): void {
  const sw = files.find((file) => file.file === 'sw.js');
  if (!sw) {
    problems.push('sw.js tidak ada di dist');
    return;
  }
  // Daftar pra-cache (FR-P6, NFR-P2, NFR-P3).
  const urls = [...sw.text.matchAll(/\burl:"([^"]+)"/g)].map((match) => match[1] as string);
  const normalized = urls.map(distPath);
  if (!normalized.includes('index.html')) {
    problems.push('sw.js: daftar pra-cache tidak memuat index.html');
  }
  // Skrip impor (`workbox.importScripts`, pwa-config.ts): ada di dist, diimpor sw.js, dan tak ikut pra-cache.
  const imported = [...sw.text.matchAll(/importScripts\(([^)]*)\)/g)].flatMap((call) =>
    [...(call[1] ?? '').matchAll(/["']([^"']+)["']/g)].map((arg) => arg[1] as string),
  );
  for (const script of IMPORTED_SCRIPTS) {
    if (!files.some((file) => file.file === script)) {
      problems.push(`${script} tidak ada di dist (diimpor service worker)`);
    }
    if (!imported.includes(script)) {
      problems.push(`sw.js: ${script} tidak diimpor (importScripts)`);
    }
    if (normalized.includes(script)) {
      problems.push(`sw.js: pra-cache memuat ${script} (skrip impor tidak boleh dipra-cache)`);
    }
  }
  let total = 0;
  for (const url of urls) {
    if (SERVER_ROUTE.test(url)) {
      problems.push(`sw.js: pra-cache memuat rute server ${url} (/api, /auth, /sync dilarang)`);
      continue;
    }
    const file = files.find((candidate) => candidate.file === distPath(url));
    if (!file) {
      problems.push(`sw.js: pra-cache menyebut ${distPath(url)} yang tidak ada di dist`);
    } else {
      total += sizeOf(file);
    }
  }
  if (total > PRECACHE_BUDGET_BYTES) {
    problems.push(
      `sw.js: total pra-cache ${total} byte melebihi anggaran ${PRECACHE_BUDGET_BYTES} byte`,
    );
  }
  // Denylist navigasi (FR-P8): rute server tidak pernah dijawab index.html, rute klien tetap.
  const at = sw.text.indexOf('denylist:[');
  const denylist = at === -1 ? null : parseRegexArray(sw.text, at + 'denylist:'.length);
  if (!denylist) {
    problems.push('sw.js: denylist navigasi tidak ditemukan atau tidak terbaca');
  } else {
    for (const route of MUST_DENY) {
      if (!denylist.some((pattern) => pattern.test(route))) {
        problems.push(`sw.js: denylist navigasi tidak mencocokkan ${route}`);
      }
    }
    for (const route of MUST_ALLOW) {
      if (denylist.some((pattern) => pattern.test(route))) {
        problems.push(
          `sw.js: denylist navigasi menolak rute klien ${route} (harus dijawab cangkang)`,
        );
      }
    }
  }
  // Pembaruan atas persetujuan (FR-P12): skipWaiting hanya lewat pesan SKIP_WAITING.
  const skipWaiting = sw.text.split('skipWaiting').length - 1;
  if (skipWaiting !== 1) {
    problems.push(
      `sw.js: skipWaiting muncul ${skipWaiting} kali (harus tepat sekali, di dalam penangan pesan SKIP_WAITING)`,
    );
  }
  if (!sw.text.includes('SKIP_WAITING')) {
    problems.push('sw.js: penangan pesan SKIP_WAITING tidak ada');
  }
}

/** Memeriksa bagian PWA keluaran build (manifest, ikon, tag HTML, sw.js); kosong = lolos. */
export function checkPwa(files: DistFile[]): string[] {
  const problems: string[] = [];
  checkManifest(files, problems);
  checkIndexHtml(files, problems);
  checkServiceWorker(files, problems);
  return problems;
}

if (import.meta.main) {
  const files: DistFile[] = [];
  for await (const file of new Bun.Glob('**/*').scan({ cwd: WEB_DIST_DIR })) {
    const name = file.replaceAll('\\', '/');
    const full = path.join(WEB_DIST_DIR, file);
    if (/\.(png|woff2)$/.test(name)) {
      const bytes = new Uint8Array(await Bun.file(full).arrayBuffer());
      files.push({ file: name, text: '', gzipBytes: Bun.gzipSync(bytes).byteLength, bytes });
    } else if (/\.(html|js|css|svg|webmanifest)$/.test(name)) {
      const text = await Bun.file(full).text();
      files.push({ file: name, text, gzipBytes: Bun.gzipSync(text).byteLength });
    }
  }
  const problems = [...checkDist(files), ...checkPwa(files)];
  if (problems.length > 0) {
    console.error(`verify-dist gagal:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  const js = files.filter((entry) => entry.file.endsWith('.js'));
  const largest = Math.max(0, ...js.map((entry) => entry.gzipBytes));
  console.log(`verify-dist OK (${js.length} potongan JS, terbesar ${largest} byte gzip)`);
}
