import type {
  ItemStickerMarkView,
  ItemStickerPhotoDto,
  ResolvedStickerDto,
} from '@shared/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({
    url: `data:image/png;base64,${id}`,
    isLoading: false,
    isError: false,
  }),
}));

import { StickerInstructionsView } from './sticker-instructions-view';

const resolved = (patch: Partial<ResolvedStickerDto> = {}): ResolvedStickerDto => ({
  id: 's1',
  name: 'Stiker Postel',
  alias: '',
  fileId: 'f-s1',
  buCodes: [],
  inactive: false,
  ...patch,
});

const mark = (patch: Partial<ItemStickerMarkView> = {}): ItemStickerMarkView => ({
  x: 100,
  y: 200,
  target: { kind: 'sticker', stickerId: 's1' },
  note: '',
  targetName: 'Stiker Postel',
  resolved: [resolved()],
  unresolved: false,
  ...patch,
});

const photo = (patch: Partial<ItemStickerPhotoDto> = {}): ItemStickerPhotoDto => ({
  guideId: 'g1',
  guideName: 'Belakang',
  width: 800,
  height: 600,
  caption: 'Bagian belakang kardus',
  buId: null,
  marks: [mark()],
  ...patch,
});

function renderView(
  photos: ItemStickerPhotoDto[],
  props: Partial<Parameters<typeof StickerInstructionsView>[0]> = {},
) {
  render(
    <StickerInstructionsView photos={photos} canEdit={false} editHref="/item/i1/edit" {...props} />,
  );
}

const asEl = (node: HTMLElement | undefined) => node as HTMLElement;

test('foto dengan tiga penanda: tiga baris daftar bernomor sama dengan penanda pada foto', () => {
  renderView([
    photo({
      marks: [
        mark({ note: 'Pojok kiri' }),
        mark({
          x: 500,
          y: 500,
          targetName: 'Manual Book',
          resolved: [resolved({ id: 's2', name: 'Manual Book', fileId: null })],
        }),
        mark({ x: 900, y: 900, note: 'Bawah' }),
      ],
    }),
  ]);
  expect(screen.getByText('Bagian belakang kardus')).toBeInTheDocument();
  const group = screen.getByRole('group', { name: 'Foto instruksi 1' });
  expect(group.querySelector('img')?.getAttribute('src')).toBe('/api/v1/files/g1');
  const markers = within(group).getAllByRole('button', { name: /^Penanda \d+$/ });
  expect(markers.map((button) => button.getAttribute('aria-label'))).toEqual([
    'Penanda 1',
    'Penanda 2',
    'Penanda 3',
  ]);
  const rows = within(screen.getByRole('list', { name: 'Penanda foto 1' })).getAllByRole(
    'listitem',
  );
  expect(rows).toHaveLength(3);
  expect(within(asEl(rows[0])).getByText('Stiker Postel')).toBeInTheDocument();
  expect(within(asEl(rows[0])).getByText('Pojok kiri')).toBeInTheDocument();
  expect(within(asEl(rows[0])).getByAltText('Contoh Stiker Postel')).toBeInTheDocument();
  expect(within(asEl(rows[1])).getByText('Manual Book')).toBeInTheDocument();
  expect(within(asEl(rows[1])).queryByRole('img')).not.toBeInTheDocument();
  expect(within(asEl(rows[2])).getByText('Bawah')).toBeInTheDocument();
  expect(rows.map((row) => row.getAttribute('data-mark'))).toEqual(['1', '2', '3']);
});

test('penanda jenis dengan dua hasil menampilkan dua stiker dalam satu baris bernomor', () => {
  renderView([
    photo({
      marks: [
        mark({
          target: { kind: 'type', typeId: 't1' },
          targetName: 'Postel',
          resolved: [
            resolved({ id: 's1', name: 'Postel A' }),
            resolved({ id: 's2', name: 'Postel B', alias: 'Pos B', fileId: 'f-s2' }),
          ],
        }),
      ],
    }),
  ]);
  const rows = within(screen.getByRole('list', { name: 'Penanda foto 1' })).getAllByRole(
    'listitem',
  );
  expect(rows).toHaveLength(1);
  expect(within(asEl(rows[0])).getByText('Postel A')).toBeInTheDocument();
  expect(within(asEl(rows[0])).getByText('Postel B')).toBeInTheDocument();
  expect(within(asEl(rows[0])).getByText('(Pos B)')).toBeInTheDocument();
  expect(within(asEl(rows[0])).getAllByRole('img')).toHaveLength(2);
});

