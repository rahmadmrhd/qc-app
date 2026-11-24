import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from './strip-comments';

// Aturan project (CLAUDE.md, "Navigasi ponsel"; spek redesain butir 41): riwayat peramban adalah tumpukan layar.
// (1) overlay modal (dialog, alert dialog, sheet, lembar pilihan, mode pilih) menyisipkan satu entri riwayat lewat
// `useBackToClose`; (2) filter/cari/urut/tab memakai `replace`, bukan push; (3) form tulis (rute `new`/`edit`)
// bernavigasi lewat `useStackNavigation` (push/replace/pop), bukan `navigate` mentah.

const ROOT = join(import.meta.dir, '..');
const WEB = join(ROOT, 'web/src');

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.(ts|tsx)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path)) found.push(path);
  }
  return found;
}

const rel = (file: string) => relative(ROOT, file).replaceAll('\\', '/');

/** Teks pemanggilan dari `needle` (mis. `navigate(`) sampai kurung penutup seimbang. */
function callsOf(source: string, needle: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(needle, from);
    if (start === -1) return calls;
    let depth = 0;
    let end = start + needle.length - 1;
    for (let i = end; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    calls.push(source.slice(start, end + 1));
    from = end + 1;
  }
}

/** Satu-satunya berkas yang boleh memakai primitif overlay modal Radix secara langsung (semuanya memasang back). */
const OVERLAY_KIT = [
  'web/src/components/ui/dialog.tsx',
  'web/src/components/ui/alert-dialog.tsx',
  'web/src/components/ui/sheet.tsx',
];

test('overlay modal hanya lewat kit (Dialog/AlertDialog/Sheet) yang memasang useBackToClose', () => {
  const direct: string[] = [];
  for (const file of walk(WEB)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const importsPrimitive =
      /from ['"]radix-ui['"]/.test(source) &&
      /\b(Dialog|AlertDialog)\b\s+as\s+\w+|\b(Dialog|AlertDialog)\b[^;]*from ['"]radix-ui['"]/.test(
        source,
      );
    // Memakai bagian lain primitif (mis. `Cancel`) boleh; yang dilarang adalah merakit `Root` sendiri.
    if (importsPrimitive && /\.Root\b/.test(source) && !OVERLAY_KIT.includes(rel(file))) {
      direct.push(rel(file));
    }
  }
  expect(direct).toEqual([]);
  for (const kit of OVERLAY_KIT) {
    expect(readFileSync(join(ROOT, kit), 'utf8')).toContain('useBackToCloseRoot');
  }
});

test('lembar pilihan combobox dan mode pilih memasang useBackToClose', () => {
  for (const file of [
    'web/src/components/combobox.tsx',
    'web/src/components/data-table/use-long-press-select.ts',
  ]) {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain('useBackToClose(');
  }
});

/** Pengecualian bernama: navigasi `search` tanpa `replace` yang memang sah (kosong: belum ada). */
const SEARCH_PUSH_EXCEPTIONS = new Set<string>([]);

test('navigate yang hanya mengubah search (filter/cari/urut/tab) memakai replace: true', () => {
  const violations: string[] = [];
  for (const file of walk(WEB)) {
    if (rel(file) === 'web/src/hooks/use-stack-navigation.ts') continue;
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const call of callsOf(source, 'navigate(')) {
      const staysOnPage = !/\bto:/.test(call) || /to:\s*['"]\.['"]/.test(call);
      if (/\bsearch:/.test(call) && staysOnPage && !/replace:\s*true/.test(call)) {
        if (!SEARCH_PUSH_EXCEPTIONS.has(rel(file)))
          violations.push(`${rel(file)}: ${call.slice(0, 80)}`);
      }
    }
  }
  expect(violations).toEqual([]);
});

test('rute form tulis (new/edit) bernavigasi lewat useStackNavigation, bukan navigate mentah', () => {
  const violations: string[] = [];
  for (const file of walk(join(WEB, 'routes'))) {
    if (!/\/(new|edit)\.tsx$/.test(file.replaceAll('\\', '/'))) continue;
    const source = stripComments(readFileSync(file, 'utf8'));
    if (/\bnavigate\(/.test(source) || /\buseNavigate\b/.test(source)) violations.push(rel(file));
  }
  expect(violations).toEqual([]);
});

test('setiap useBlocker memakai leaveBlocker (pop berdelta 0 dari overlay tak boleh dihalangi; review nav C1)', () => {
  const offenders: string[] = [];
  for (const file of walk(WEB)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const call of callsOf(source, 'useBlocker(')) {
      if (!call.includes('leaveBlocker(')) offenders.push(rel(file));
    }
  }
  expect(offenders).toEqual([]);
});
