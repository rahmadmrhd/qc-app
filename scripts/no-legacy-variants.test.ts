import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { stripComments } from './strip-comments';

// Penutup redesain (spek 2026-11-20 §6.1, rencana fase 4d Task 5): Button, Badge, dan Alert memakai `color` x
// `variant` yang baru. Varian lama shadcn (`default`, `destructive`, `secondary`) sudah tidak ada, dan gaya
// `outline`/`ghost`/`link` wajib menyebut `color` secara eksplisit (tanpa warna bawaan yang tersirat).

const ROOT = join(import.meta.dir, '..');
const SCAN_DIR = 'web/src';
const IGNORED_DIRS = new Set(['node_modules', 'dist']);
/** Folder shadcn (kode salinan, dikecualikan): hanya jalur ini. */
const UI_DIR = 'web/src/components/ui';

/** Komponen yang meneruskan `variant` ke Button/Badge/Alert. `DropdownMenuItem` dsb. punya `variant`-nya sendiri. */
const CHECKED = new Set(['Button', 'Badge', 'Alert', 'AlertDialogAction', 'AlertDialogCancel']);
const LEGACY = ['default', 'destructive', 'secondary'];
const NEED_COLOR = ['outline', 'ghost', 'link'];

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (relative(ROOT, path).split(sep).join('/') === UI_DIR) continue;
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

/** Ujung tag pembuka JSX yang dimulai di `from` (setelah nama): `>` pada kedalaman kurung kurawal 0. */
function tagEnd(source: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && source[i - 1] !== '=') return i;
  }
  return source.length;
}

/** Nilai prop `variant` (apa adanya, termasuk ekspresi `{...}`) atau `null` bila tak ada. */
function variantValue(tag: string): string | null {
  const m = /(?:^|\s)variant=("[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})/.exec(tag);
  return m ? (m[1] ?? null) : null;
}

function literalsIn(value: string): string[] {
  return [...value.matchAll(/["']([a-z]+)["']/g)].map((m) => m[1] as string);
}

function hasColorProp(tag: string): boolean {
  return /(?:^|\s)color=/.test(tag) || /\{\.\.\./.test(tag);
}

function violationsIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g)) {
    if (!CHECKED.has(m[1] as string)) continue;
    const start = (m.index ?? 0) + m[0].length;
    const tag = source.slice(start, tagEnd(source, start));
    const value = variantValue(tag);
    if (value === null) continue;
    const literals = literalsIn(value);
    const line = source.slice(0, m.index).split('\n').length;
    const legacy = literals.find((l) => LEGACY.includes(l));
    if (legacy) out.push(`${m[1]} variant="${legacy}" (baris ${line})`);
    else if (literals.some((l) => NEED_COLOR.includes(l)) && !hasColorProp(tag))
      out.push(`${m[1]} variant="${literals.join('|')}" tanpa color (baris ${line})`);
  }
  // Pemanggilan fungsi kelas: buttonVariants({ variant: 'ghost' }) / badgeVariants(...)
  for (const m of source.matchAll(/\b(?:button|badge)Variants\(\s*\{([^}]*)\}/g)) {
    const body = m[1] ?? '';
    const v = /variant:\s*["']([a-z]+)["']/.exec(body);
    const vname = v?.[1];
    if (!vname) continue;
    const line = source.slice(0, m.index).split('\n').length;
    if (LEGACY.includes(vname)) out.push(`variants() variant "${vname}" (baris ${line})`);
    else if (NEED_COLOR.includes(vname) && !/\bcolor:/.test(body))
      out.push(`variants() variant "${vname}" tanpa color (baris ${line})`);
  }
  return out;
}

test('pemindai mengenali pelanggaran dan lolos pada pemakaian benar', () => {
  expect(violationsIn('<Button variant="destructive" />')).toHaveLength(1);
  expect(violationsIn('<Badge\n  variant="secondary"\n>x</Badge>')).toHaveLength(1);
  expect(violationsIn('<Button variant="ghost" size="icon" />')).toHaveLength(1);
  expect(violationsIn('<Button variant={a ? "ghost" : "outline"} />')).toHaveLength(1);
  expect(violationsIn('<Button variant="ghost" color="primary" />')).toEqual([]);
  expect(violationsIn('<Button variant="solid" />')).toEqual([]);
  expect(violationsIn('<Alert color="destructive" />')).toEqual([]);
  expect(violationsIn('<DropdownMenuItem variant="destructive" />')).toEqual([]);
  expect(violationsIn("buttonVariants({ variant: 'outline' })")).toHaveLength(1);
  expect(violationsIn("buttonVariants({ variant: 'outline', color: 'primary' })")).toEqual([]);
});

test('tak ada pemakai varian lama Button/Badge/Alert di web/src', () => {
  const violations: string[] = [];
  for (const file of walk(join(ROOT, SCAN_DIR))) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const v of violationsIn(source)) violations.push(`${relative(ROOT, file)}: ${v}`);
  }
  expect(violations).toEqual([]);
});
