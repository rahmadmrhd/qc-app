import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  layoutMainWidth,
  MAIN_MIN_WIDTH,
  pageScrollbarWidth,
  SIDEBAR_OVERLAY_BELOW,
  VIEWPORT_MD,
} from './layout';

const SRC = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

test('varian CSS touch: memakai ambang viewport dari lib/layout (cermin yang dijaga)', () => {
  const css = readFileSync(path.join(SRC, 'styles.css'), 'utf8');
  expect(css).toContain(`(max-width: ${VIEWPORT_MD - 1}px)`);
  // Selektor varian harus menunjuk `html` (bukan sembarang leluhur): `:where(:not([data-narrow]))` cocok dengan <body> dan membuat wide: selalu aktif.
  expect(css).toContain('@custom-variant narrow (:where(html[data-narrow="true"]) &);');
  expect(css).toContain('@custom-variant wide (:where(html:not([data-narrow="true"])) &);');
});

test('varian CSS sidebar-overlay mencerminkan rentang VIEWPORT_MD..SIDEBAR_OVERLAY_BELOW (rem, tanpa literal 768)', () => {
  const css = readFileSync(path.join(SRC, 'styles.css'), 'utf8');
  expect(css).toContain(
    `@media (width >= ${VIEWPORT_MD / 16}rem) and (width < ${SIDEBAR_OVERLAY_BELOW / 16}rem)`,
  );
});

test('rentang overlay: spacer = rel ikon (3 rem) membuat <main> >= MAIN_MIN_WIDTH pada viewport terkecil', () => {
  const iconRail = 3 * 16;
  expect(VIEWPORT_MD - iconRail).toBeGreaterThanOrEqual(MAIN_MIN_WIDTH);
});

test('rentang overlay dengan scrollbar klasik 17 px: lebar <main> terukur + scrollbar tetap >= MAIN_MIN_WIDTH', () => {
  const iconRail = 3 * 16;
  const scrollbar = 17;
  const innerWidth = VIEWPORT_MD;
  Object.defineProperty(document.documentElement, 'clientWidth', {
    get: () => innerWidth - scrollbar,
    configurable: true,
  });
  const savedWidth = window.innerWidth;
  window.innerWidth = innerWidth;
  try {
    expect(pageScrollbarWidth()).toBe(scrollbar);
    const mainClientWidth = innerWidth - iconRail - scrollbar; // 703: tanpa koreksi akan < 704
    expect(mainClientWidth).toBeLessThan(MAIN_MIN_WIDTH);
    expect(layoutMainWidth(mainClientWidth)).toBeGreaterThanOrEqual(MAIN_MIN_WIDTH);
  } finally {
    Reflect.deleteProperty(document.documentElement, 'clientWidth');
    window.innerWidth = savedWidth;
  }
  // Tak terukur (jsdom: clientWidth 0) = tanpa koreksi.
  expect(pageScrollbarWidth()).toBe(0);
});

test('D1: pada viewport >= VIEWPORT_MD <main> tak pernah < MAIN_MIN_WIDTH, jadi bar fixed ponsel tak pernah menimpa sidebar tersemat', () => {
  const iconRail = 3 * 16;
  const fullSidebar = 16 * 16;
  // Rentang overlay: ruang samping = rel ikon. Mulai SIDEBAR_OVERLAY_BELOW sidebar tersemat memakan lebar penuh.
  for (let viewport = VIEWPORT_MD; viewport < 2560; viewport++) {
    const reserved = viewport < SIDEBAR_OVERLAY_BELOW ? iconRail : fullSidebar;
    expect(viewport - reserved).toBeGreaterThanOrEqual(MAIN_MIN_WIDTH);
  }
});

test('angka ambang 768/704 hanya didefinisikan di lib/layout (tak ada literal lain di sumber)', () => {
  const offenders = sources(SRC)
    .filter((file) => !file.endsWith(path.join('lib', 'layout.ts')))
    .filter((file) => {
      const text = readFileSync(file, 'utf8');
      return (
        text.includes(`(min-width: ${VIEWPORT_MD}px)`) ||
        text.includes(`min-width: ${VIEWPORT_MD}px`) ||
        new RegExp(`MIN_WIDTHs*=s*${MAIN_MIN_WIDTH}\b`).test(text) ||
        new RegExp(`BREAKPOINTs*=s*${VIEWPORT_MD}\b`).test(text)
      );
    })
    .map((file) => path.relative(SRC, file));
  expect(offenders).toEqual([]);
});

test('mode kit yang harus sama dengan JS memakai varian narrow:/wide:, bukan max-md:/md:', () => {
  const guarded = [
    'components/page/filter-bar.tsx',
    'components/page/list-page.tsx',
    'components/page/view-page.tsx',
    'modules/serial/components/selection-bar.tsx',
  ];
  for (const file of guarded) {
    const text = readFileSync(path.join(SRC, file), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      '',
    );
    expect(text, file).not.toMatch(/(?<![-\w])(max-md|md):/);
  }
});
