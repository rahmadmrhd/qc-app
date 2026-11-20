import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useBlocker,
} from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { leaveBlocker } from '@/lib/leave-blocker';
import { overlayDepth, resetOverlayManager, runAfterOverlays } from '@/lib/nav-stack';
import { deferNavigateUnderOverlays } from '@/lib/overlay-navigate';
import { useBackToClose, useBackToCloseRoot } from './use-back-to-close';

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

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 120)));

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
  const go = vi.spyOn(window.history, 'go');
  function Host() {
    const [open, setOpen] = useState(true);
    return <Overlay open={open} onClose={() => setOpen(false)} />;
  }
  render(<Host />);
  act(() => window.history.back());
  await settle();
  expect(go).not.toHaveBeenCalled();
  expect(overlayDepth()).toBe(0);
});

test('desktop (viewport lebar): tidak menyisipkan entri riwayat', () => {
  window.innerWidth = 1024;
  const before = window.history.length;
  render(<Overlay open onClose={() => undefined} />);
  expect(window.history.length).toBe(before);
  expect(overlayDepth()).toBe(0);
});

test('viewport 744 px memakai gerbang ponsel yang sama (review nav I4)', () => {
  window.innerWidth = 744;
  render(<Overlay open onClose={() => undefined} />);
  expect(overlayDepth()).toBe(1);
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

test('backToClose=false: tanpa entri riwayat (dialog penjaga keluar halaman)', () => {
  function Root() {
    useBackToCloseRoot({ defaultOpen: true, backToClose: false });
    return null;
  }
  render(<Root />);
  expect(overlayDepth()).toBe(0);
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

test('tutup lewat state + navigasi pada tik yang sama: tepat SATU traversal (review nav I1)', async () => {
  const go = vi.spyOn(window.history, 'go');
  const back = vi.spyOn(window.history, 'back');
  const action = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Overlay open={open} onClose={() => setOpen(false)} />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            runAfterOverlays(action);
          }}
        >
          x
        </button>
      </>
    );
  }
  const view = render(<Host />);
  expect(overlayDepth()).toBe(1);
  await act(async () => view.getByText('x').click());
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  await settle();
  expect(go).toHaveBeenCalledTimes(1);
  expect(back).not.toHaveBeenCalled();
  expect(overlayDepth()).toBe(0);
});

test('menutup satu overlay lalu membuka yang lain pada tik yang sama: entri baru tidak ikut terlepas', async () => {
  function Host() {
    const [first, setFirst] = useState(true);
    const [second, setSecond] = useState(false);
    return (
      <>
        <Overlay open={first} onClose={() => setFirst(false)} />
        <Overlay open={second} onClose={() => setSecond(false)} />
        <button
          type="button"
          onClick={() => {
            setFirst(false);
            setSecond(true);
          }}
        >
          ganti
        </button>
      </>
    );
  }
  const view = render(<Host />);
  await act(async () => view.getByText('ganti').click());
  await settle();
  await settle();
  expect(overlayDepth()).toBe(1);
});

test('dialog dipasang bersyarat dengan open tetap: back melepasnya tanpa entri yatim (review nav I3)', async () => {
  function Host() {
    const [shown, setShown] = useState(true);
    return shown ? <Overlay open onClose={() => setShown(false)} /> : null;
  }
  render(<Host />);
  expect(overlayDepth()).toBe(1);
  act(() => window.history.back());
  await settle();
  await settle();
  expect(overlayDepth()).toBe(0);
});

test('StrictMode: dialog yang dipasang sudah terbuka tidak menutup sendiri dan hanya meninggalkan satu entri', async () => {
  const onClose = vi.fn();
  render(
    <StrictMode>
      <Overlay open onClose={onClose} />
    </StrictMode>,
  );
  await settle();
  await settle();
  expect(onClose).not.toHaveBeenCalled();
  expect(overlayDepth()).toBe(1);
});

test('halaman dengan useBlocker: menutup overlay lewat UI dan lewat back TIDAK memicu penjaga keluar (review nav C1)', async () => {
  const shouldBlock = vi.fn(() => true);
  let open = true;
  let setOpenFn: (value: boolean) => void = () => undefined;
  function Page() {
    const [isOpen, setOpen] = useState(open);
    open = isOpen;
    setOpenFn = setOpen;
    useBlocker({ shouldBlockFn: leaveBlocker(shouldBlock) });
    return <Overlay open={isOpen} onClose={() => setOpen(false)} />;
  }
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({ getParentRoute: () => root, path: '/', component: Page });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createBrowserHistory(),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(overlayDepth()).toBe(1));
  const reload = vi.spyOn(window.history, 'go');
  // Lewat back (gestur sistem).
  act(() => window.history.back());
  await settle();
  await settle();
  expect(overlayDepth()).toBe(0);
  expect(shouldBlock).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalledWith(0);
  // Buka lagi lalu tutup lewat UI.
  act(() => setOpenFn(true));
  await waitFor(() => expect(overlayDepth()).toBe(1));
  act(() => setOpenFn(false));
  await settle();
  await settle();
  expect(overlayDepth()).toBe(0);
  expect(shouldBlock).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalledWith(0);
});

test('navigate saat overlay terbuka menunggu overlay dilepas dulu (review nav I2)', async () => {
  const calls: unknown[] = [];
  const router = {
    navigate: vi.fn((options: unknown) => {
      calls.push([options, overlayDepth()]);
      return Promise.resolve();
    }),
  };
  deferNavigateUnderOverlays(router as never);
  render(<ClosingOverlay onClose={() => undefined} />);
  expect(overlayDepth()).toBe(1);
  await act(async () => {
    await (router.navigate as unknown as (o: unknown) => Promise<unknown>)({ search: 'x' });
  });
  // Dipanggil setelah kedalaman kembali 0 (tidak menimpa entri overlay).
  expect(calls).toEqual([[{ search: 'x' }, 0]]);
});
