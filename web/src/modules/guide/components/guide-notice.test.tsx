import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEntry } from '../lib/types';

const state = vi.hoisted(() => ({
  ready: true,
  offers: [] as { entry: GuideEntry; stepCount: number; updated?: boolean }[],
  blocking: false,
}));
vi.mock('@/modules/push/components/push-onboarding', () => ({
  useBlockingOnboardingActive: () => state.blocking,
}));
vi.mock('../lib/use-offered-guides', () => ({
  useOfferedGuides: () => ({ ready: state.ready, offers: state.ready ? state.offers : [] }),
}));
vi.mock('./guide-menu-dialog', () => ({
  GuideMenuDialog: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Panduan">
      <button type="button" onClick={onClose}>
        Tutup dialog
      </button>
    </div>
  ),
}));

import { GuideNotice } from './guide-notice';

function entry(id: string): GuideEntry {
  return { id, kind: 'dasar', status: 'disimpan', version: 1, title: id, steps: [] };
}

beforeEach(() => {
  state.ready = true;
  state.blocking = false;
  state.offers = [];
});

describe('GuideNotice', () => {
  test('hanya memberi tahu jumlah panduan yang belum diikuti, tanpa daftar judul', () => {
    state.offers = [
      { entry: entry('Mengenal tampilan'), stepCount: 5 },
      { entry: entry('Serah Terima'), stepCount: 4 },
    ];
    render(<GuideNotice />);
    expect(screen.getByText(/Ada 2 panduan yang belum kamu ikuti/)).toBeInTheDocument();
    expect(screen.queryByText('Mengenal tampilan')).toBeNull();
    expect(screen.queryByRole('button', { name: /Mulai/ })).toBeNull();
  });

  test('tombol "Lihat panduan" membuka dialog daftar panduan dan bisa ditutup', async () => {
    state.offers = [{ entry: entry('a'), stepCount: 1 }];
    render(<GuideNotice />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Lihat panduan' }));
    expect(screen.getByRole('dialog', { name: 'Panduan' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tutup dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('tidak merender apa pun bila tidak ada penawaran atau belum ready', () => {
    const view = render(<GuideNotice />);
    expect(view.container).toBeEmptyDOMElement();
    state.ready = false;
    state.offers = [{ entry: entry('a'), stepCount: 2 }];
    view.rerender(<GuideNotice />);
    expect(view.container).toBeEmptyDOMElement();
  });

  test('M5: ditunda selama dialog/banner PushOnboarding tampil, muncul begitu hilang', () => {
    state.blocking = true;
    state.offers = [{ entry: entry('a'), stepCount: 2 }];
    const view = render(<GuideNotice />);
    expect(view.container).toBeEmptyDOMElement();
    state.blocking = false;
    view.rerender(<GuideNotice />);
    expect(screen.getByText(/Ada 1 panduan/)).toBeInTheDocument();
  });
});
