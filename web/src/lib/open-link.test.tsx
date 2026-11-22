import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LinkField } from '@/components/link-field';
import { renderInRouter } from '@/test/render-in-router';

const OPTIONS = [{ id: 'a', label: 'Asus' }];

function Field() {
  return (
    <LinkField
      id="f"
      label="Merk"
      options={OPTIONS}
      value="a"
      onChange={() => undefined}
      openHref={(id) => `/item/brands?id=${id}`}
    />
  );
}

/** Memalsukan mode tampilan: `standalone` = aplikasi terpasang (PWA), selain itu tab peramban. */
function mockDisplayMode(standalone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: standalone && query === '(display-mode: standalone)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

test('tab peramban: tautan Buka membuka tab baru (isian form tidak hilang)', async () => {
  mockDisplayMode(false);
  await renderInRouter(<Field />);
  const link = screen.getByRole('link', { name: 'Buka Merk' });
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noreferrer');
  expect(link).toHaveAttribute('href', '/item/brands?id=a');
});

test('aplikasi terpasang (PWA): tanpa target baru, klik berpindah di tempat lewat router', async () => {
  mockDisplayMode(true);
  const { router } = await renderInRouter(<Field />);
  const link = screen.getByRole('link', { name: 'Buka Merk' });
  expect(link).not.toHaveAttribute('target');
  // Klik utama dicegat dan memakai riwayat router (query ikut terbawa); klik tidak jatuh ke navigasi peramban.
  const proceeded = fireEvent.click(link);
  expect(proceeded).toBe(false);
  expect(router.history.location.pathname).toBe('/item/brands');
  expect(router.history.location.search).toBe('?id=a');
});

test('aplikasi terpasang: klik dengan tombol pengubah dibiarkan ditangani peramban', async () => {
  mockDisplayMode(true);
  const { router } = await renderInRouter(<Field />);
  const link = screen.getByRole('link', { name: 'Buka Merk' });
  const proceeded = fireEvent.click(link, { ctrlKey: true });
  expect(proceeded).toBe(true);
  expect(router.history.location.pathname).toBe('/');
});
