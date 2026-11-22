import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import type { QrEditContext } from '../schemas';
import { toPresetFormValues, toQrFormDefaults } from '../schemas';
import { QrDesignForm, type QrDesignFormProps, type QrFormUiState } from './qr-design-form';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const ITEM_OPTIONS = [
  { id: 'i1', brand: 'PBE', model: 'M5-400', businessUnitIds: ['bu1'], manualBookName: '' },
];

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  apiMock.mockReset();
  apiMock.mockResolvedValue({ items: ITEM_OPTIONS, nextCursor: null });
});

const FORM_ID = 'qr-design-form';

/** Meniru pembungkus halaman: tombol Simpan di luar form, "Simpan dan ekspor" membawa `data-export`. */
function Harness({
  canExport = false,
  ...props
}: Omit<QrDesignFormProps, 'formId'> & { canExport?: boolean }) {
  const [ui, setUi] = useState<QrFormUiState>({
    submitting: false,
    blocked: false,
    overflow: false,
  });
  return (
    <>
      <QrDesignForm formId={FORM_ID} onUiState={setUi} {...props} />
      <button type="submit" form={FORM_ID} disabled={ui.blocked || ui.submitting}>
        Simpan
      </button>
      {canExport ? (
        <button
          type="submit"
          form={FORM_ID}
          data-export="true"
          disabled={ui.blocked || ui.submitting || ui.overflow}
        >
          Simpan dan ekspor
        </button>
      ) : null}
    </>
  );
}

function renderForm(props: Partial<React.ComponentProps<typeof Harness>> = {}) {
  const onSubmit = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Harness
        defaultValues={{ ...toQrFormDefaults(), linkSource: 'url', link: 'https://contoh.com' }}
        onSubmit={onSubmit}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSubmit, unmount: view.unmount };
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const openTab = (name: string) =>
  userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
const hasErrorDot = (name: string) =>
  screen
    .getByRole('tab', { name: new RegExp(`^${name}`) })
    .querySelector('[data-slot="tab-error-dot"]') !== null;

const preset = {
  id: 'p1',
  name: 'Standar',
  title: 'Judul',
  subtitle: 'Sub',
  footer: 'foot',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  buId: 'bu1',
  namePlacement: 'subtitle' as const,
  createdAt: 't',
  createdBy: 'a',
  updatedAt: 't',
  updatedBy: 'a',
};

const EDIT: QrEditContext = {
  items: [{ id: 'i1', brand: 'PBE', model: 'M5-400' }],
  hiddenItemCount: 0,
  namePlacement: 'subtitle',
  presetId: 'p1',
  exportedHash: null,
  legacy: false,
  stickerVersion: 1,
};

test('tab menurut alur: Detail (item + sumber link) bukan untuk mode default', () => {
  const design = renderForm();
  expect(tabNames()).toEqual(['Detail', 'Isi label', 'Logo dan bingkai', 'Ukuran']);
  design.unmount();
  renderForm({ mode: 'defaults', defaultValues: toPresetFormValues() });
  expect(tabNames()).toEqual(['Isi label', 'Logo dan bingkai', 'Ukuran']);
});

test('QR baru sebelum item dipilih hanya punya tab Detail; empat tab muncul setelah siap', async () => {
  renderForm({ presets: [preset], defaultValues: toQrFormDefaults() });
  expect(tabNames()).toEqual(['Detail']);
  await pickLink(screen, 'Item', 'PBE M5-400');
  expect(tabNames()).toEqual(['Detail', 'Isi label', 'Logo dan bingkai', 'Ukuran']);
});

test('simpan gagal validasi: tab bergalat bertitik dan dibuka otomatis', async () => {
  const { onSubmit } = renderForm();
  expect(screen.getByRole('tab', { name: /^Detail/ })).toHaveAttribute('data-state', 'active');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /^Isi label/ })).toHaveAttribute('data-state', 'active'),
  );
  expect(hasErrorDot('Isi label')).toBe(true);
  expect(hasErrorDot('Ukuran')).toBe(false);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('galat nama dari server pada QR Manual Book membuka tab Detail', async () => {
  renderForm({
    edit: EDIT,
    defaultValues: {
      ...toQrFormDefaults(),
      name: 'N',
      itemIds: ['i1'],
      title: 'x',
      linkSource: 'url',
      link: 'https://contoh.com',
    },
    fieldErrors: { name: 'Nama sudah dipakai' },
  });
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /^Detail/ })).toHaveAttribute('data-state', 'active'),
  );
  expect(hasErrorDot('Detail')).toBe(true);
  expect(screen.getByText('Nama sudah dipakai')).toBeInTheDocument();
});

test('niat ekspor dibaca dari tombol pengirim dan tidak bocor ke Simpan berikutnya', async () => {
  const { onSubmit } = renderForm({ canExport: true });
  await openTab('Isi label');
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan dan ekspor' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls.map((call) => call[1].thenExport)).toEqual([true, false]);
});

test('pindah tab tidak menghilangkan isian di tab lain (semua panel tetap terpasang)', async () => {
  const { onSubmit } = renderForm();
  await openTab('Isi label');
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await openTab('Ukuran');
  await openTab('Logo dan bingkai');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ title: 'Panduan' });
});

test('form tidak membuat input berkas sendiri: hanya pemilih PDF di tab Detail', () => {
  renderForm();
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  expect(inputs).toHaveLength(1);
  expect(inputs[0]?.closest('[data-form-tab="detail"]')).not.toBeNull();
});
