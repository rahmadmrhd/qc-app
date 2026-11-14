import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitWhatsappBatch } from '@shared/handover-paste';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DemoPlayer } from '@/modules/guide/components/demo-player';
import type { DemoScene } from '@/modules/guide/lib/demo-types';
import { SAMPLE_TEXT, WhatsappDemoScenes } from './whatsapp-demo';

const results = splitWhatsappBatch(SAMPLE_TEXT);

function sceneAt(index: number): Extract<DemoScene, { kind: 'kode' }> {
  const scene = WhatsappDemoScenes[index];
  if (scene?.kind !== 'kode') throw new Error(`adegan ${index} bukan adegan kode`);
  return scene;
}

/** Merender satu adegan ke DOM terpisah dan mengembalikan kontainernya. */
function renderScene(index: number) {
  return render(sceneAt(index).render());
}

const RESULT_INDEX = WhatsappDemoScenes.length - 1;

describe('urutan adegan demo Tempel dari WhatsApp', () => {
  test('semua adegan kode (tanpa klip): 4 bingkai WhatsApp, tempel, Pecah, lalu hasil terakhir', () => {
    expect(WhatsappDemoScenes).toHaveLength(7);
    expect(WhatsappDemoScenes.every((scene) => scene.kind === 'kode')).toBe(true);
    expect(WhatsappDemoScenes.map((scene) => scene.caption)).toEqual([
      'Mulai dari WhatsApp: buka chat yang berisi orderan.',
      'Tekan lama satu pesan orderan.',
      'Ketuk pesan orderan lainnya biar ikut terpilih.',
      'Ketuk ikon salin.',
      'Tempel sekali saja di kotak Tempel dari WhatsApp.',
      'Tekan Pecah.',
      expect.stringContaining('kartu task'),
    ]);
  });

  test('adegan pertama adalah chat WhatsApp biasa dan adegan hasil adalah yang terakhir', () => {
    const first = renderScene(0);
    expect(first.container.querySelector('[data-slot="wa-avatar"]')).not.toBeNull();
    expect(first.container.querySelector('[data-slot="wa-selection-bar"]')).toBeNull();
    expect(screen.getByText('Tim Gudang QC')).toBeInTheDocument();
    first.unmount();

    renderScene(RESULT_INDEX);
    expect(screen.getAllByText(/^Task \d+$/)).toHaveLength(results.length);
  });

  test('pilihan bertahap: bilah pilihan 1, lalu semua pesan pesanan, lalu salin + toast', () => {
    const counts: (string | null)[] = [];
    const selected: number[] = [];
    const copied: boolean[] = [];
    for (const index of [1, 2, 3]) {
      const { container, unmount } = renderScene(index);
      counts.push(container.querySelector('[data-slot="wa-count"]')?.textContent ?? null);
      selected.push(container.querySelectorAll('[data-slot="wa-selected"]').length);
      copied.push(container.querySelector('[data-slot="wa-toast"]') !== null);
      expect(container.querySelector('[data-slot="wa-selection-bar"]')).not.toBeNull();
      expect(container.querySelector('[data-slot="wa-copy"]')?.getAttribute('data-active')).toBe(
        index === 3 ? 'true' : null,
      );
      unmount();
    }
    expect(counts).toEqual(['1', String(results.length), String(results.length)]);
    expect(selected).toEqual([1, results.length, results.length]);
    expect(copied).toEqual([false, false, true]);
  });

  test('pesan sapaan dan balasan bukan pesanan: tidak pernah tersorot', () => {
    const { container } = renderScene(2);
    expect(container.querySelectorAll('[data-slot="wa-selected"]')).toHaveLength(results.length);
    expect(screen.getByText('Pagi tim, ada orderan hari ini ya.')).toBeInTheDocument();
    expect(screen.getByText('Siap, saya proses.')).toBeInTheDocument();
  });
});

