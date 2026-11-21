import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { pickLink, pickSelect } from '@/test/link-field';
import { toQrFormDefaults } from '../schemas';
import { QrDesignForm, type QrDesignFormProps } from './qr-design-form';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const ITEM_OPTIONS = [
  { id: 'i1', brand: 'PBE', model: 'M5-400', businessUnitIds: ['bu1'], manualBookName: '' },
  { id: 'i2', brand: 'Nexus', model: 'N1', businessUnitIds: ['bu2'], manualBookName: '' },
];

const BUS = [
  { id: 'bu1', code: 'SPC', name: 'Spectrum', status: 'active' },
  { id: 'bu2', code: 'NXT', name: 'Nexus', status: 'active' },
  { id: 'bu3', code: 'OLD', name: 'Lama', status: 'inactive' },
];

const SPECTRUM = {
  id: 'p1',
  name: 'Standar Spectrum',
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

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  apiMock.mockReset();
  toast.success.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    switch (id) {
      case 'qrcodes.itemOptions':
        return { items: ITEM_OPTIONS, nextCursor: null };
      case 'businessUnits.options':
        return BUS;
      case 'qrcodes.savePreset':
        return { ...SPECTRUM, id: 'p2', name: 'Standar Nexus', buId: 'bu2' };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

function renderForm(props: Partial<QrDesignFormProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QrDesignForm
        formId="qr-design-form"
        presets={[SPECTRUM]}
        canCreatePreset
        logoLibrary={[]}
        defaultValues={{
          ...toQrFormDefaults(),
          linkSource: 'url',
          link: 'https://contoh.com',
        }}
        onSubmit={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

async function openPresetOptions() {
  await userEvent.click(screen.getByRole('combobox', { name: 'Pilih konfigurasi default' }));
}

test('BU item belum punya preset: pemilih preset memuat baris "Tambah preset"', async () => {
  renderForm();
  await pickLink(screen, 'Item', 'Nexus N1');
  await openPresetOptions();
  expect(await screen.findByRole('option', { name: /Tambah preset/ })).toBeInTheDocument();
});

test('tanpa hak membuat preset: tidak ada baris "Tambah preset"', async () => {
  renderForm({ canCreatePreset: false });
  await pickLink(screen, 'Item', 'Nexus N1');
  await openPresetOptions();
  await screen.findByRole('option', { name: /Tanpa preset/ });
  expect(screen.queryByRole('option', { name: /Tambah preset/ })).toBeNull();
});

test('item lintas BU yang semua BU-nya sudah punya preset: tanpa baris "Tambah preset"', async () => {
  const nexus = { ...SPECTRUM, id: 'p2', name: 'Standar Nexus', buId: 'bu2' };
  renderForm({ presets: [SPECTRUM, nexus] });
  await pickLink(screen, 'Item', 'PBE M5-400');
  await pickLink(screen, 'Item', 'Nexus N1');
  await openPresetOptions();
  await screen.findByRole('option', { name: /Standar Spectrum/ });
  expect(screen.queryByRole('option', { name: /Tambah preset/ })).toBeNull();
});

test('dialog Tambah preset dirender di luar form QR, hanya menawarkan BU item tanpa preset, lalu menyimpan', async () => {
  renderForm();
  await pickLink(screen, 'Item', 'Nexus N1');
  await openPresetOptions();
  await userEvent.click(await screen.findByRole('option', { name: /Tambah preset/ }));
  await screen.findByText('Tambah konfigurasi default');
  const dialog = await screen.findByRole('alertdialog');
  // Submit dialog lewat portal React tak boleh naik ke form QR: dialog berada di luar elemen form itu.
  expect(dialog.closest('form#qr-design-form')).toBeNull();
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Business Unit' }));
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([expect.stringContaining('Nexus')]);
  await userEvent.click(options[0] as HTMLElement);
  await userEvent.type(within(dialog).getByLabelText('Nama konfigurasi default'), 'Standar Nexus');
  await pickSelect(within(dialog), 'Penempatan nama Manual Book', 'Subtitle');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan default' }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('qrcodes.savePreset', expect.anything()),
  );
  const call = apiMock.mock.calls.find((entry) => entry[0] === 'qrcodes.savePreset');
  expect(call?.[1]).toMatchObject({
    name: 'Standar Nexus',
    buId: 'bu2',
    namePlacement: 'subtitle',
  });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(toast.success).toHaveBeenCalledWith('Konfigurasi default disimpan');
});

test('belum ada preset sama sekali: tetap ada pemilih dengan baris "Tambah preset" bila berhak', async () => {
  renderForm({ presets: [] });
  await pickLink(screen, 'Item', 'Nexus N1');
  await openPresetOptions();
  expect(await screen.findByRole('option', { name: /Tambah preset/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Tanpa preset/ })).toBeInTheDocument();
});

test('belum ada preset dan tanpa hak membuat: hanya keterangan nilai bawaan, tanpa pemilih', async () => {
  renderForm({ presets: [], canCreatePreset: false });
  await pickLink(screen, 'Item', 'Nexus N1');
  expect(
    await screen.findByText(/Belum ada konfigurasi default; QR dibuat dengan nilai bawaan/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Pilih konfigurasi default' })).toBeNull();
});
