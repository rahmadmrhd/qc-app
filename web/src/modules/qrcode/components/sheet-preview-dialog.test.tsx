import { DEFAULT_QR_LAYOUT } from '@shared/qrcode';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { SheetPreviewDialog } from './sheet-preview-dialog';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const design = {
  title: 'Panduan',
  subtitle: 'Sub',
  footer: 'foot',
  link: 'https://contoh.com/a',
  layout: DEFAULT_QR_LAYOUT,
};

function open() {
  render(<SheetPreviewDialog open onOpenChange={vi.fn()} design={design} logoUrl={null} />);
}

test('dialog lebar (bukan sempit): kelas lebar maksimum untuk layar sm ke atas diganti, bukan kalah oleh bawaan', () => {
  open();
  const dialog = screen.getByRole('dialog');
  expect(dialog.className).toContain('sm:max-w-5xl');
  expect(dialog.className).not.toContain('sm:max-w-sm');
});

test('zoom: mulai 100% (pas lebar); perbesar/perkecil bertahap dan ukuran kanvas mengikuti', async () => {
  open();
  const canvas = screen.getByLabelText('Gambar lembar 10 × 14');
  expect(screen.getByText('100%')).toBeInTheDocument();
  expect(canvas).toHaveStyle({ width: '100%' });
  await userEvent.click(screen.getByRole('button', { name: 'Perbesar zoom' }));
  expect(screen.getByText('125%')).toBeInTheDocument();
  expect(canvas).toHaveStyle({ width: '125%' });
  await userEvent.click(screen.getByRole('button', { name: 'Perkecil zoom' }));
  await userEvent.click(screen.getByRole('button', { name: 'Perkecil zoom' }));
  expect(screen.getByText('75%')).toBeInTheDocument();
});

test('zoom dibatasi 50%–400%: tombol dinonaktifkan di batas; Pas lebar mengembalikan 100%', async () => {
  open();
  const zoomIn = screen.getByRole('button', { name: 'Perbesar zoom' });
  const zoomOut = screen.getByRole('button', { name: 'Perkecil zoom' });
  for (let i = 0; i < 10; i++) if (!zoomIn.hasAttribute('disabled')) await userEvent.click(zoomIn);
  expect(screen.getByText('400%')).toBeInTheDocument();
  expect(zoomIn).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Pas lebar' }));
  expect(screen.getByText('100%')).toBeInTheDocument();
  for (let i = 0; i < 10; i++)
    if (!zoomOut.hasAttribute('disabled')) await userEvent.click(zoomOut);
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(zoomOut).toBeDisabled();
});

test('Ctrl + roda mouse (juga pinch di trackpad) memperbesar dan memperkecil; roda biasa hanya menggulir', () => {
  open();
  const viewport = screen.getByTestId('sheet-viewport');
  fireEvent.wheel(viewport, { deltaY: -100 });
  expect(screen.getByText('100%')).toBeInTheDocument();
  fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true });
  expect(screen.getByText('125%')).toBeInTheDocument();
  fireEvent.wheel(viewport, { deltaY: 100, ctrlKey: true });
  expect(screen.getByText('100%')).toBeInTheDocument();
});

test('kontrol zoom tetap tampil walau pratinjau gagal dibuat (canvas tak tersedia)', async () => {
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent('Pratinjau gagal dibuat');
  expect(screen.getByRole('button', { name: 'Perbesar zoom' })).toBeInTheDocument();
});

test('P6: pratinjau lembar layar penuh di ponsel; lebar desktop tetap', () => {
  open();
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('data-size', 'full-on-phone');
  expect(dialog.className).toContain('max-md:data-[size=full-on-phone]:h-[var(--vvh,100dvh)]');
  expect(dialog.className).toContain(
    'max-md:data-[size=full-on-phone]:pt-[env(safe-area-inset-top)]',
  );
  expect(dialog.className).toContain('sm:max-w-5xl');
});
