import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockMatchMedia } from '@/test/match-media';
import { FormPage } from './form-page';
import { FormSection } from './form-section';
import { PageContainer } from './page-container';

afterEach(() => {
  window.innerWidth = 1024;
});

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
  window.innerWidth = 360;
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
  expect(screen.getByRole('heading', { level: 1 }).closest('.sr-only')).not.toBeNull();
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

test('ponsel tanpa lencana: tanpa bar headroom kosong ber-border/bayang; target tour tetap terpasang', () => {
  window.innerWidth = 360;
  const media = mockMatchMedia(false);
  const { container } = render(
    <TooltipProvider>
      <FormPage formId="f" title="Tambah" tour="judul" onCancel={() => undefined}>
        <form id="f" />
      </FormPage>
    </TooltipProvider>,
  );
  // Tak ada bar yang menempel (sticky) di bawah header aplikasi.
  expect(container.querySelector('[data-headroom-frame] .sticky')).toBeNull();
  const target = container.querySelector('[data-tour="judul"]');
  expect(target).not.toBeNull();
  expect(target?.className).toContain('sr-only');
  expect(screen.getByRole('heading', { level: 1, name: 'Tambah' })).toBeInTheDocument();
  media.restore();
});

test('ponsel dengan lencana: bar atas tetap tampil memuat lencana', () => {
  window.innerWidth = 360;
  const media = mockMatchMedia(false);
  const { container } = render(
    <TooltipProvider>
      <FormPage
        formId="f"
        title="Ubah"
        badge={<span>Nonaktif</span>}
        tour="judul"
        onCancel={() => undefined}
      >
        <form id="f" />
      </FormPage>
    </TooltipProvider>,
  );
  expect(container.querySelector('[data-headroom-frame] .sticky')).not.toBeNull();
  expect(screen.getByText('Nonaktif')).toBeVisible();
  media.restore();
});

test('satu gerbang ponsel: pada 704-767 px (main lebar, viewport ponsel) h1 sr-only; di >= 768 px h1 tampil', () => {
  const media = mockMatchMedia(true); // lebar <main> cukup untuk tata letak lebar
  window.innerWidth = 740;
  const { unmount } = render(
    <TooltipProvider>
      <FormPage formId="f" title="Tambah" badge={<span>b</span>} onCancel={() => undefined}>
        <form id="f" />
      </FormPage>
    </TooltipProvider>,
  );
  expect(screen.getByRole('heading', { level: 1 }).className).toContain('sr-only');
  unmount();
  window.innerWidth = 1024;
  render(
    <TooltipProvider>
      <FormPage formId="f" title="Tambah" badge={<span>b</span>} onCancel={() => undefined}>
        <form id="f" />
      </FormPage>
    </TooltipProvider>,
  );
  expect(screen.getByRole('heading', { level: 1 }).className).not.toContain('sr-only');
  media.restore();
});

// Penjaga CRITICAL review akhir (C1/C7/C14): pada 704-767 px `useIsMobile` dan `useIsDesktop` sama-sama true; tepat
// satu set Batal/Simpan harus tampil di SEMUA lebar, dengan atau tanpa lencana.
test.each([
  { width: 360, mainWide: false, where: 'bawah' },
  { width: 704, mainWide: true, where: 'atas' },
  { width: 744, mainWide: true, where: 'atas' },
  { width: 767, mainWide: true, where: 'atas' },
  { width: 768, mainWide: true, where: 'atas' },
  { width: 959, mainWide: true, where: 'atas' },
  { width: 1024, mainWide: true, where: 'atas' },
])('tanpa lencana pada $width px: tepat satu Simpan dan satu Batal ($where)', async (c) => {
  window.innerWidth = c.width;
  const media = mockMatchMedia(c.mainWide);
  const onCancel = vi.fn();
  const onSubmit = renderPage({ onCancel, actionsTour: 'aksi' });
  expect(screen.getAllByRole('button', { name: 'Simpan' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Batal' })).toHaveLength(1);
  expect(document.querySelectorAll('[data-tour="aksi"]')).toHaveLength(1);
  const bar = screen.queryByRole('region', { name: 'Aksi form' });
  expect(bar !== null).toBe(c.where === 'bawah');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  media.restore();
});

test('704-767 px tanpa lencana: bar atas membawa aksi, h1 sr-only, target tour terpasang', () => {
  window.innerWidth = 744;
  const media = mockMatchMedia(true);
  const { container } = render(
    <TooltipProvider>
      <FormPage formId="f" title="Tambah" tour="judul" onCancel={() => undefined}>
        <form id="f" />
      </FormPage>
    </TooltipProvider>,
  );
  expect(
    container.querySelector('[data-tour="judul"] .sticky, [data-tour="judul"].sticky'),
  ).not.toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).className).toContain('sr-only');
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeVisible();
  media.restore();
});

test('R15: tampilan lebar bleed ke tepi main; bar judul penuh dan isi dipusatkan berbatas pageWidth', () => {
  mockMatchMedia(true);
  const { container } = render(
    <TooltipProvider>
      <PageContainer width="narrow">
        <FormPage formId="f" title="Tambah merk" onCancel={() => undefined}>
          <form id="f">
            <input aria-label="Nama" />
          </form>
        </FormPage>
      </PageContainer>
    </TooltipProvider>,
  );
  const frame = container.querySelector('[data-headroom-frame]') as HTMLElement;
  for (const token of [
    'wide:-mx-[var(--main-pad)]',
    'wide:-mt-[var(--main-pad)]',
    'wide:-mb-[var(--main-pad)]',
  ]) {
    expect(frame.className).toContain(token);
  }
  // Bukan wadah kueri/containment: bar aksi `fixed` halaman turunan harus tetap menempel ke viewport.
  expect(frame.className).not.toContain('@container');
  const content = screen.getByLabelText('Nama').closest('.mx-auto') as HTMLElement;
  expect(content.className).toContain('max-w-4xl');
  const bar = screen
    .getByRole('heading', { level: 1 })
    .closest('[data-slot], .sticky') as HTMLElement;
  expect(bar.className).toContain('border-b');
});
