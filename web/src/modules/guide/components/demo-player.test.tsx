import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DemoScene } from '../lib/demo-types';
import { CLIP_BACKUP_MS, DemoPlayer, TEXT_SCENE_MS } from './demo-player';

const scenes: DemoScene[] = [
  { kind: 'kode', caption: 'Salin semua pesan', durationMs: 1000, render: () => <p>adegan-1</p> },
  { kind: 'kode', caption: 'Tempel sekali saja', durationMs: 2000, render: () => <p>adegan-2</p> },
  { kind: 'kode', caption: 'Hasilnya jadi kartu', durationMs: 1000, render: () => <p>adegan-3</p> },
];

function mockMedia(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockMedia(false);
  // jsdom tidak mengimplementasikan pemutaran media.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // biome-ignore lint/suspicious/noExplicitAny: memulihkan stub jsdom
  delete (window as any).matchMedia;
});

describe('adegan kode', () => {
  test('berganti sesuai durationMs, keterangan mengikuti, dan berulang dari awal', () => {
    render(<DemoPlayer scenes={scenes} />);
    expect(screen.getByText('adegan-1')).toBeInTheDocument();
    expect(screen.getByText('Salin semua pesan')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByText('adegan-1')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('adegan-2')).toBeInTheDocument();
    expect(screen.getByText('Tempel sekali saja')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('adegan-3')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('adegan-1')).toBeInTheDocument();
  });

  test('Jeda menghentikan pergantian dan Putar melanjutkannya', () => {
    render(<DemoPlayer scenes={scenes} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('adegan-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Putar' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('adegan-2')).toBeInTheDocument();
  });

  test('titik adegan melompat dan menandai adegan aktif', () => {
    render(<DemoPlayer scenes={scenes} />);
    const dots = screen.getAllByRole('button', { name: /^Adegan \d$/ });
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute('aria-current', 'true');

    fireEvent.click(dots[2] as HTMLElement);
    expect(screen.getByText('adegan-3')).toBeInTheDocument();
    expect(screen.getByText('Hasilnya jadi kartu')).toBeInTheDocument();
    expect(dots[2]).toHaveAttribute('aria-current', 'true');
    expect(dots[0]).not.toHaveAttribute('aria-current');
  });

  test('melompat mengulang hitungan durasi adegan baru', () => {
    render(<DemoPlayer scenes={scenes} />);
    act(() => vi.advanceTimersByTime(900));
    fireEvent.click(screen.getByRole('button', { name: 'Adegan 2' }));
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByText('adegan-2')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('adegan-3')).toBeInTheDocument();
  });

  test('satu adegan saja tidak menampilkan titik adegan', () => {
    render(<DemoPlayer scenes={scenes.slice(0, 1)} />);
    expect(screen.queryByRole('button', { name: /^Adegan/ })).not.toBeInTheDocument();
  });
});

