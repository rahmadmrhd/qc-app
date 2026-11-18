import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProofPhotoRef } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { CAMERA_ERROR_TEXT } from '../lib/use-camera-stream';
import { ProofCameraDialog, type ProofCameraDialogProps } from './proof-camera';

const STAMP: StampPreviewInput = {
  serial: 'ABC123',
  itemLabel: 'Cisco C9200',
  buLabel: 'BU1',
  locationLabel: 'Surabaya',
  actorName: 'Budi',
  actorTeam: 'QC',
};

function fakeStream() {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({ torch: true }),
    getSettings: () => ({ deviceId: 'cam-1' }),
    applyConstraints: vi.fn(async () => undefined),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

let drawImage: ReturnType<typeof vi.fn>;
let fillText: ReturnType<typeof vi.fn>;
let blobResult: Blob | null;

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    get: () => 4,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    get: () => 1280,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    get: () => 720,
    configurable: true,
  });
  drawImage = vi.fn();
  fillText = vi.fn();
  blobResult = new Blob([new Uint8Array(8)], { type: 'image/jpeg' });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    fillText,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((callback: BlobCallback) =>
    callback(blobResult)) as unknown as HTMLCanvasElement['toBlob']);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'readyState');
  for (const key of ['videoWidth', 'videoHeight']) {
    Reflect.deleteProperty(HTMLVideoElement.prototype, key);
  }
});

function setup(props: Partial<ProofCameraDialogProps> = {}) {
  const media = fakeStream();
  setMediaDevices({
    getUserMedia: vi.fn(async () => media.stream),
    enumerateDevices: vi.fn(async () => []),
  });
  const onShot = vi.fn(async (_file: File) => undefined);
  const onOpenChange = vi.fn();
  const view = render(
    <ProofCameraDialog
      open
      onOpenChange={onOpenChange}
      remaining={3}
      stamp={STAMP}
      shots={[]}
      onShot={onShot}
      {...props}
    />,
  );
  return { ...media, ...view, onShot, onOpenChange };
}

const shutter = () => screen.getByRole('button', { name: 'Ambil foto' });
const ready = () => waitFor(() => expect(shutter()).toBeEnabled());

test('dialog layar penuh dengan judul untuk pembaca layar; rana aktif setelah kamera siap', async () => {
  setup();
  expect(await screen.findByRole('alertdialog')).toHaveAttribute('data-size', 'full');
  expect(screen.getByText('Kamera foto bukti')).toBeInTheDocument();
  await ready();
});

test('rana memanggil onShot dengan berkas JPEG dari bingkai video', async () => {
  const ctx = setup();
  await ready();
  await userEvent.click(shutter());
  await waitFor(() => expect(ctx.onShot).toHaveBeenCalledTimes(1));
  const file = ctx.onShot.mock.calls[0]?.[0] as File;
  expect(file).toBeInstanceOf(File);
  expect(file.type).toBe('image/jpeg');
  expect(drawImage).toHaveBeenCalledWith(
    screen.getByLabelText('Pratinjau kamera'),
    0,
    0,
    1280,
    720,
  );
});

