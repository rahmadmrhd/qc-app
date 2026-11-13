import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

// Impor malas yang gagal (mis. offline/deploy): modul ini melempar saat dimuat.
vi.mock('./tour-overlay', () => {
  throw new Error('gagal memuat potongan tur');
});
vi.mock('../demo-player', () => {
  throw new Error('gagal memuat pemutar demo');
});

import { registerDemoScenes } from '../../lib/demo-types';
import type { GuideEntry } from '../../lib/types';
import { TourProvider, useTour } from './tour-provider';
import { renderTourTip } from './tour-tip';

const entry: GuideEntry = {
  id: 'dasar-layout',
  kind: 'dasar',
  status: 'disimpan',
  version: 1,
  title: 'T',
  steps: [{ target: 'a', text: 't', advance: 'next' }],
};

function Starter() {
  const tour = useTour();
  return (
    <button type="button" onClick={() => tour.start(entry)}>
      {tour.active ? 'aktif' : 'diam'}
    </button>
  );
}

describe('M15: kegagalan memuat potongan malas tidak menjatuhkan aplikasi', () => {
  test('TourProvider: tur ditutup, anak tetap dirender, tak ada galat yang lolos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <TourProvider>
        <p>isi aplikasi</p>
        <Starter />
      </TourProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'diam' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'diam' })).toBeInTheDocument());
    expect(screen.getByText('isi aplikasi')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Panduan' })).toBeNull();
    vi.restoreAllMocks();
  });

  test('renderTourTip: pemutar yang gagal dimuat dirender sebagai kosong', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerDemoScenes('tip-gagal', [
      { kind: 'kode', caption: 'tak tampil', durationMs: 1000, render: () => <p>x</p> },
    ]);
    render(
      <div data-testid="kartu">
        <p>teks langkah</p>
        {renderTourTip('tip-gagal')}
      </div>,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByText('teks langkah')).toBeInTheDocument();
    expect(screen.queryByText('tak tampil')).toBeNull();
    vi.restoreAllMocks();
  });
});
