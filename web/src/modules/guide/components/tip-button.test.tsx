import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { DemoScene } from '../lib/demo-types';

const store = vi.hoisted(() => ({
  ready: true,
  done: new Map<string, number>(),
  mark: vi.fn(async () => undefined),
  reset: vi.fn(async () => undefined),
}));
vi.mock('../lib/use-guide-store', () => ({ useGuideStore: () => store }));

import { registerDemoLoader, registerDemoScenes } from '../lib/demo-types';
import { TipButton } from './tip-button';

const LABEL = 'Cara tempel banyak pesan sekaligus';
const TIP = 'tip-handover-tempel-wa';
const scenes: DemoScene[] = [
  { kind: 'kode', caption: 'Salin semua pesan', durationMs: 60_000, render: () => <p>adegan-1</p> },
];

function mockPointerFine(fine: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: fine && query.includes('pointer: fine'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  store.ready = true;
  store.done = new Map();
  store.mark.mockClear();
  store.mark.mockImplementation(async () => undefined);
  mockPointerFine(false);
  registerDemoScenes(TIP, scenes);
  // jsdom tidak mengimplementasikan pemutaran media.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

describe('ikon dan titik penanda', () => {
  test('ikon memiliki nama aksesibel dari label', () => {
    render(<TipButton tipId={TIP} label={LABEL} />);
    expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument();
  });

  test('titik penanda tampil bila penanda tip belum ada', () => {
    const { container } = render(<TipButton tipId={TIP} label={LABEL} />);
    expect(container.querySelector('[data-slot="tip-dot"]')).not.toBeNull();
  });

  test('ikon permanen: penanda sudah ada = titik hilang, ikon tetap ada', () => {
    store.done = new Map([[TIP, 1]]);
    const { container } = render(<TipButton tipId={TIP} label={LABEL} />);
    expect(container.querySelector('[data-slot="tip-dot"]')).toBeNull();
    expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument();
  });

  test('titik tidak tampil selama penanda belum termuat (tanpa kedip)', () => {
    store.ready = false;
    const { container } = render(<TipButton tipId={TIP} label={LABEL} />);
    expect(container.querySelector('[data-slot="tip-dot"]')).toBeNull();
    expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument();
  });
});

describe('versi penanda', () => {
  test('penanda versi lama (lebih rendah dari versi katalog) = titik muncul lagi dan ditulis ulang saat dibuka', async () => {
    store.done = new Map([[TIP, 0]]);
    const user = userEvent.setup();
    const { container } = render(<TipButton tipId={TIP} label={LABEL} />);
    expect(container.querySelector('[data-slot="tip-dot"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: LABEL }));
    await screen.findByText('adegan-1');
    expect(store.mark).toHaveBeenCalledWith(TIP, 1);
  });

  test('penanda versi sama atau lebih baru = tanpa titik', () => {
    store.done = new Map([[TIP, 2]]);
    const { container } = render(<TipButton tipId={TIP} label={LABEL} />);
    expect(container.querySelector('[data-slot="tip-dot"]')).toBeNull();
  });
});

describe('membuka', () => {
  test('ketuk membuka demo dan menulis penanda SEKALI dengan versi terdaftar', async () => {
    const user = userEvent.setup();
    render(<TipButton tipId={TIP} label={LABEL} />);
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();
    expect(store.mark).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: LABEL }));
    expect(await screen.findByText('adegan-1')).toBeInTheDocument();
    expect(store.mark).toHaveBeenCalledTimes(1);
    expect(store.mark).toHaveBeenCalledWith(TIP, 1);

    // Tutup lalu buka lagi: penanda tidak ditulis ulang.
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByText('adegan-1')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: LABEL }));
    expect(await screen.findByText('adegan-1')).toBeInTheDocument();
    expect(store.mark).toHaveBeenCalledTimes(1);
  });

  test('penanda sudah ada: membuka tidak menulis lagi', async () => {
    store.done = new Map([[TIP, 1]]);
    const user = userEvent.setup();
    render(<TipButton tipId={TIP} label={LABEL} />);
    await user.click(screen.getByRole('button', { name: LABEL }));
    expect(await screen.findByText('adegan-1')).toBeInTheDocument();
    expect(store.mark).not.toHaveBeenCalled();
  });

  test('galat saat menulis penanda tidak merusak tooltip', async () => {
    store.mark.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<TipButton tipId={TIP} label={LABEL} />);
    await user.click(screen.getByRole('button', { name: LABEL }));
    expect(await screen.findByText('adegan-1')).toBeInTheDocument();
  });

  test('Enter pada ikon terfokus membuka (layar sentuh/tanpa pointer halus)', async () => {
    const user = userEvent.setup();
    render(<TipButton tipId={TIP} label={LABEL} />);
    await user.tab();
    expect(screen.getByRole('button', { name: LABEL })).toHaveFocus();
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('adegan-1')).toBeInTheDocument();
  });

  test('fokus keyboard membuka bila pointer halus; Enter sesudahnya tidak menutup', async () => {
    mockPointerFine(true);
    const user = userEvent.setup();
    render(<TipButton tipId={TIP} label={LABEL} />);
    await user.tab();
    expect(await screen.findByText('adegan-1')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByText('adegan-1')).toBeInTheDocument();
  });

  test('hover (pointer halus) membuka dan keluar menutup setelah jeda singkat', async () => {
    mockPointerFine(true);
    render(<TipButton tipId={TIP} label={LABEL} />);
    const button = screen.getByRole('button', { name: LABEL });
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    expect(await screen.findByText('adegan-1')).toBeInTheDocument();
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    await vi.waitFor(() => expect(screen.queryByText('adegan-1')).not.toBeInTheDocument(), {
      timeout: 5000,
    });
  });

  test('Esc menutup tooltip yang diketuk dan tidak terbuka lagi karena fokus kembali ke ikon', async () => {
    mockPointerFine(true);
    const user = userEvent.setup();
    render(<TipButton tipId={TIP} label={LABEL} />);
    await user.click(screen.getByRole('button', { name: LABEL }));
    expect(await screen.findByText('adegan-1')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByText('adegan-1')).not.toBeInTheDocument(), {
      timeout: 5000,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();
  });

  test('pointer kasar: hover tidak membuka', () => {
    render(<TipButton tipId={TIP} label={LABEL} />);
    fireEvent.pointerEnter(screen.getByRole('button', { name: LABEL }), { pointerType: 'touch' });
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();
  });

  test('klip dimuat dengan preload="none" dan tidak ada video sebelum dibuka', async () => {
    registerDemoScenes('tip-klip', [
      { kind: 'klip', caption: 'Menu pasang', berkas: 'tip-klip-1.webm' },
    ]);
    const user = userEvent.setup();
    const { baseElement } = render(<TipButton tipId="tip-klip" label="Cara pasang" />);
    expect(baseElement.querySelector('video')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cara pasang' }));
    await screen.findByText('Menu pasang');
    expect(baseElement.querySelector('video')).toHaveAttribute('preload', 'none');
  });

  test('adegan dimuat malas lewat pemuat terdaftar hanya setelah dibuka', async () => {
    const loader = vi.fn(
      async () =>
        [
          { kind: 'kode', caption: 'Malas', durationMs: 60_000, render: () => <p>adegan-malas</p> },
        ] satisfies DemoScene[],
    );
    registerDemoLoader('tip-malas', loader);
    const user = userEvent.setup();
    render(<TipButton tipId="tip-malas" label="Cara malas" />);
    expect(loader).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cara malas' }));
    expect(await screen.findByText('adegan-malas')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('pemuat yang gagal menampilkan keterangan sementara dan tidak merusak tooltip', async () => {
    registerDemoLoader('tip-gagal', async () => {
      throw new Error('chunk gagal');
    });
    const user = userEvent.setup();
    render(<TipButton tipId="tip-gagal" label="Cara gagal" />);
    await user.click(screen.getByRole('button', { name: 'Cara gagal' }));
    expect(await screen.findByText('Demonya sedang disiapkan.')).toBeInTheDocument();
  });

  test('adegan dapat diberikan lewat prop dan mengalahkan daftar terdaftar', async () => {
    const user = userEvent.setup();
    render(
      <TipButton
        tipId={TIP}
        label={LABEL}
        scenes={[
          {
            kind: 'kode',
            caption: 'Dari prop',
            durationMs: 60_000,
            render: () => <p>dari-prop</p>,
          },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: LABEL }));
    expect(await screen.findByText('dari-prop')).toBeInTheDocument();
    expect(screen.queryByText('adegan-1')).not.toBeInTheDocument();
  });
});
