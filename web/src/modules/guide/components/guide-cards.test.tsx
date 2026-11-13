import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEntry } from '../lib/types';

const state = vi.hoisted(() => ({
  ready: true,
  offers: [] as { entry: GuideEntry; stepCount: number }[],
  start: vi.fn(),
}));
vi.mock('../lib/use-offered-guides', () => ({
  useOfferedGuides: () => ({ ready: state.ready, offers: state.ready ? state.offers : [] }),
}));
vi.mock('./tour/tour-provider', () => ({
  useTour: () => ({ start: state.start, active: false }),
}));

import { GuideCards } from './guide-cards';

function entry(id: string, title: string): GuideEntry {
  return { id, kind: 'dasar', status: 'disimpan', version: 1, title, steps: [] };
}

beforeEach(() => {
  state.ready = true;
  state.offers = [];
  state.start.mockReset();
});

describe('GuideCards', () => {
  test('menampilkan tiap penawaran dengan judul, jumlah langkah, dan tombol Mulai', async () => {
    const first = entry('a', 'Mengenal tampilan');
    const second = entry('b', 'Serah Terima dasar');
    state.offers = [
      { entry: first, stepCount: 5 },
      { entry: second, stepCount: 1 },
    ];
    render(<GuideCards />);
    expect(screen.getByRole('heading', { name: 'Panduan untuk kamu' })).toBeInTheDocument();
    expect(screen.getByText('Mengenal tampilan')).toBeInTheDocument();
    expect(screen.getByText('5 langkah')).toBeInTheDocument();
    expect(screen.getByText('1 langkah')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /Mulai/ });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1] as HTMLElement);
    expect(state.start).toHaveBeenCalledWith(second);
  });

  test('tidak merender apa pun bila tidak ada penawaran', () => {
    const { container } = render(<GuideCards />);
    expect(container).toBeEmptyDOMElement();
  });

  test('tidak merender apa pun bila belum ready', () => {
    state.ready = false;
    state.offers = [{ entry: entry('a', 'X'), stepCount: 2 }];
    const { container } = render(<GuideCards />);
    expect(container).toBeEmptyDOMElement();
  });
});