test('belum ada stiker yang cocok menampilkan peringatan; stiker nonaktif diberi tanda', () => {
  renderView([
    photo({
      marks: [
        mark({
          target: { kind: 'type', typeId: 't1' },
          targetName: 'Segel',
          resolved: [],
          unresolved: true,
        }),
        mark({ resolved: [resolved({ name: 'Lama', inactive: true })] }),
      ],
    }),
  ]);
  expect(screen.getByText('Belum ada stiker Segel untuk BU ini')).toBeInTheDocument();
  expect(screen.getByText('nonaktif')).toBeInTheDocument();
});

test('kode BU stiker tampil hanya untuk item beberapa BU', () => {
  const photos = [photo({ marks: [mark({ resolved: [resolved({ buCodes: ['RTL', 'WHL'] })] })] })];
  const { unmount } = render(
    <StickerInstructionsView photos={photos} canEdit={false} editHref="/x" multiBu />,
  );
  expect(screen.getByText('RTL')).toBeInTheDocument();
  expect(screen.getByText('WHL')).toBeInTheDocument();
  unmount();
  renderView(photos);
  expect(screen.queryByText('RTL')).not.toBeInTheDocument();
});

test('lencana BU foto; nama stiker di samping nomor hanya pada layar lebar; daftar selalu tampil', () => {
  renderView([photo({ buId: 'bu-a', marks: [mark()] })], { buLabels: { 'bu-a': 'RTL' } });
  expect(screen.getByText('RTL')).toBeInTheDocument();
  const marker = screen.getByRole('button', { name: 'Penanda 1' });
  const label = marker.parentElement?.querySelector('[data-mark-label]');
  expect(label?.textContent).toBe('Stiker Postel');
  expect(label?.className).toContain('hidden');
  expect(label?.className).toContain('sm:');
  // daftar di bawah foto tidak memakai kelas penyembunyi
  const list = screen.getByRole('list', { name: 'Penanda foto 1' });
  expect(list.className).not.toContain('hidden');
});

test('mengetuk penanda menyorot barisnya di daftar', async () => {
  renderView([photo({ marks: [mark(), mark({ x: 900, y: 900 })] })]);
  await userEvent.click(screen.getByRole('button', { name: 'Penanda 2' }));
  const rows = within(screen.getByRole('list', { name: 'Penanda foto 1' })).getAllByRole(
    'listitem',
  );
  expect(rows[1]).toHaveAttribute('data-selected', 'true');
  expect(rows[0]).not.toHaveAttribute('data-selected');
  expect(screen.getByRole('button', { name: 'Penanda 2' })).toHaveAttribute('aria-pressed', 'true');
});

test('tanpa foto: tanda Belum ada instruksi stiker, tanpa kanvas; tautan ke form hanya bila boleh ubah', () => {
  const { unmount } = render(
    <StickerInstructionsView photos={[]} canEdit={false} editHref="/item/i1/edit" />,
  );
  expect(screen.getByText('Belum ada instruksi stiker')).toBeInTheDocument();
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  unmount();
  render(<StickerInstructionsView photos={[]} canEdit editHref="/item/i1/edit" />);
  expect(screen.getByRole('link', { name: 'Tambahkan instruksi' })).toHaveAttribute(
    'href',
    '/item/i1/edit',
  );
});

test('foto tanpa penanda tetap tampil, tetapi tanda belum ada instruksi muncul', () => {
  renderView([photo({ marks: [] })]);
  expect(screen.getByRole('group', { name: 'Foto instruksi 1' })).toBeInTheDocument();
  expect(screen.getByText('Belum ada instruksi stiker')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Penanda foto 1' })).not.toBeInTheDocument();
});

test('onEdit mencegat klik tautan untuk navigasi SPA', async () => {
  const onEdit = vi.fn();
  render(<StickerInstructionsView photos={[]} canEdit editHref="/item/i1/edit" onEdit={onEdit} />);
  await userEvent.click(screen.getByRole('link', { name: 'Tambahkan instruksi' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
});
