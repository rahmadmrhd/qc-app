import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockMatchMedia } from '@/test/match-media';
import { FormPage } from './form-page';
import { FormSection } from './form-section';

function renderPage(props: Partial<Parameters<typeof FormPage>[0]> = {}, onSubmit = vi.fn()) {
  render(
    <TooltipProvider>
      <FormPage formId="f" title="Tambah merk" onCancel={() => undefined} {...props}>
        <form
          id="f"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input aria-label="Nama" />
        </form>
      </FormPage>
    </TooltipProvider>,
  );
  return onSubmit;
}

test('Simpan di header men-submit form walau tombol di luar elemen form', async () => {
  const onSubmit = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('Batal memanggil onCancel; extra dirender', async () => {
  const onCancel = vi.fn();
  renderPage({ onCancel, extra: <button type="button">Lainnya</button> });
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Lainnya' })).toBeInTheDocument();
});

test('submitting menonaktifkan Simpan dengan teks "Menyimpan…"', () => {
  renderPage({ submitting: true });
  expect(screen.getByRole('button', { name: 'Menyimpan…' })).toBeDisabled();
});

test('submitDisabled menonaktifkan Simpan; judul h1 dan badge tampil', () => {
  renderPage({ submitDisabled: true, badge: <span>Nonaktif</span> });
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  expect(screen.getByRole('heading', { level: 1, name: 'Tambah merk' })).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
});

test('tour, actionsTour, dan saveTour menjadi data-tour', () => {
  const { container } = render(
    <FormPage
      formId="g"
      title="X"
      onCancel={() => undefined}
      tour="judul"
      actionsTour="aksi"
      saveTour="simpan"
    >
      <form id="g" />
    </FormPage>,
  );
  expect(container.querySelector('[data-tour="judul"]')).not.toBeNull();
  expect(container.querySelector('[data-tour="aksi"]')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Simpan' })).toHaveAttribute('data-tour', 'simpan');
});

test('FormSection menyusun kisi dua kolom atau satu', () => {
  const { container, rerender } = render(
    <FormSection title="Umum">
      <input aria-label="a" />
    </FormSection>,
  );
  expect(screen.getByRole('heading', { name: 'Umum' })).toBeInTheDocument();
  expect(container.querySelector('.md\\:grid-cols-2')).not.toBeNull();
  rerender(
    <FormSection columns={1}>
      <input aria-label="a" />
    </FormSection>,
  );
  expect(container.querySelector('.md\\:grid-cols-2')).toBeNull();
});

test('ponsel: Batal + Simpan pindah ke bar bawah fixed; tanpa tombol kembali dan judul h1 hanya untuk pembaca layar', async () => {
  const media = mockMatchMedia(false);
  const onCancel = vi.fn();
  const onSubmit = renderPage({ onCancel });
  const bar = screen.getByRole('region', { name: 'Aksi form' });
  expect(within(bar).getByRole('button', { name: 'Batal' })).toBeInTheDocument();
  const save = within(bar).getByRole('button', { name: 'Simpan' });
  expect(save.className).toContain('flex-[2]');
  await userEvent.click(save);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(bar.className).toContain('fixed');
  expect(screen.queryByRole('button', { name: 'Kembali' })).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).className).toContain('narrow:sr-only');
  await userEvent.click(within(bar).getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  media.restore();
});

test('ponsel: hideMobileBar menyembunyikan bar bawah; di desktop tak berpengaruh', () => {
  const media = mockMatchMedia(false);
  const { unmount } = render(
    <TooltipProvider>
      <FormPage formId="f" title="Tambah" onCancel={() => undefined} hideMobileBar>
        <form id="f" />
      </FormPage>
    </TooltipProvider>,
  );
  expect(screen.queryByRole('region', { name: 'Aksi form' })).toBeNull();
  unmount();
  media.set(true);
  render(
    <TooltipProvider>
      <FormPage formId="f" title="Tambah" onCancel={() => undefined} hideMobileBar>
        <form id="f" />
      </FormPage>
    </TooltipProvider>,
  );
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeInTheDocument();
  media.restore();
});

test('ponsel: target panduan tetap ada (tour di bar judul; actionsTour dan saveTour di bar bawah fixed)', () => {
  const media = mockMatchMedia(false);
  const { container } = render(
    <FormPage
      formId="g"
      title="X"
      onCancel={() => undefined}
      tour="judul"
      actionsTour="aksi"
      saveTour="simpan"
    >
      <form id="g" />
    </FormPage>,
  );
  const bar = screen.getByRole('region', { name: 'Aksi form' });
  expect(container.querySelector('[data-tour="judul"]')).not.toBeNull();
  expect(bar.querySelector('[data-tour="aksi"]')).not.toBeNull();
  expect(within(bar).getByRole('button', { name: 'Simpan' })).toHaveAttribute(
    'data-tour',
    'simpan',
  );
  // Satu pembungkus aksi saja yang dirender (bukan juga di bar judul): target panduan tak ganda.
  expect(container.querySelectorAll('[data-tour="aksi"]')).toHaveLength(1);
  media.restore();
});
