import type { QrPresetDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';
import { QrPresetView } from './qr-preset-view';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: false }),
}));

afterEach(() => cleanup());

const preset = (overrides: Partial<QrPresetDto> = {}): QrPresetDto => ({
  id: 'p1',
  name: 'Standar',
  title: 'Judul',
  subtitle: 'Sub',
  footer: 'Foot',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  buId: '',
  namePlacement: '',
  createdAt: 't',
  createdBy: 'a@x.com',
  updatedAt: 't',
  updatedBy: 'a@x.com',
  ...overrides,
});

test('tab Detail meringkas logo awal, ukuran, luas logo, dan bingkai selain pratinjau', async () => {
  await renderInRouter(
    <QrPresetView
      preset={preset({ defaultLogoId: 'f1' })}
      businessUnits={[]}
      usedBy={[]}
      onBack={vi.fn()}
    />,
  );
  expect(screen.getByText('Ada logo awal')).toBeInTheDocument();
  expect(screen.getByText(`${DEFAULT_QR_LAYOUT.qrSize} mm`)).toBeInTheDocument();
  expect(
    screen.getByText(
      `Title ${DEFAULT_QR_LAYOUT.titleSize} pt, Subtitle ${DEFAULT_QR_LAYOUT.subtitleSize} pt, Footer ${DEFAULT_QR_LAYOUT.footerSize} pt`,
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(`${DEFAULT_QR_LAYOUT.logoArea}% luas QR`)).toBeInTheDocument();
  expect(screen.getByText('Tanpa bingkai')).toBeInTheDocument();
});

test('bingkai berbentuk: jenis, garis, dan tebal disebut', async () => {
  await renderInRouter(
    <QrPresetView
      preset={preset({
        style: {
          ...DEFAULT_QR_STYLE,
          frame: { ...DEFAULT_QR_STYLE.frame, kind: 'corners', line: 'dashed', thickness: 0.5 },
        },
      })}
      businessUnits={[]}
      usedBy={[]}
      onBack={vi.fn()}
    />,
  );
  expect(screen.getByText('Siku di sudut, garis putus-putus, tebal 0.5 mm')).toBeInTheDocument();
  expect(screen.getByText('Tanpa logo')).toBeInTheDocument();
});
