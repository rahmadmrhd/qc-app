import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { registerDemoScenes } from '../../lib/demo-types';
import { renderTourTip } from './tour-tip';

describe('renderTourTip', () => {
  test('tipId terdaftar: menampilkan pemutar demo dengan keterangan adegan', async () => {
    registerDemoScenes('tip-uji-terdaftar', [
      {
        kind: 'kode',
        caption: 'Keterangan adegan uji',
        durationMs: 5000,
        render: () => <p>isi</p>,
      },
    ]);
    render(<>{renderTourTip('tip-uji-terdaftar')}</>);
    expect(
      await screen.findByText('Keterangan adegan uji', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  }, 15_000);

  test('tipId belum terdaftar: tidak merender apa pun', () => {
    expect(renderTourTip('tip-tak-ada')).toBeNull();
  });

  test('tipId terdaftar tanpa adegan: tidak merender apa pun', () => {
    registerDemoScenes('tip-uji-kosong', []);
    expect(renderTourTip('tip-uji-kosong')).toBeNull();
  });
});
