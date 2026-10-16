import { DEFAULT_QR_LAYOUT, layoutLabel } from '@shared/qrcode';
import { expect, test } from 'vitest';
import { drawLabel } from './render-canvas';

const measure = (text: string, size: number) => text.length * size * 0.2;
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
