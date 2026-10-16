import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE, layoutLabel } from '@shared/qrcode';
import { expect, test } from 'vitest';
import { drawLabel } from './render-canvas';

const measure = (text: string, size: number, _bold?: boolean, _italic?: boolean) =>
  text.length * size * 0.2;
const input = {
  title: 'Judul',
  subtitle: 'Sub',
  footer: 'Foot',
  hasLogo: true,
  layout: DEFAULT_QR_LAYOUT,
  qrModules: 3,
};
const matrix = [
  [true, false, true],
  [false, true, false],
  [true, false, true],
];

function fakeContext() {
  const calls: Array<[string, ...unknown[]]> = [];
  const ctx = new Proxy(
    { fillStyle: '', font: '', textAlign: '', textBaseline: '' } as Record<string, unknown>,
    {
      get: (target, key: string) =>
        key in target ? target[key] : (...args: unknown[]) => calls.push([key, ...args]),
      set: (target, key: string, value) => {
        target[key] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

test('drawLabel: latar putih dulu, QR sebagai kotak, teks sesuai elemen, logo bila ada', () => {
  const layout = layoutLabel(input, measure);
  const { ctx, calls } = fakeContext();
  drawLabel(ctx, layout, matrix, { image: {} as CanvasImageSource, width: 100, height: 50 }, 10);
  expect(calls[0]?.[0]).toBe('fillRect');
  expect(calls[0]?.slice(1)).toEqual([0, 0, 300, 300]);
  expect(calls.filter((c) => c[0] === 'fillText').map((c) => c[1])).toEqual([
    'Judul',
    'Sub',
    'Foot',
  ]);
  expect(calls.filter((c) => c[0] === 'drawImage')).toHaveLength(1);
  expect(calls.filter((c) => c[0] === 'fillRect').length).toBeGreaterThan(3);
});

test('drawLabel tanpa logo tidak menggambar gambar', () => {
  const layout = layoutLabel({ ...input, hasLogo: false }, measure);
  const { ctx, calls } = fakeContext();
  drawLabel(ctx, layout, matrix, null, 10);
  expect(calls.some((c) => c[0] === 'drawImage')).toBe(false);
});

test('logo digambar persis di kotak hasil tata letak sesuai rasio berkas (bukan dipaksa persegi)', () => {
  const layout = layoutLabel({ ...input, logoAspect: 2 }, measure);
  const logo = layout.elements.find((e) => e.kind === 'logo');
  if (logo?.kind !== 'logo') throw new Error('logo hilang');
  const { ctx, calls } = fakeContext();
  drawLabel(ctx, layout, matrix, { image: {} as CanvasImageSource, width: 200, height: 100 }, 10);
  const draw = calls.find((c) => c[0] === 'drawImage');
  expect(draw?.slice(2)).toEqual([
    logo.xMm * 10,
    logo.yMm * 10,
    logo.widthMm * 10,
    logo.heightMm * 10,
  ]);
  expect(Number(draw?.[4])).toBeCloseTo(Number(draw?.[5]) * 2, 6);
});

const fonts = (calls: Array<[string, ...unknown[]]>) => calls.filter((c) => c[0] === 'fillText');

test('gaya teks: font canvas memuat italic dan bobot; garis bawah dan coret digambar sebagai garis sejajar teks', () => {
  const style = {
    ...DEFAULT_QR_STYLE,
    title: { bold: false, italic: true, underline: true, strike: false, uppercase: false },
    subtitle: { bold: true, italic: false, underline: false, strike: true, uppercase: false },
  };
  const layout = layoutLabel({ ...input, hasLogo: false, style }, measure);
  const used: string[] = [];
  const base = fakeContext();
  const ctx = new Proxy(base.ctx, {
    set: (target, key: string, value) => {
      if (key === 'font') used.push(String(value));
      (target as unknown as Record<string, unknown>)[key] = value;
      return true;
    },
  });
  drawLabel(ctx, layout, matrix, null, 10);
  expect(used.some((f) => f.includes('italic') && f.includes('400'))).toBe(true);
  expect(used.some((f) => !f.includes('italic') && f.includes('600'))).toBe(true);
  const title = layout.elements.find((e) => e.kind === 'text' && e.role === 'title');
  if (title?.kind !== 'text') throw new Error('title hilang');
  // garis bawah title: persegi tipis di bawah garis dasar dan memanjang sepanjang teks
  const rects = base.calls.filter((c) => c[0] === 'fillRect');
  // fillRect = [nama, x, y, lebar, tinggi]: garis tipis tepat di bawah garis dasar dan selebar teks
  const underline = rects.find(
    (r) =>
      Number(r[4]) > 0 &&
      Number(r[4]) < 3 &&
      Number(r[3]) === title.widthMm * 10 &&
      Number(r[2]) > title.baselineMm * 10 &&
      Number(r[2]) < title.baselineMm * 10 + 6,
  );
  expect(underline).toBeDefined();
  expect(fonts(base.calls).map((c) => c[1])).toContain('Judul');
});

test('bingkai: dua gaya digambar sebagai goresan; corners = 4 goresan, box = 1; tanpa bingkai tidak ada goresan', () => {
  const frame = (kind: 'none' | 'corners' | 'box') => ({
    ...DEFAULT_QR_STYLE,
    frame: { ...DEFAULT_QR_STYLE.frame, kind },
  });
  const strokes = (kind: 'none' | 'corners' | 'box') => {
    const layout = layoutLabel(
      { ...input, title: '', subtitle: '', footer: '', hasLogo: false, style: frame(kind) },
      measure,
    );
    const { ctx, calls } = fakeContext();
    drawLabel(ctx, layout, matrix, null, 10);
    return calls.filter((c) => c[0] === 'stroke').length;
  };
  expect(strokes('none')).toBe(0);
  expect(strokes('corners')).toBe(4);
  expect(strokes('box')).toBe(1);
});

test('gaya garis bingkai: solid tanpa pola; putus-putus dan titik-titik memakai setLineDash dengan pola dari tata letak', () => {
  const dashFor = (line: 'solid' | 'dashed' | 'dotted') => {
    const style = {
      ...DEFAULT_QR_STYLE,
      frame: { ...DEFAULT_QR_STYLE.frame, kind: 'box' as const, line },
    };
    const layout = layoutLabel(
      { ...input, title: '', subtitle: '', footer: '', hasLogo: false, style },
      measure,
    );
    const { ctx, calls } = fakeContext();
    drawLabel(ctx, layout, matrix, null, 10);
    return calls.filter((c) => c[0] === 'setLineDash').map((c) => c[1] as number[]);
  };
  expect(dashFor('solid')).toEqual([[]]);
  const [dashed] = dashFor('dashed');
  expect(dashed).toHaveLength(2);
  expect(dashed?.[0] ?? 0).toBeGreaterThan(dashed?.[1] ?? 0);
  const [dotted] = dashFor('dotted');
  expect(dotted?.[0] ?? 1).toBeLessThan(1);
  expect(dotted?.[1] ?? 0).toBeGreaterThan(2);
});
