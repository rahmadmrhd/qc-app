import type { HandoverOptionsDto, MeDto } from '@shared/contract';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

/*
 * Simpan form Serah Terima ditahan selama editor catatan melaporkan unggahan gambar yang berjalan atau gagal
 * (`onBusyChange`; aturan lampiran berkas CLAUDE.md, spek dialog unggah seragam 5.11 butir 3). Editor mode `note` tak
 * pernah sibuk, jadi di sini `NoteEditor` diganti stub yang melaporkan sibuk lewat tombol.
 */
vi.mock('./note-editor', () => ({
  NoteEditor: ({
    id,
    value,
    onChange,
    onBusyChange,
  }: {
    id: string;
    value: string;
    onChange: (next: string) => void;
    onBusyChange?: (busy: boolean) => void;
  }) => (
    <div>
      <textarea
        aria-label={`stub ${id}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" onClick={() => onBusyChange?.(true)}>
        {`sibuk ${id}`}
      </button>
      <button type="button" onClick={() => onBusyChange?.(false)}>
        {`selesai ${id}`}
      </button>
    </div>
  ),
}));
vi.mock('@/modules/guide/lib/use-guide-store', () => ({
  useGuideStore: () => ({
    ready: true,
    done: new Map<string, number>(),
    mark: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
  }),
}));

const meMock = vi.hoisted(() => ({
  me: {
    email: 'wh@qc.local',
    name: 'WH',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'view',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
    },
    locations: [
      {
        id: 'loc-a',
        code: 'A',
        name: 'Lokasi A',
        permissions: { handover: 'manage', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
    ],
  } as MeDto,
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => meMock.me }));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ selectedIds: ['loc-a'] }),
}));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { toHandoverFormDefaults } from '../schemas';
import { HandoverBatchForm } from './handover-batch-form';
import { HandoverForm } from './handover-form';

const options: HandoverOptionsDto = {
  customers: [{ id: 'c1', name: 'PT Maju' }],
  inactiveCustomerNames: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  resetUnsavedChangesForTests();
});

test('form task tunggal: Simpan nonaktif selama editor sibuk dan aktif lagi setelah selesai', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <HandoverForm
      title="Form task"
      mode="create"
      defaultValues={{ ...toHandoverFormDefaults(undefined, 'loc-a'), note: '- [ ] A' }}
      options={options}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  const save = screen.getByRole('button', { name: 'Simpan' });
  expect(save).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'sibuk handover-note' }));
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'selesai handover-note' }));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
});

test('form batch: Simpan semua nonaktif selama SALAH SATU kartu sibuk; kartu dibuang melepas penahannya', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<HandoverBatchForm options={options} onSubmit={onSubmit} onCancel={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tambah task' }));
  const sibuk = screen.getAllByRole('button', { name: /^sibuk / });
  expect(sibuk).toHaveLength(2);
  const save = screen.getByRole('button', { name: /^Simpan semua/ });
  expect(save).toBeEnabled();
  await userEvent.click(sibuk[1] as HTMLElement);
  expect(save).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(/Menunggu unggahan gambar/);
  // Membuang kartu yang sibuk melepas penahan.
  const second = screen.getAllByRole('group', { name: /^Task \d+$/ })[1] as HTMLElement;
  await userEvent.click(within(second).getByRole('button', { name: 'Hapus' }));
  expect(screen.getByRole('button', { name: /^Simpan semua/ })).toBeEnabled();
});
