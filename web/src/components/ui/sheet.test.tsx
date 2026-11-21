import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetOverlayManager } from '@/lib/nav-stack';
import { mockMatchMedia } from '@/test/match-media';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  media = mockMatchMedia(false);
  resetOverlayManager();
  window.innerWidth = 360;
  window.history.replaceState({ __TSR_key: 'page', __TSR_index: 1 }, '', '/');
});
afterEach(() => {
  media.restore();
  window.innerWidth = 1024;
  vi.restoreAllMocks();
});

function Harness({ side = 'bottom' }: { side?: 'bottom' | 'right' }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <span data-testid="state">{open ? 'buka' : 'tutup'}</span>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} className="max-h-[85dvh]">
          <SheetTitle>Judul</SheetTitle>
          <SheetDescription>Isi</SheetDescription>
        </SheetContent>
      </Sheet>
    </>
  );
}

let clock = 0;
beforeEach(() => {
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

/** Seretan jari dari `from` ke `to` selama `ms` milidetik (jam `performance.now` dipalsukan). */
function drag(handle: HTMLElement, from: number, to: number, ms = 400) {
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: from, button: 0, pointerType: 'touch' });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: to, pointerType: 'touch' });
  clock += ms;
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: to, pointerType: 'touch' });
}

const sheet = () => screen.getByRole('dialog');
const handle = () => screen.getByRole('button', { name: /lebarkan|kecilkan/i });

test('lembar bawah punya pegangan seret; sisi lain tidak', () => {
  const { unmount } = render(<Harness />);
  expect(handle()).toHaveStyle({ touchAction: 'none' });
  unmount();
  render(<Harness side="right" />);
  expect(screen.queryByRole('button', { name: /lebarkan|kecilkan/i })).toBeNull();
});

test('mulai di keadaan collapsed (tinggi isi)', () => {
  render(<Harness />);
  expect(sheet().dataset.expanded).toBeUndefined();
  expect(sheet().style.height).toBe('');
});

test('seret ke atas melebarkan menjadi layar penuh (expanded)', () => {
  render(<Harness />);
  drag(handle(), 400, 300);
  expect(sheet().dataset.expanded).toBe('true');
  expect(sheet().style.height).toBe('100dvh');
  expect(screen.getByTestId('state')).toHaveTextContent('buka');
});

test('seret ke bawah dari expanded kembali ke collapsed, tidak menutup', () => {
  render(<Harness />);
  drag(handle(), 400, 300);
  drag(handle(), 200, 320);
  expect(sheet().dataset.expanded).toBeUndefined();
  expect(screen.getByTestId('state')).toHaveTextContent('buka');
});

test('seret ke bawah dari collapsed menutup lembar', () => {
  render(<Harness />);
  drag(handle(), 300, 420);
  expect(screen.getByTestId('state')).toHaveTextContent('tutup');
});

test('seretan pendek (di bawah ambang) tidak mengubah keadaan', () => {
  render(<Harness />);
  drag(handle(), 300, 330);
  expect(sheet().dataset.expanded).toBeUndefined();
  expect(screen.getByTestId('state')).toHaveTextContent('buka');
  drag(handle(), 300, 270);
  expect(sheet().dataset.expanded).toBeUndefined();
});

test('seretan cepat dengan jarak kecil (>= 16 px) tetap dihitung lewat kecepatan', () => {
  render(<Harness />);
  drag(handle(), 300, 270, 30);
  expect(sheet().dataset.expanded).toBe('true');
});

test('ketukan pada pegangan (tanpa geser) membalik collapsed dan expanded', () => {
  render(<Harness />);
  fireEvent.click(handle());
  expect(sheet().dataset.expanded).toBe('true');
  fireEvent.click(handle());
  expect(sheet().dataset.expanded).toBeUndefined();
});

test('prefers-reduced-motion: kelas gerak dimatikan pada lembar', () => {
  render(<Harness />);
  expect(sheet().className).toContain('motion-reduce:transition-none');
  expect(sheet().className).toContain('motion-reduce:animate-none');
});

test('lembar bawah memakai useBackToClose: entri riwayat disisipkan saat terbuka (ponsel)', () => {
  const push = vi.spyOn(window.history, 'pushState');
  render(<Harness />);
  expect(push).toHaveBeenCalled();
});