describe('fallback per adegan', () => {
  const mixed = [
    { kind: 'kode', caption: 'Salin semua pesan', durationMs: 1000, render: () => <p>adegan-1</p> },
    { kind: 'klip', caption: 'Pilih banyak pesan di WhatsApp' },
    {
      kind: 'kode',
      caption: 'Hasilnya jadi kartu',
      durationMs: 1000,
      render: () => <p>adegan-3</p>,
    },
  ] satisfies DemoScene[];

  test('klip tanpa berkas tampil sebagai langkah teks; adegan kode tetap berganti', () => {
    const { container } = render(<DemoPlayer scenes={mixed} />);
    expect(screen.getByText('adegan-1')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    // Adegan klip tanpa berkas: kartu langkah bernomor, tanpa elemen video, keterangan tampil sekali.
    expect(screen.getAllByText('Pilih banyak pesan di WhatsApp')).toHaveLength(1);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();

    // Ikut berganti seperti adegan kode (TEXT_SCENE_MS), lalu adegan kode berikutnya beranimasi lagi.
    act(() => vi.advanceTimersByTime(TEXT_SCENE_MS - 1));
    expect(screen.getByText('Pilih banyak pesan di WhatsApp')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('adegan-3')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('adegan-1')).toBeInTheDocument();
  });

  test('Jeda juga menghentikan kartu langkah teks', () => {
    render(<DemoPlayer scenes={mixed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adegan 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }));
    act(() => vi.advanceTimersByTime(TEXT_SCENE_MS * 3));
    expect(screen.getByText('Pilih banyak pesan di WhatsApp')).toBeInTheDocument();
  });

  test('klip dengan galat muat menjadi langkah teks untuk adegan itu saja', () => {
    const scenesWithClip: DemoScene[] = [
      { kind: 'klip', caption: 'Menu pasang', berkas: 'x-1.webm' },
      { kind: 'kode', caption: 'Lalu begini', durationMs: 1000, render: () => <p>adegan-k</p> },
    ];
    const { container } = render(<DemoPlayer scenes={scenesWithClip} />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.error(video as HTMLVideoElement);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText('Menu pasang')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adegan 2' }));
    expect(screen.getByText('adegan-k')).toBeInTheDocument();
  });

  test('prefers-reduced-motion: daftar bernomor, tanpa adegan atau timer', () => {
    mockMedia(true);
    render(<DemoPlayer scenes={scenes} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('list').tagName).toBe('OL');
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jeda' })).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('daftar tanpa adegan sama sekali tidak merender apa pun', () => {
    const { container } = render(<DemoPlayer scenes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('adegan klip', () => {
  const klip: DemoScene[] = [
    {
      kind: 'klip',
      caption: 'Tekan lama satu pesan',
      berkas: 'tip-1.webm',
      cues: [
        { at: 0, text: 'Tekan lama satu pesan' },
        { at: 3, text: 'Ketuk pesan lainnya' },
        { at: 6, text: 'Salin' },
      ],
    },
  ];

  test('video tanpa suara, berulang, tidak diunduh sebelum dimainkan; keterangan mengikuti cue', () => {
    const { container } = render(<DemoPlayer scenes={klip} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('preload', 'none');
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    // `berkas` = nama polos; URL dibangun pemutar di bawah /klip/.
    expect(video).toHaveAttribute('src', '/klip/tip-1.webm');
    expect(screen.getByText('Tekan lama satu pesan')).toBeInTheDocument();

    Object.defineProperty(video, 'currentTime', { configurable: true, value: 3.2 });
    fireEvent.timeUpdate(video);
    expect(screen.getByText('Ketuk pesan lainnya')).toBeInTheDocument();

    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0.1 });
    fireEvent.timeUpdate(video);
    expect(screen.getByText('Tekan lama satu pesan')).toBeInTheDocument();
  });

  test('Jeda menjeda video', () => {
    const { container } = render(<DemoPlayer scenes={klip} />);
    expect(container.querySelector('video')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  test('pada pemutar banyak adegan, klip selesai lalu lanjut ke adegan berikutnya', () => {
    const mixed: DemoScene[] = [...klip, ...scenes.slice(0, 1)];
    const { container } = render(<DemoPlayer scenes={mixed} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.loop).toBe(false);
    fireEvent.ended(video);
    expect(screen.getByText('adegan-1')).toBeInTheDocument();
  });
  test('timer cadangan: klip yang tak pernah mengirim ended/error tidak menggantung adegan', () => {
    const mixed: DemoScene[] = [...klip, ...scenes.slice(0, 1)];
    render(<DemoPlayer scenes={mixed} />);
    act(() => vi.advanceTimersByTime(CLIP_BACKUP_MS - 1));
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('adegan-1')).toBeInTheDocument();
  });

  test('timer cadangan berhenti saat dijeda', () => {
    const mixed: DemoScene[] = [...klip, ...scenes.slice(0, 1)];
    render(<DemoPlayer scenes={mixed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jeda' }));
    act(() => vi.advanceTimersByTime(CLIP_BACKUP_MS * 2));
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();
  });

  test('klip satu adegan berulang tanpa timer cadangan', () => {
    const { container } = render(<DemoPlayer scenes={klip} />);
    act(() => vi.advanceTimersByTime(CLIP_BACKUP_MS * 2));
    expect(container.querySelector('video')).not.toBeNull();
  });

  test('pemutaran otomatis ditolak: adegan jatuh ke kartu langkah teks lalu berganti', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
      Promise.reject(new DOMException('ditolak', 'NotAllowedError')),
    );
    const mixed: DemoScene[] = [...klip, ...scenes.slice(0, 1)];
    const { container } = render(<DemoPlayer scenes={mixed} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByText('Tekan lama satu pesan')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TEXT_SCENE_MS));
    expect(screen.getByText('adegan-1')).toBeInTheDocument();
  });

  test('AbortError (play disela pause) bukan penolakan', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
      Promise.reject(new DOMException('disela', 'AbortError')),
    );
    const { container } = render(<DemoPlayer scenes={klip} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('video')).not.toBeNull();
  });
});
