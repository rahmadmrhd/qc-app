import type { QueryClient } from '@tanstack/react-query';

/** Lebar isi halaman: formulir sempit, daftar/detail bawaan, kanban atau tabel lebar penuh. */
export type PageWidth = 'narrow' | 'default' | 'full';

export interface CrumbPart {
  label: string;
  to?: string;
  params?: Record<string, string>;
}

export interface CrumbContext {
  params: Record<string, string>;
  queryClient: QueryClient;
}

/** Teks tetap, atau fungsi yang menurunkan bagian crumb (mis. nama record dari cache TanStack Query). */
export type CrumbSpec = string | ((ctx: CrumbContext) => CrumbPart | CrumbPart[] | undefined);

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    crumb?: CrumbSpec;
    pageWidth?: PageWidth;
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
}

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
    parts.push({ label: input.trail.item.label, to: input.trail.item.to });
  }
  for (const match of input.matches) {
    const spec = match.staticData?.crumb;
    if (spec === undefined) continue;
    if (typeof spec === 'string') {
      parts.push({ label: spec });
      continue;
    }
    const result = spec({ params: match.params, queryClient: input.queryClient });
    if (result === undefined) continue;
    parts.push(...(Array.isArray(result) ? result : [result]));
  }
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
