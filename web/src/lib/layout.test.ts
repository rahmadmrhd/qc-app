import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { MAIN_MIN_WIDTH, VIEWPORT_MD } from './layout';

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
