import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { registerDemoLoader, registerDemoScenes } from '../../lib/demo-types';
import { renderTourTip } from './tour-tip';

const scene = (caption: string) =>
  ({ kind: 'kode', caption, durationMs: 5000, render: () => <p>isi</p> }) as const;

describe('renderTourTip', () => {
  test('tipId terdaftar: menampilkan pemutar demo dengan keterangan adegan', async () => {
    registerDemoScenes('tip-uji-terdaftar', [scene('Keterangan adegan uji')]);
    render(renderTourTip('tip-uji-terdaftar'));
    expect(
      await screen.findByText('Keterangan adegan uji', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  }, 15_000);

  test('adegan dimuat malas dan belum pernah dimuat: tetap tampil setelah termuat', async () => {
    let loads = 0;
    registerDemoLoader('tip-uji-malas', async () => {
      loads += 1;
      return [scene('Adegan dari pemuat malas')];
    });
    render(renderTourTip('tip-uji-malas'));
    expect(
      await screen.findByText('Adegan dari pemuat malas', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(loads).toBe(1);
  }, 15_000);

  test('tipId tanpa demo (tak terdaftar, tanpa pemuat): tidak merender apa pun', async () => {
    const { container } = render(renderTourTip('tip-tak-ada'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(container).toBeEmptyDOMElement();
  });

  test('tipId terdaftar tanpa adegan: tidak merender apa pun', async () => {
    registerDemoScenes('tip-uji-kosong', []);
    const { container } = render(renderTourTip('tip-uji-kosong'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(container).toBeEmptyDOMElement();
  });

  test('pemuat yang gagal: tidak merender apa pun dan tidak melempar', async () => {
    registerDemoLoader('tip-uji-gagal', async () => {
      throw new Error('gagal');
    });
    const { container } = render(renderTourTip('tip-uji-gagal'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(container).toBeEmptyDOMElement();
  });
});