test('pratinjau cap: empat baris tampil, dapat disembunyikan, dan bukan bagian dari berkas foto', async () => {
  const ctx = setup();
  await ready();
  const note = screen.getByRole('note', { name: 'Pratinjau cap' });
  expect(note).toHaveTextContent('SN: ABC123');
  expect(note).toHaveTextContent('Cisco C9200');
  expect(note).toHaveTextContent('BU1 · Surabaya');
  expect(note).toHaveTextContent('Disimpan saat Simpan · Budi (QC)');
  expect(note).toHaveTextContent('cap resmi ditambahkan server saat Simpan');

  await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan pratinjau cap' }));
  expect(screen.queryByRole('note', { name: 'Pratinjau cap' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tampilkan pratinjau cap' }));
  expect(screen.getByRole('note', { name: 'Pratinjau cap' })).toBeInTheDocument();

  await userEvent.click(shutter());
  await waitFor(() => expect(ctx.onShot).toHaveBeenCalled());
  // Hanya video yang digambar ke kanvas; teks cap tidak pernah ikut.
  expect(drawImage).toHaveBeenCalledTimes(1);
  expect(fillText).not.toHaveBeenCalled();
});

test('tanpa data cap pratinjau tidak ditampilkan', async () => {
  setup({ stamp: undefined });
  await ready();
  expect(screen.queryByTestId('stamp-preview')).not.toBeInTheDocument();
});

test('jepretan memberi kilat singkat dan getar ringan', async () => {
  const vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  setup();
  await ready();
  await userEvent.click(shutter());
  expect(await screen.findByTestId('shutter-flash')).toBeInTheDocument();
  expect(vibrate).toHaveBeenCalledWith(25);
  Reflect.deleteProperty(navigator, 'vibrate');
});

test('sisa 0: rana nonaktif dengan keterangan batas', async () => {
  setup({ remaining: 0 });
  await waitFor(() => expect(screen.queryByText('Menyiapkan kamera…')).not.toBeInTheDocument());
  expect(shutter()).toBeDisabled();
  expect(screen.getByText('Batas foto tercapai')).toBeInTheDocument();
});

test('bingkai gagal dienkode: pesan tampil dan rana aktif lagi (dialog tidak macet)', async () => {
  blobResult = null;
  const ctx = setup();
  await ready();
  await userEvent.click(shutter());
  expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal mengambil gambar/);
  expect(ctx.onShot).not.toHaveBeenCalled();
  await waitFor(() => expect(shutter()).toBeEnabled());
});

test('onShot menolak: pesannya tampil di dialog', async () => {
  const ctx = setup();
  ctx.onShot.mockRejectedValueOnce(new Error('Kuota foto sementara penuh'));
  await ready();
  await userEvent.click(shutter());
  expect(await screen.findByRole('alert')).toHaveTextContent('Kuota foto sementara penuh');
});

test('kamera dilepas saat dialog ditutup (open=false) dan saat unmount', async () => {
  const closed = setup();
  await ready();
  expect(closed.track.stop).not.toHaveBeenCalled();
  closed.rerender(
    <ProofCameraDialog
      open={false}
      onOpenChange={() => undefined}
      remaining={3}
      shots={[]}
      onShot={async () => undefined}
    />,
  );
  await waitFor(() => expect(closed.track.stop).toHaveBeenCalled());
  closed.unmount();

  const unmounted = setup();
  await ready();
  unmounted.unmount();
  expect(unmounted.track.stop).toHaveBeenCalledTimes(1);
});

test('Selesai dan Esc menutup dialog', async () => {
  const ctx = setup();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
  ctx.onOpenChange.mockClear();
  await userEvent.keyboard('{Escape}');
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
});

test('izin ditolak: pesan dan Coba lagi, tanpa rana aktif; onUnavailable dilaporkan', async () => {
  const getUserMedia = vi.fn(async () => {
    throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
  });
  setMediaDevices({ getUserMedia });
  const onUnavailable = vi.fn();
  render(
    <ProofCameraDialog
      open
      onOpenChange={() => undefined}
      remaining={3}
      shots={[]}
      onShot={async () => undefined}
      onUnavailable={onUnavailable}
    />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.denied);
  expect(shutter()).toBeDisabled();
  await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith('denied'));
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
});

function makeShots(count: number): ProofPhotoRef[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    mime: 'image/webp',
    size: 1,
    thumbUrl: `/api/v1/serial-proofs/p${index + 1}`,
  }));
}

test('tutup di kiri atas menutup dialog', async () => {
  const ctx = setup();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Tutup kamera' }));
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
});

const stackButton = () => screen.getByRole('button', { name: /daftar foto/ });
const openStrip = () => userEvent.click(stackButton());

