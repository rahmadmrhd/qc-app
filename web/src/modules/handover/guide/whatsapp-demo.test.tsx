import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitWhatsappBatch } from '@shared/handover-paste';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { SAMPLE_TEXT, WhatsappDemoScenes } from './whatsapp-demo';

const results = splitWhatsappBatch(SAMPLE_TEXT);
const kode = WhatsappDemoScenes.filter((scene) => scene.kind === 'kode');

function resultScene() {
  const scene = kode[3];
  if (scene?.kind !== 'kode') throw new Error('adegan hasil tidak ada');
  return scene;
}

describe('demo Tempel dari WhatsApp', () => {
  test('empat adegan kode lalu satu klip tanpa berkas (menunggu rekaman pemilik)', () => {
    expect(kode).toHaveLength(4);
    expect(WhatsappDemoScenes).toHaveLength(5);
    const klip = WhatsappDemoScenes[4];
    expect(klip?.kind).toBe('klip');
    expect(klip && 'berkas' in klip ? klip.berkas : undefined).toBeUndefined();
  });

  test('teks contoh menghasilkan lebih dari satu task dengan usulan customer', () => {
    expect(results.length).toBeGreaterThan(1);
    for (const task of results) expect(task.customerSuggestion).not.toBe('');
  });

  test('adegan hasil: jumlah kartu dan nama customer dari splitWhatsappBatch, bukan angka tulis tangan', () => {
    render(<>{resultScene().render()}</>);
    for (const [index, task] of results.entries()) {
      expect(screen.getByText(`Task ${index + 1}`)).toBeInTheDocument();
      expect(screen.getByText(`Customer: ${task.customerSuggestion}`)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/^Task \d+$/)).toHaveLength(results.length);
    expect(resultScene().caption).toContain(`${results.length} kartu`);
  });

  test('adegan tempel dan pecah menampilkan teks contoh dan tombol Pecah', () => {
    for (const index of [1, 2]) {
      const scene = kode[index];
      if (scene?.kind !== 'kode') throw new Error('adegan kode tidak ada');
      const { unmount } = render(<>{scene.render()}</>);
      expect(screen.getByText(/PT Maju Jaya/)).toBeInTheDocument();
      expect(screen.getByText('Pecah')).toBeInTheDocument();
      unmount();
    }
  });

  test('adegan memakai token tema, tanpa warna tetap', () => {
    const source = readFileSync(join(__dirname, 'whatsapp-demo.tsx'), 'utf8');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgb|hsl|oklch)a?\(/);
    expect(source).not.toMatch(
      /\b(?:bg|text|border|ring)-(?:red|green|blue|yellow|gray|slate|white|black)\b/,
    );
    for (const scene of kode) {
      const { container, unmount } = render(<>{scene.kind === 'kode' ? scene.render() : null}</>);
      expect(container.innerHTML).not.toMatch(/style="[^"]*(?:#|rgb)/);
      unmount();
    }
  });
});
