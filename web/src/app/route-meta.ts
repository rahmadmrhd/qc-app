import type { QueryClient } from '@tanstack/react-query';

/** Lebar isi halaman: formulir sempit, daftar/detail bawaan, kanban atau tabel lebar penuh. */
export type PageWidth = 'narrow' | 'default' | 'full';

export interface CrumbPart {
  label: string;
  to?: string;
  params?: Record<string, string>;
  /** Search param tautan (mis. `loc` Serah Terima) agar crumb membuka halaman dengan cakupan yang sama. */
  search?: Record<string, unknown>;
}

export interface CrumbContext {
  params: Record<string, string>;
  /** Search param rute ini (sudah divalidasi rute). */
  search: Record<string, unknown>;
  queryClient: QueryClient;
}

/** Teks tetap, atau fungsi yang menurunkan bagian crumb (mis. nama record dari cache TanStack Query). */
export type CrumbSpec = string | ((ctx: CrumbContext) => CrumbPart | CrumbPart[] | undefined);

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    crumb?: CrumbSpec;
    pageWidth?: PageWidth;
    /** Halaman bergantung pada lokasi aktif: header ponsel menampilkan baris lokasi (butir 42c). */
    locationAware?: boolean;
  }
}

export const PAGE_WIDTH_CLASS: Record<PageWidth, string> = {
  narrow: 'max-w-4xl',
  default: 'max-w-7xl',
  full: 'max-w-none',
};

interface CrumbMatch {
  staticData?: { crumb?: CrumbSpec };
  params: Record<string, string>;
  search?: Record<string, unknown>;
}

/** Search param yang dibawa crumb butir menu bila rute aktif memilikinya (mis. filter Serah Terima). */
const NAV_SEARCH_KEYS: Record<string, readonly string[]> = { '/handover': ['status', 'loc'] };

/**
 * Susunan breadcrumb: label induk menu (tanpa tautan), butir menu aktif, lalu crumb tiap rute yang cocok
 * dari akar ke daun. Fungsi crumb yang mengembalikan `undefined` dilewati (data belum ada).
 */
export function buildCrumbs(input: {
  trail: { parent: { label: string } | null; item: { label: string; to: string } } | null;
  matches: readonly CrumbMatch[];
  queryClient: QueryClient;
}): CrumbPart[] {
  const parts: CrumbPart[] = [];
  if (input.trail) {
    if (input.trail.parent) parts.push({ label: input.trail.parent.label });
    const keys = NAV_SEARCH_KEYS[input.trail.item.to];
    const current = input.matches[input.matches.length - 1]?.search ?? {};
    const search = keys
      ? Object.fromEntries(
          keys.flatMap((key) => (current[key] === undefined ? [] : [[key, current[key]]])),
        )
      : {};
    parts.push({
      label: input.trail.item.label,
      to: input.trail.item.to,
      ...(Object.keys(search).length > 0 ? { search } : {}),
    });
  }
  for (const match of input.matches) {
    const spec = match.staticData?.crumb;
    if (spec === undefined) continue;
    if (typeof spec === 'string') {
      parts.push({ label: spec });
      continue;
    }
    const result = spec({
      params: match.params,
      search: match.search ?? {},
      queryClient: input.queryClient,
    });
    if (result === undefined) continue;
    parts.push(...(Array.isArray(result) ? result : [result]));
  }
  // Beranda (`/`) tanpa crumb rute: tidak ada breadcrumb (spek §6.4).
  if (parts.length === 1 && parts[0]?.to === '/') return [];
  return parts;
}

/** Lebar dari rute terdalam yang menyatakannya; bawaan `default`. */
export function pageWidthOf(
  matches: readonly { staticData?: { pageWidth?: PageWidth } }[],
): PageWidth {
  for (let i = matches.length - 1; i >= 0; i--) {
    const width = matches[i]?.staticData?.pageWidth;
    if (width) return width;
  }
  return 'default';
}

/** Rute terdalam yang menyatakan `locationAware` menang; bawaan `false`. */
export function locationAwareOf(
  matches: readonly { staticData?: { locationAware?: boolean } }[],
): boolean {
  for (let i = matches.length - 1; i >= 0; i--) {
    const flag = matches[i]?.staticData?.locationAware;
    if (flag !== undefined) return flag;
  }
  return false;
}