test('layar penuh: viewport mengisi dialog dan tak ada bidang statis di bawahnya', async () => {
  setup({ shots: makeShots(2) });
  await ready();
  const viewport = screen.getByTestId('camera-viewport');
  const scroller = viewport.parentElement as HTMLElement;
  expect(scroller).toHaveAttribute('data-slot', 'alert-dialog-scroll');
  // Viewport mengisi sisa tinggi dan tak ada saudara sesudahnya (tak ada kisi, teks, atau footer di bawah kamera).
  expect(viewport).toHaveClass('flex-1', 'w-full', 'min-h-0');
  expect(viewport.nextElementSibling).toBeNull();
  expect(
    screen.getByRole('alertdialog').querySelector('[data-slot="alert-dialog-footer"]'),
  ).toBeNull();
  expect(screen.queryByTestId('proof-camera-layout')).not.toBeInTheDocument();
  expect(screen.queryByText(/foto dibidik/)).not.toBeInTheDocument();
  // Semua kontrol mengambang DI DALAM viewport.
  const inside = within(viewport);
  expect(inside.getByRole('button', { name: 'Ambil foto' })).toBeInTheDocument();
  expect(inside.getByRole('button', { name: 'Selesai (2)' })).toBeInTheDocument();
  expect(inside.getByRole('button', { name: 'Tutup kamera' })).toBeInTheDocument();
  expect(inside.getByTestId('proof-photo-stack')).toBeInTheDocument();
  expect(inside.getByText('Sisa 3 foto')).toBeInTheDocument();
});

test('tanpa foto: tak ada tumpukan, strip, atau hitungan; Selesai polos', async () => {
  setup();
  await ready();
  expect(screen.queryByTestId('proof-photo-stack')).not.toBeInTheDocument();
  expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Selesai' })).toBeInTheDocument();
});

test('tumpukan di samping rana: foto terakhir di depan, lapisan belakang, lencana jumlah', async () => {
  setup({ shots: makeShots(4) });
  await ready();
  const stack = screen.getByTestId('proof-photo-stack');
  const layers = Array.from(stack.querySelectorAll('img'));
  // Foto terakhir + paling banyak dua lapis di belakangnya.
  expect(layers).toHaveLength(3);
  expect(layers.map((img) => img.getAttribute('src'))).toEqual([
    '/api/v1/serial-proofs/p3',
    '/api/v1/serial-proofs/p2',
    '/api/v1/serial-proofs/p4',
  ]);
  expect(within(stack).getByTestId('proof-photo-stack-count')).toHaveTextContent('4');
  expect(stack).toHaveAttribute('aria-expanded', 'false');
  // Satu baris dengan rana (kolom kiri baris rana).
  expect(stack.closest('[data-camera-control]')?.parentElement).toBe(
    shutter().closest('[data-camera-control]')?.parentElement,
  );
});

