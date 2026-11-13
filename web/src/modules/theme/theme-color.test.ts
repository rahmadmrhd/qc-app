import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { applyTheme, applyThemeColor, THEME_COLORS } from './theme';

// vitest dijalankan dari folder `web/` (`bun run --cwd web test`), tempat `index.html` berada.
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

const METAS_HTML = `
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />
`;

function themeColors(doc: Document = document): string[] {
  return [...doc.querySelectorAll('meta[name="theme-color"]')].map(
    (meta) => meta.getAttribute('content') ?? '',
  );
}

beforeEach(() => {
  document.head.innerHTML = METAS_HTML;
});

afterEach(() => {
  document.head.innerHTML = '';
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
  localStorage.clear();
  vi.unstubAllGlobals();
});

test('THEME_COLORS setara --background terang dan gelap', () => {
  expect(THEME_COLORS).toEqual({ light: '#ffffff', dark: '#0a0a0a' });
});

test('applyThemeColor menyetel semua meta theme-color tanpa memandang atribut media', () => {
  applyThemeColor('dark');
  expect(themeColors()).toEqual(['#0a0a0a', '#0a0a0a']);
  applyThemeColor('light');
  expect(themeColors()).toEqual(['#ffffff', '#ffffff']);
});

test('applyThemeColor tidak melempar bila tidak ada meta theme-color', () => {
  document.head.innerHTML = '';
  expect(() => applyThemeColor('dark')).not.toThrow();
});

test('applyTheme ikut menyetel meta theme-color', () => {
  applyTheme('dark');
  expect(themeColors()).toEqual(['#0a0a0a', '#0a0a0a']);
  applyTheme('light');
  expect(themeColors()).toEqual(['#ffffff', '#ffffff']);
});

test('index.html memuat dua meta theme-color bermedia sebelum skrip inline', () => {
  const light = INDEX_HTML.indexOf(
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}"`,
  );
  const dark = INDEX_HTML.indexOf(
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}"`,
  );
  const script = INDEX_HTML.indexOf('<script>');
  expect(light).toBeGreaterThan(-1);
  expect(dark).toBeGreaterThan(-1);
  expect(script).toBeGreaterThan(-1);
  expect(light).toBeLessThan(script);
  expect(dark).toBeLessThan(script);
});

function inlineScript(): string {
  const match = INDEX_HTML.match(/<script>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error('skrip inline tidak ditemukan di index.html');
  return match[1];
}

function runAntiFlash(saved: string | null, systemDark: boolean): void {
  document.head.innerHTML = METAS_HTML;
  document.documentElement.classList.remove('dark');
  localStorage.clear();
  if (saved !== null) localStorage.setItem('qc.theme', saved);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: query.includes('dark') && systemDark, media: query })),
  );
  new Function(inlineScript())();
}

test('skrip anti-kedip: tema tersimpan dark saat OS terang -> kelas dark dan kedua meta gelap', () => {
  runAntiFlash('dark', false);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(themeColors()).toEqual(['#0a0a0a', '#0a0a0a']);
});

test('skrip anti-kedip: tema tersimpan light saat OS gelap -> kedua meta terang', () => {
  runAntiFlash('light', true);
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(themeColors()).toEqual(['#ffffff', '#ffffff']);
});

test('skrip anti-kedip: system + OS gelap -> meta gelap; system + OS terang -> meta terang', () => {
  runAntiFlash('system', true);
  expect(themeColors()).toEqual(['#0a0a0a', '#0a0a0a']);
  runAntiFlash(null, false);
  expect(themeColors()).toEqual(['#ffffff', '#ffffff']);
});
