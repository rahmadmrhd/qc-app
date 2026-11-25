import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');

function block(start: string): string {
  const i = css.indexOf(start);
  expect(i).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('\n}', i));
}

type Rgb = [number, number, number];

/** oklch(L C h) -> sRGB 0..255 (OKLab -> sRGB linear -> gamma). */
function oklchToRgb(l: number, c: number, hDeg: number): Rgb {
  const a = c * Math.cos((hDeg * Math.PI) / 180);
  const b = c * Math.sin((hDeg * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return linear.map((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255);
  }) as Rgb;
}

/** Membaca token `--name` sebagai warna: hex enam digit atau `oklch(L C h)` (tanpa alfa). */
function token(vars: string, name: string): Rgb {
  // Diawali spasi/baris baru agar `--primary` tidak cocok dengan `--sidebar-primary`.
  const match = new RegExp(`(?:^|\\s)--${name}: *([^;]+);`).exec(vars);
  if (!match) throw new Error(`token --${name} tidak ditemukan`);
  const value = (match[1] as string).trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const oklch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (oklch) return oklchToRgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
  throw new Error(`format token --${name} tidak didukung: ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Rasio kontras WCAG 2.x. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Warna `fg` berlapis alfa di atas `bg` (komposisi sRGB seperti peramban). */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((v, i) => Math.round(v * alpha + (bg[i] as number) * (1 - alpha))) as Rgb;
}

const MODES = { light: block(':root {'), dark: block('.dark {') } as const;
const COLORS = ['primary', 'secondary', 'success', 'warning', 'info', 'destructive'] as const;
const AA = 4.5;
/** WCAG 1.4.11: komponen grafis (irisan, garis, batang) minimal 3:1 terhadap latar. */
const GRAPHIC = 3;
/** Tint badge soft (15%) dan alert/banner (10%), sama dengan `variant-style.ts` dan `alert.tsx`. */
const SOFT_ALPHA = 0.15;
const ALERT_ALPHA = 0.1;

/** Warna teks/ikon di atas latar halaman: `primary` memakai `--foreground`, lainnya `--X-text`. */
const textOf = (vars: string, color: (typeof COLORS)[number]) =>
  token(vars, color === 'primary' ? 'foreground' : `${color}-text`);

describe('kontras WCAG AA token warna', () => {
  for (const [mode, vars] of Object.entries(MODES)) {
    const surfaces = { '--background': token(vars, 'background'), '--card': token(vars, 'card') };

    for (const color of COLORS) {
      it(`${mode}: --${color} dengan --${color}-foreground >= ${AA}`, () => {
        expect(
          contrast(token(vars, color), token(vars, `${color}-foreground`)),
        ).toBeGreaterThanOrEqual(AA);
      });

      for (const [surfaceName, surface] of Object.entries(surfaces)) {
        const text = textOf(vars, color);
        it(`${mode}: teks ${color} di atas ${surfaceName} >= ${AA}`, () => {
          expect(contrast(text, surface)).toBeGreaterThanOrEqual(AA);
        });
        // Primary soft = `bg-muted text-foreground`, bukan tint: diperiksa terpisah di bawah.
        if (color === 'primary') continue;
        it(`${mode}: teks ${color} di atas badge soft (15%) pada ${surfaceName} >= ${AA}`, () => {
          expect(contrast(text, over(text, surface, SOFT_ALPHA))).toBeGreaterThanOrEqual(AA);
        });
        it(`${mode}: teks ${color} di atas alert/banner (10%) pada ${surfaceName} >= ${AA}`, () => {
          expect(contrast(text, over(text, surface, ALERT_ALPHA))).toBeGreaterThanOrEqual(AA);
        });
        it(`${mode}: --foreground (isi alert) di atas tint ${color} 10% pada ${surfaceName} >= ${AA}`, () => {
          expect(
            contrast(token(vars, 'foreground'), over(text, surface, ALERT_ALPHA)),
          ).toBeGreaterThanOrEqual(AA);
        });
      }
    }

    it(`${mode}: --muted-foreground di atas --muted dan --card >= ${AA}`, () => {
      const mutedForeground = token(vars, 'muted-foreground');
      expect(contrast(mutedForeground, token(vars, 'muted'))).toBeGreaterThanOrEqual(AA);
      expect(contrast(mutedForeground, token(vars, 'card'))).toBeGreaterThanOrEqual(AA);
    });

    it(`${mode}: warna grafik --chart-1..8 berwarna (bukan netral) dan >= ${GRAPHIC} di atas --card`, () => {
      for (let n = 1; n <= 8; n++) {
        const color = token(vars, `chart-${n}`);
        // Keputusan pemilik 2026-11-25: grafik tidak boleh memakai warna netral (abu-abu, hitam, putih).
        expect(Math.max(...color) - Math.min(...color), `--chart-${n} netral`).toBeGreaterThanOrEqual(
          60,
        );
        expect(contrast(color, token(vars, 'card')), `--chart-${n}`).toBeGreaterThanOrEqual(GRAPHIC);
      }
    });

    it(`${mode}: --foreground di atas --muted (badge soft primary) >= ${AA}`, () => {
      expect(contrast(token(vars, 'foreground'), token(vars, 'muted'))).toBeGreaterThanOrEqual(AA);
    });
  }

  it('konversi oklch sesuai nilai acuan (putih, hitam, abu)', () => {
    expect(oklchToRgb(1, 0, 0)).toEqual([255, 255, 255]);
    expect(oklchToRgb(0, 0, 0)).toEqual([0, 0, 0]);
    expect(oklchToRgb(0.145, 0, 0)).toEqual([10, 10, 10]);
  });
});