test('strip tersembunyi awalnya; ketuk tumpukan memunculkan satu baris horizontal yang menggulir', async () => {
  setup({ shots: makeShots(5) });
  await ready();
  expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
  await openStrip();
  const strip = screen.getByTestId('proof-photo-strip');
  expect(stackButton()).toHaveAttribute('aria-expanded', 'true');
  expect(strip).toHaveClass('flex', 'flex-nowrap', 'overflow-x-auto');
  expect(strip).not.toHaveClass('flex-wrap');
  expect(strip.children).toHaveLength(5);
  for (const item of Array.from(strip.children)) expect(item).toHaveClass('shrink-0');
  expect(screen.getByRole('img', { name: 'Foto bukti 1, hasil kamera' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Foto bukti 5, hasil kamera' })).toBeInTheDocument();
});

test('ketuk tumpukan lagi menutup strip', async () => {
  setup({ shots: makeShots(2) });
  await ready();
  await openStrip();
  expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
  await openStrip();
  expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
});

test('ketuk area video menyembunyikan strip', async () => {
  setup({ shots: makeShots(2) });
  await ready();
  await openStrip();
  await userEvent.click(screen.getByTestId('camera-viewport'));
  expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
});

test('menekan rana menyembunyikan strip', async () => {
  const ctx = setup({ shots: makeShots(2) });
  await ready();
  await openStrip();
  await userEvent.click(shutter());
  await waitFor(() => expect(ctx.onShot).toHaveBeenCalled());
  expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
});

test('ketukan di dalam strip tidak menutupnya', async () => {
  setup({ shots: makeShots(2) });
  await ready();
  await openStrip();
  await userEvent.click(screen.getByTestId('proof-photo-strip'));
  expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
});

test('strip menutup sendiri setelah jeda tanpa interaksi; interaksi menundanya', async () => {
  setup({ shots: makeShots(2) });
  await ready();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openStrip();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
    // Sentuhan di strip menunda: 3 dtk lagi (total 6 dtk sejak buka) belum menutup.
    fireEvent.pointerDown(screen.getByTestId('proof-photo-strip'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('ketuk thumbnail di strip membuka pratinjau besar; strip tak menutup selama pratinjau terbuka', async () => {
  setup({ shots: makeShots(2) });
  await ready();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openStrip();
    expect(screen.queryByRole('img', { name: 'Pratinjau besar foto 2' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Perbesar foto 2, hasil kamera' }));
    expect(await screen.findByRole('img', { name: 'Pratinjau besar foto 2' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(screen.getByRole('img', { name: 'Pratinjau besar foto 2' })).toBeInTheDocument();
    expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('tombol buang kecil di thumbnail strip memanggil onRemoveShot; tanpa pemanggil tombolnya tak ada', async () => {
  const shots = makeShots(2);
  const onRemoveShot = vi.fn();
  const view = setup({ shots, onRemoveShot });
  await ready();
  await openStrip();
  await userEvent.click(screen.getByRole('button', { name: 'Buang foto 2, hasil kamera' }));
  expect(onRemoveShot).toHaveBeenCalledWith(shots[1]);
  view.unmount();

  setup({ shots });
  await ready();
  await openStrip();
  expect(screen.queryByRole('button', { name: /Buang foto/ })).not.toBeInTheDocument();
});

test('foto yang sedang diunggah: penanda di tumpukan dan sel berputar di ujung strip', async () => {
  setup({ shots: makeShots(1), uploading: 2 });
  await ready();
  const stack = screen.getByTestId('proof-photo-stack');
  expect(within(stack).getByTestId('proof-photo-stack-uploading')).toBeInTheDocument();
  await openStrip();
  const strip = screen.getByTestId('proof-photo-strip');
  expect(strip.children).toHaveLength(3);
  expect(within(strip).getAllByTestId('proof-photo-uploading')).toHaveLength(2);
});

test('foto pertama masih diunggah: penanda tampil di samping rana tanpa tumpukan', async () => {
  setup({ uploading: 1 });
  await ready();
  expect(screen.queryByTestId('proof-photo-stack')).not.toBeInTheDocument();
  expect(screen.getByTestId('proof-photo-stack-uploading')).toBeInTheDocument();
});

test('Selesai menampilkan hitungan foto dan menutup dialog', async () => {
  const ctx = setup({ shots: makeShots(3) });
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Selesai (3)' }));
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
});

test('penghitung sisa kuota tampil sebagai pil dan mengikuti prop remaining', async () => {
  const view = setup({ remaining: 2 });
  await ready();
  expect(screen.getByText('Sisa 2 foto')).toBeInTheDocument();
  view.rerender(
    <ProofCameraDialog
      open
      onOpenChange={() => undefined}
      remaining={1}
      shots={[]}
      onShot={async () => undefined}
    />,
  );
  expect(await screen.findByText('Sisa 1 foto')).toBeInTheDocument();
});

test('strip mengambang menimpa video: tidak ikut aliran tata letak, tak menggeser cap, pil, atau rana', async () => {
  setup({ shots: makeShots(3) });
  await ready();
  const stampWrap = screen.getByTestId('stamp-preview').closest('[data-camera-control]');
  const bottomStack = stampWrap?.parentElement as HTMLElement;
  const pill = screen.getByText('Sisa 3 foto');
  const wrapper = pill.parentElement as HTMLElement;
  const inFlow = (el: HTMLElement) =>
    Array.from(el.children).filter((child) => !child.className.includes('absolute'));
  const bottomBefore = inFlow(bottomStack);
  const wrapperBefore = inFlow(wrapper);
  const stampHTML = stampWrap?.outerHTML;
  const pillClass = pill.className;

  await openStrip();
  const panel = screen.getByTestId('proof-photo-strip-panel');
  const overlay = panel.closest('[data-camera-control]') as HTMLElement;
  // Strip = overlay absolut tepat di atas pembungkus pil+rana; bukan anak aliran siapa pun.
  expect(overlay).toHaveClass('absolute', 'bottom-full');
  expect(overlay.parentElement).toBe(wrapper);
  expect(bottomStack.contains(overlay)).toBe(true);
  // Elemen yang ikut aliran tata letak identik dengan saat strip tertutup (tanpa layout shift).
  expect(inFlow(bottomStack)).toEqual(bottomBefore);
  expect(inFlow(wrapper)).toEqual(wrapperBefore);
  expect(screen.getByTestId('stamp-preview').closest('[data-camera-control]')?.outerHTML).toBe(
    stampHTML,
  );
  expect(screen.getByText('Sisa 3 foto').className).toBe(pillClass);
  // Latar semi transparan agar thumbnail terbaca di atas video.
  expect(panel).toHaveClass('bg-black/45');

  await openStrip();
  expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
  expect(inFlow(bottomStack)).toEqual(bottomBefore);
  expect(inFlow(wrapper)).toEqual(wrapperBefore);
});

/** jsdom tak menilai `:focus-visible`: paksa hasilnya (papan ketik = true, klik mouse/sentuh = false). */
function stubFocusVisible(visible: boolean) {
  const real = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector) {
    return selector === ':focus-visible' ? visible : real.call(this, selector);
  });
}

test('fokus papan ketik di dalam strip menahan tutup-otomatis; setelah fokus keluar hitungan jalan lagi', async () => {
  stubFocusVisible(true);
  setup({ shots: makeShots(2) });
  await ready();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openStrip();
    const thumb = screen.getByRole('button', { name: 'Perbesar foto 1, hasil kamera' });
    act(() => thumb.focus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
    // Fokus keluar dari strip: hitungan mundur mulai lagi dan strip menutup setelah jeda.
    act(() => shutter().focus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('papan ketik dan gulir di strip menunda tutup-otomatis', async () => {
  setup({ shots: makeShots(2) });
  await ready();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openStrip();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    fireEvent.keyDown(screen.getByTestId('proof-photo-strip'), { key: 'ArrowRight' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
    fireEvent.scroll(screen.getByTestId('proof-photo-strip'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('hover mouse di strip menahan tutup-otomatis sampai kursor keluar', async () => {
  setup({ shots: makeShots(2) });
  await ready();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openStrip();
    const overlay = screen.getByTestId('proof-photo-strip-panel').closest('[data-camera-control]');
    fireEvent.pointerEnter(overlay as Element, { pointerType: 'mouse' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId('proof-photo-strip')).toBeInTheDocument();
    fireEvent.pointerLeave(overlay as Element, { pointerType: 'mouse' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('tombol tumpukan menunjuk strip lewat aria-controls hanya saat strip tampil', async () => {
  setup({ shots: makeShots(2) });
  await ready();
  expect(stackButton()).not.toHaveAttribute('aria-controls');
  await openStrip();
  const panel = screen.getByTestId('proof-photo-strip-panel');
  expect(panel.id).not.toBe('');
  expect(stackButton()).toHaveAttribute('aria-controls', panel.id);
});

test('foto terakhir dibuang dari strip: fokus pindah ke tombol rana', async () => {
  const shots = makeShots(1);
  const view = setup({ shots, onRemoveShot: () => undefined });
  await ready();
  await openStrip();
  const remove = screen.getByRole('button', { name: 'Buang foto 1, hasil kamera' });
  act(() => remove.focus());
  expect(remove).toHaveFocus();
  view.rerender(
    <ProofCameraDialog
      open
      onOpenChange={() => undefined}
      remaining={3}
      shots={[]}
      onShot={async () => undefined}
      onRemoveShot={() => undefined}
    />,
  );
  await waitFor(() => expect(shutter()).toHaveFocus());
  expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
});

test('fokus sisa klik (bukan fokus papan ketik) tidak menahan tutup-otomatis', async () => {
  stubFocusVisible(false);
  setup({ shots: makeShots(2) });
  await ready();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openStrip();
    act(() => screen.getByRole('button', { name: 'Perbesar foto 1, hasil kamera' }).focus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    expect(screen.queryByTestId('proof-photo-strip')).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