describe('bubble WhatsApp', () => {
  test('teks pesanan tampil sebagai isi, pengirim, dan jam, TANPA bracket mentah', () => {
    const { container } = renderScene(0);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\[\d{1,2}\/\d{1,2}/);
    expect(text).not.toContain('[13/11');
    expect(text).not.toMatch(/\]\s*Rina WH:/);
    expect(screen.getAllByText('Rina WH')).toHaveLength(results.length);
    expect(screen.getByText('09.15')).toBeInTheDocument();
    expect(screen.getByText('09.20')).toBeInTheDocument();
    expect(screen.getByText('CRS310 = 2 unit')).toBeInTheDocument();
    expect(screen.getByText('AF 5XHD = 5 unit')).toBeInTheDocument();
  });

  test('isi bubble pesanan sama dengan tempelan yang dikenali splitWhatsappBatch', () => {
    // Setiap baris isi (bukan awalan) pada SAMPLE_TEXT ada sebagai baris bubble.
    const { container } = renderScene(0);
    const body = container.textContent ?? '';
    for (const task of results) {
      for (const line of task.note.split('\n')) {
        const plain = line.replace(/^- \[ \] /, '');
        expect(body).toContain(plain);
      }
    }
  });

  test('tiruan layout saja: tanpa gambar, tautan, atau logo', () => {
    const { container } = renderScene(1);
    expect(container.querySelector('img, a, image')).toBeNull();
    const source = readFileSync(join(__dirname, 'whatsapp-mock.tsx'), 'utf8');
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/<img|<image|url\(/);
  });

  test('warna WhatsApp punya varian gelap agar terbaca di terang dan gelap', () => {
    const source = readFileSync(join(__dirname, 'whatsapp-mock.tsx'), 'utf8');
    for (const light of ['bg-[#efeae2]', 'bg-white', 'bg-[#d9fdd3]']) {
      expect(source).toContain(light);
    }
    expect(source).toMatch(/dark:bg-\[#0b141a\]/);
    expect(source).toMatch(/dark:bg-\[#202c33\]/);
    expect(source).toMatch(/dark:bg-\[#005c4b\]/);
  });

  test('tanpa scroll horizontal: pembungkus overflow-hidden dan teks boleh patah', () => {
    const { container } = renderScene(0);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('overflow-hidden');
    expect(root.className).toContain('min-w-0');
    expect(container.querySelectorAll('p.break-words').length).toBeGreaterThan(0);
  });
});

describe('adegan Pecah dan hasil', () => {
  test('hasil: jumlah kartu dan nama customer dihitung splitWhatsappBatch asli, bukan angka tulis tangan', () => {
    renderScene(RESULT_INDEX);
    for (const [index, task] of results.entries()) {
      expect(screen.getByText(`Task ${index + 1}`)).toBeInTheDocument();
      expect(screen.getByText(`Customer: ${task.customerSuggestion}`)).toBeInTheDocument();
    }
    expect(sceneAt(RESULT_INDEX).caption).toContain(`${results.length} kartu`);
  });

  test('teks contoh menghasilkan lebih dari satu task dengan usulan customer', () => {
    expect(results.length).toBeGreaterThan(1);
    for (const task of results) expect(task.customerSuggestion).not.toBe('');
  });

  test('tempel dan pecah menampilkan teks contoh (format ekspor, dikenali pemecah) dan tombol Pecah', () => {
    for (const index of [4, 5]) {
      const { unmount } = renderScene(index);
      expect(screen.getByText(/PT Maju Jaya/)).toBeInTheDocument();
      expect(screen.getByText('Pecah')).toBeInTheDocument();
      unmount();
    }
    expect(SAMPLE_TEXT).toContain('[13/11, 09.15] Rina WH: PT Maju Jaya :');
  });
});

describe('tema', () => {
  test('adegan non-WhatsApp memakai token tema, tanpa warna tetap', () => {
    const source = readFileSync(join(__dirname, 'whatsapp-demo.tsx'), 'utf8');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgb|hsl|oklch)a?\(/);
    expect(source).not.toMatch(
      /\b(?:bg|text|border|ring)-(?:red|green|blue|yellow|gray|slate|white|black)\b/,
    );
  });
});

describe('di dalam DemoPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    // biome-ignore lint/suspicious/noExplicitAny: memulihkan stub jsdom
    delete (window as any).matchMedia;
  });

  test('tujuh titik adegan tetap sepanjang pemutaran, urut dari chat sampai hasil, tanpa kartu langkah teks', () => {
    const { container } = render(<DemoPlayer scenes={WhatsappDemoScenes} />);
    const dots = () => screen.getAllByRole('button', { name: /^Adegan \d+$/ });
    expect(dots()).toHaveLength(WhatsappDemoScenes.length);
    expect(dots().map((dot) => dot.getAttribute('aria-label'))).toEqual(
      WhatsappDemoScenes.map((_, i) => `Adegan ${i + 1}`),
    );
    expect(container.querySelector('[data-slot="wa-avatar"]')).not.toBeNull();

    // Seluruh siklus: jumlah titik tidak berubah dan urutan adegan sesuai.
    const seen: string[] = [];
    for (const scene of WhatsappDemoScenes) {
      seen.push(screen.getByText(scene.caption).textContent ?? '');
      expect(dots()).toHaveLength(WhatsappDemoScenes.length);
      act(() => vi.advanceTimersByTime(scene.kind === 'kode' ? scene.durationMs : 0));
    }
    expect(seen).toEqual(WhatsappDemoScenes.map((scene) => scene.caption));
    // Kembali ke adegan pertama (berulang).
    expect(container.querySelector('[data-slot="wa-avatar"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: `Adegan ${WhatsappDemoScenes.length}` }));
    expect(screen.getAllByText(/^Task \d+$/)).toHaveLength(results.length);
  });
});
