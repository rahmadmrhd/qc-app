import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { ListPage } from './list-page';

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

beforeEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: 3000,
    configurable: true,
  });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'scrollY');
});

function renderPage(props: { pinned?: boolean } = {}) {
  return render(
    <ListPage
      title="Merk"
      actions={<button type="button">Tambah</button>}
      filters={<input aria-label="Cari" />}
      bulkBar={<div>bar massal</div>}
      tour="judul"
      actionsTour="aksi"
      {...props}
    >
      <p>isi</p>
    </ListPage>,
  );
}

test('merender judul, aksi, filter, isi, dan bar massal; akar punya --headroom-offset', () => {
  const { container } = renderPage();
  expect(screen.getByRole('heading', { level: 1, name: 'Merk' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tambah' })).toBeInTheDocument();
  expect(screen.getByLabelText('Cari')).toBeInTheDocument();
  expect(screen.getByText('isi')).toBeInTheDocument();
  expect(screen.getByText('bar massal')).toBeInTheDocument();
  const root = container.firstElementChild as HTMLElement;
  expect(root.style.getPropertyValue('--headroom-offset')).toMatch(/^calc\(3\.5rem \+ \d+px\)$/);
});

test('tour dan actionsTour menjadi data-tour', () => {
  const { container } = renderPage();
  expect(container.querySelector('[data-tour="judul"]')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Tambah' }).parentElement).toHaveAttribute(
    'data-tour',
    'aksi',
  );
});

test('bar tersembunyi inert dan tampil lagi HANYA lewat gulir naik (bukan karena fokus)', () => {
  const { container } = renderPage();
  const bar = container.querySelector('[data-headroom-frame] > div') as HTMLElement;
  expect(bar).not.toHaveAttribute('inert');
  scrollTo(300);
  expect(bar).toHaveAttribute('data-hidden');
  expect(bar).toHaveAttribute('inert');
  // Fokus (mis. dari skrip/tur) tidak memunculkan bar.
  act(() => {
    bar.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
  expect(bar).toHaveAttribute('inert');
  scrollTo(296);
  expect(bar).not.toHaveAttribute('data-hidden');
  expect(bar).not.toHaveAttribute('inert');
});

test('pinned tak pernah tersembunyi', () => {
  const { container } = renderPage({ pinned: true });
  const bar = container.querySelector('[data-headroom-frame] > div') as HTMLElement;
  scrollTo(300);
  expect(bar).not.toHaveAttribute('data-hidden');
});
