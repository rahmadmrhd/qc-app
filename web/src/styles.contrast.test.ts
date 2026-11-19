import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');

function block(start: string): string {
  const i = css.indexOf(start);
  expect(i).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('\n}', i));
}

const MODES = {
  light: { vars: block(':root {'), background: '#ffffff' },
  dark: { vars: block('.dark {'), background: '#0a0a0a' }, // oklch(0.145 0 0)
} as const;

const COLORS = ['primary', 'secondary', 'success', 'warning', 'info', 'destructive'] as const;

function token(vars: string, name: string): string {
  // Diawali spasi/baris baru agar `--primary` tidak cocok dengan `--sidebar-primary`.
  const match = new RegExp(`(?:^|\\s)--${name}: *(#[0-9a-fA-F]{6});`).exec(vars);
  if (!match) throw new Error(`token --${name} tidak ditemukan sebagai hex enam digit`);
  return match[1] as string;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Rasio kontras WCAG 2.x. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe('kontras WCAG AA token warna', () => {
  for (const [mode, { vars, background }] of Object.entries(MODES)) {
    for (const color of COLORS) {
      it(`${mode}: --${color} dengan --${color}-foreground >= ${AA}`, () => {
        const ratio = contrast(token(vars, color), token(vars, `${color}-foreground`));
        expect(ratio).toBeGreaterThanOrEqual(AA);
      });
      const textToken = color === 'primary' ? 'primary' : `${color}-text`;
      it(`${mode}: --${textToken} di atas latar halaman >= ${AA}`, () => {
        expect(contrast(token(vars, textToken), background)).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});
