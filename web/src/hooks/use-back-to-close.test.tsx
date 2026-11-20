import { act, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { overlayDepth, runAfterOverlays } from '@/lib/nav-stack';
import { mockMatchMedia } from '@/test/match-media';
import { useBackToClose, useBackToCloseRoot } from './use-back-to-close';

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  window.history.replaceState({ __TSR_key: 'page', __TSR_index: 1 }, '', '/');
  media = mockMatchMedia(false);
});
afterEach(() => {
  media.restore();
});

function Overlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useBackToClose(open, onClose);
  return null;
}

/** Overlay yang menutup dirinya saat `onClose` dipanggil (seperti dialog sungguhan) dan melapor ke `onClose`. */
function ClosingOverlay({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Overlay
      open={open}
      onClose={() => {
        setOpen(false);
        onClose();
      }}
    />
  );
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 80)));

test('terbuka di ponsel: menyisipkan satu entri overlay; back memanggil onClose sekali', async () => {
  const before = window.history.length;
  const onClose = vi.fn();
  render(<ClosingOverlay onClose={onClose} />);
  expect(overlayDepth()).toBe(1);
  expect(window.history.length).toBe(before + 1);
  expect((window.history.state as { __TSR_key: string }).__TSR_key).toBe('page');
  act(() => window.history.back());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(overlayDepth()).toBe(0);
});

test('ditutup lewat UI: entri overlay dibuang (back), tanpa onClose dan tanpa entri sisa', async () => {
  const onClose = vi.fn();
  const view = render(<Overlay open onClose={onClose} />);
  expect(overlayDepth()).toBe(1);
  view.rerender(<Overlay open={false} onClose={onClose} />);
  await waitFor(() => expect(overlayDepth()).toBe(0));
  await settle();
  expect(onClose).not.toHaveBeenCalled();
  expect((window.history.state as { __TSR_key: string }).__TSR_key).toBe('page');
});

test('ditutup karena back lalu props open=false: tidak ada pop kedua', async () => {
  const back = vi.spyOn(window.history, 'back');
  function Host() {
    const [open, setOpen] = useState(true);
    return <Overlay open={open} onClose={() => setOpen(false)} />;
  }
  render(<Host />);
  act(() => window.history.back());
  await settle();
  // Satu-satunya pemanggilan back adalah dari tes ini.
  expect(back).toHaveBeenCalledTimes(1);
  expect(overlayDepth()).toBe(0);
  back.mockRestore();
});

test('desktop: tidak menyisipkan entri riwayat', () => {
  media.set(true);
  const before = window.history.length;
  render(<Overlay open onClose={() => undefined} />);
  expect(window.history.length).toBe(before);
  expect(overlayDepth()).toBe(0);
});

test('onClose ditahan pemanggil: entri dipasang ulang agar back berikutnya tetap menutup', async () => {
  const onClose = vi.fn();
  render(<Overlay open onClose={onClose} />);
  act(() => window.history.back());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(overlayDepth()).toBe(1));
});

test('akar tak terkendali (defaultOpen) diubah menjadi terkendali dan ikut back', async () => {
  const seen: boolean[] = [];
  function Root() {
    const root = useBackToCloseRoot({ defaultOpen: true });
    seen.push(root.open);
    return null;
  }
  render(<Root />);
  expect(overlayDepth()).toBe(1);
  act(() => window.history.back());
  await waitFor(() => expect(seen.at(-1)).toBe(false));
});

test('runAfterOverlays: melepas semua overlay dulu, baru menjalankan aksi', async () => {
  render(<ClosingOverlay onClose={() => undefined} />);
  const action = vi.fn();
  act(() => runAfterOverlays(action));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(overlayDepth()).toBe(0);
});

test('runAfterOverlays tanpa overlay: langsung jalan', () => {
  const action = vi.fn();
  runAfterOverlays(action);
  expect(action).toHaveBeenCalledTimes(1);
});
