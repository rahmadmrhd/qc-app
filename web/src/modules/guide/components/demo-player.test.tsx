import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DemoScene } from '../lib/demo-types';
import { DemoPlayer } from './demo-player';

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

describe('fallback daftar langkah bernomor', () => {
  const steps = [
    { kind: 'kode', caption: 'Salin semua pesan', durationMs: 1000, render: () => <p>adegan-1</p> },
    { kind: 'klip', caption: 'Pilih banyak pesan di WhatsApp' },
  ] satisfies DemoScene[];

  test('adegan klip tanpa berkas: seluruh keterangan jadi daftar bernomor tanpa animasi', () => {
    render(<DemoPlayer scenes={steps} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Salin semua pesan',
      'Pilih banyak pesan di WhatsApp',
    ]);
    expect(screen.getByRole('list').tagName).toBe('OL');
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jeda' })).not.toBeInTheDocument();
  });

  test('klip dengan galat muat beralih ke daftar bernomor', () => {
    const klip: DemoScene[] = [{ kind: 'klip', caption: 'Menu pasang', berkas: '/klip/x-1.webm' }];
    const { container } = render(<DemoPlayer scenes={klip} />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.error(video as HTMLVideoElement);
    expect(screen.getByRole('list').tagName).toBe('OL');
    expect(screen.getByText('Menu pasang')).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
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
      berkas: '/klip/tip-1.webm',
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
});
