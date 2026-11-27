import { isPhoneViewport } from '@/lib/layout';
import { overlayDepth } from '@/lib/nav-stack';
import { isDesktop } from '@/lib/platform';
import { seedTrail } from '@/lib/stack-nav';
import { routeTree } from '@/routeTree.gen';
import { findNavTrail, NAV_GROUPS } from './navigation';

/**
 * Menyisipkan rantai induk logis untuk tautan dalam (spek redesain butir 41d): halaman dalam yang dibuka tanpa riwayat
 * aplikasi sebelumnya (tab baru, tautan notifikasi push, muat ulang pertama) mendapat entri induk di bawahnya
 * (Beranda, lalu butir menu, lalu detail), sehingga back naik SATU tingkat, bukan keluar aplikasi. Hanya ponsel.
 * Dijalankan sebelum router dibuat (router membaca riwayat saat dibuat). Aman muat ulang: setelah penyisipan entri
 * saat ini ber-`__TSR_index` > 0, jadi tidak disisipi lagi.
 */

const SKIP_PREFIXES = ['/login', '/laporan', '/dashboard-publik', '/auth', '/api', '/country-lock'];

interface RouteNode {
  options: { id: string };
  children?: unknown;
}

function collectRoutePaths(node: RouteNode, underApp: boolean, out: string[]): void {
  const kids = node.children;
  const list: RouteNode[] = Array.isArray(kids)
    ? (kids as RouteNode[])
    : kids && typeof kids === 'object'
      ? (Object.values(kids) as RouteNode[])
      : [];
  const underHere = underApp || node.options.id === '/_app';
  if (underHere && node.options.id !== '/_app') {
    const path = node.options.id.replace(/^\/_app/, '').replace(/\/$/, '');
    out.push(path === '' ? '/' : path);
  }
  for (const child of list) collectRoutePaths(child, underHere, out);
}

/** Pola rute di bawah layout `/_app` (mis. `/item/$itemId`), untuk mengenali awalan jalur yang sah. */
export function appRoutePatterns(): string[] {
  const out: string[] = [];
  collectRoutePaths(routeTree as unknown as RouteNode, false, out);
  return [...new Set(out)];
}

function matchesPattern(path: string, pattern: string): boolean {
  const a = path.split('/');
  const b = pattern.split('/');
  return a.length === b.length && b.every((part, i) => part.startsWith('$') || part === a[i]);
}

const segmentPrefix = (path: string, to: string) =>
  to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);

/**
 * Rantai induk `path` dari Beranda sampai tepat sebelum halaman itu sendiri. Butir menu yang menaungi halaman menjadi
 * induk (kecuali halaman itu sendiri butir menu: induknya Beranda saja), lalu awalan jalur yang sah di bawahnya
 * (mis. detail record sebelum halaman ubah). Kosong untuk Beranda.
 */
export function parentChainFor(path: string, patterns: readonly string[]): string[] {
  if (path === '/') return [];
  const trail = findNavTrail(NAV_GROUPS, (to, fuzzy) =>
    fuzzy ? segmentPrefix(path, to) : path === to,
  );
  const chain = ['/'];
  const base = trail ? (trail.item.to as string) : null;
  if (base && base !== '/' && base !== path) chain.push(base);
  const segments = path.split('/').filter(Boolean);
  const baseDepth = base && base !== '/' ? base.split('/').filter(Boolean).length : 0;
  for (let depth = Math.max(baseDepth, 1) + (base ? 1 : 0); depth < segments.length; depth++) {
    const prefix = `/${segments.slice(0, depth).join('/')}`;
    if (patterns.some((pattern) => matchesPattern(prefix, pattern)) && !chain.includes(prefix)) {
      chain.push(prefix);
    }
  }
  // Detail pencatatan ready: induknya tab Ready Riwayat Gudang, bukan tab bawaan Keluar ke SO.
  if (path.startsWith('/serial/gudang/riwayat/ready/')) {
    // `/riwayat/ready` sendiri bukan halaman (cocok dengan `$orderId`), jadi dibuang dari rantai.
    return chain
      .filter((entry) => entry !== '/serial/gudang/riwayat/ready')
      .map((entry) =>
        entry === '/serial/gudang/riwayat' ? '/serial/gudang/riwayat?tab=ready' : entry,
      );
  }
  return chain;
}

/** Entri riwayat pertama di tab ini (belum ada riwayat aplikasi di belakangnya). */
function isFirstEntry(state: { __TSR_index?: unknown } | null): boolean {
  return state === null || state.__TSR_index === undefined || state.__TSR_index === 0;
}

export function insertParentChain(
  win: Window = window,
  patterns = appRoutePatterns(),
  signedIn = true,
): boolean {
  const history = win.history;
  // Hanya ponsel di peramban dengan sesi sah: Electron (jendela sempit) dan tamu yang akan dialihkan ke login tidak disisipi.
  if (!isPhoneViewport() || isDesktop() || !signedIn) return false;
  // Muat ulang saat overlay terbuka: entri overlay tak berarti lagi; lepas satu langkah dan biarkan router menyesuaikan.
  if (overlayDepth() > 0) {
    history.back();
    return false;
  }
  const state = history.state as { __TSR_index?: unknown } | null;
  if (!isFirstEntry(state)) return false;
  const here = win.location.pathname;
  // Jalur aneh (`//host/...`) dapat berubah menjadi origin lain saat didorong: abaikan.
  if (here.startsWith('//')) return false;
  if (SKIP_PREFIXES.some((prefix) => here === prefix || here.startsWith(`${prefix}/`)))
    return false;
  const chain = parentChainFor(here, patterns);
  if (chain.length === 0) return false;

  const stamp = Date.now();
  const target = `${win.location.pathname}${win.location.search}${win.location.hash}`;
  const entry = (index: number) => ({
    key: `chain-${stamp}-${index}`,
    __TSR_key: `chain-${stamp}-${index}`,
    __TSR_index: index,
  });
  // Entri pertama menggantikan entri saat ini (jadi Beranda), sisanya didorong; halaman asli di paling atas.
  try {
    history.replaceState(entry(0), '', chain[0]);
    seedTrail(0, chain[0] as string);
    chain.slice(1).forEach((path, i) => {
      history.pushState(entry(i + 1), '', path);
      seedTrail(i + 1, path);
    });
    history.pushState(entry(chain.length), '', target);
    seedTrail(chain.length, here);
  } catch {
    // Gagal di tengah: pulihkan alamat semula agar boot tetap jalan (tanpa rantai).
    try {
      history.replaceState(null, '', target);
    } catch {
      // abaikan
    }
    return false;
  }
  return true;
}
