import type { StickerStockDto } from '@shared/contract';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { type StickerStockPanel, stockAvailability, useStockActions } from './stock-actions';

const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info: toastInfo, success: vi.fn(), error: vi.fn() } }));
// Dialog diganti stub: yang diuji adalah keadaan pengendali (mode, id, baris yang diturunkan), bukan isi dialog.
vi.mock('./stock-entry-dialog', () => ({
  StockEntryDialog: ({
    mode,
    sticker,
  }: {
    mode: string | null;
    sticker: { name: string; total: number } | null;
  }) => (mode ? <p>{`entri ${mode} ${sticker?.name} total ${sticker?.total}`}</p> : null),
}));
vi.mock('./stock-history', () => ({
  StockHistoryDialog: ({ sticker }: { sticker: { name: string } | null }) =>
    sticker ? <p>{`riwayat ${sticker.name}`}</p> : null,
}));

afterEach(() => {
  cleanup();
  toastInfo.mockReset();
});

function stock(overrides: Partial<StickerStockDto> = {}): StickerStockDto {
  return {
    stickerId: 's1',
    name: 'Hijau-B',
    typeName: 'QC Hijau',
    typeStatus: 'active',
    status: 'active',
    minQty: 0,
    low: false,
    total: 10,
    byLocation: [{ locationId: 'l-a', qty: 10 }],
    ...overrides,
  };
}

function panel(overrides: Partial<StickerStockPanel> = {}): StickerStockPanel {
  return {
    rows: [stock()],
    locations: [{ id: 'l-a', code: 'JKT', name: 'Jakarta' }],
    canEdit: true,
    canManage: true,
    onWrite: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

test('stockAvailability: Masuk butuh stiker DAN jenis aktif; Keluar tetap boleh pada nonaktif; Koreksi butuh manage', () => {
  expect(stockAvailability(panel(), stock())).toEqual({
    canIn: true,
    canOut: true,
    canAdjust: true,
  });
  expect(stockAvailability(panel(), stock({ status: 'inactive' }))).toEqual({
    canIn: false,
    canOut: true,
    canAdjust: true,
  });
  expect(stockAvailability(panel(), stock({ typeStatus: 'inactive' })).canIn).toBe(false);
  expect(stockAvailability(panel({ canManage: false }), stock()).canAdjust).toBe(false);
  expect(stockAvailability(panel({ canEdit: false, canManage: false }), stock())).toEqual({
    canIn: false,
    canOut: false,
    canAdjust: false,
  });
});

function Probe({ initial }: { initial: StickerStockPanel | undefined }) {
  const controller = useStockActions(initial);
  (globalThis as { __controller?: typeof controller }).__controller = controller;
  return <>{controller.dialogs}</>;
}

function controller() {
  return (globalThis as unknown as { __controller: ReturnType<typeof useStockActions> })
    .__controller;
}

test('tanpa panel stok: tidak ada dialog', () => {
  render(<Probe initial={undefined} />);
  expect(controller().dialogs).toBeNull();
});

test('openEntry membuka dialog pada mode dan stiker yang dipilih; openHistory membuka riwayat', () => {
  render(<Probe initial={panel()} />);
  act(() => controller().openEntry('out', 's1'));
  expect(screen.getByText('entri out Hijau-B total 10')).toBeInTheDocument();
  act(() => controller().openHistory(stock()));
  expect(screen.getByText('riwayat Hijau-B')).toBeInTheDocument();
});

test('baris diturunkan dari stok terbaru: dialog terbuka ikut menampilkan stok yang dimuat ulang', () => {
  const view = render(<Probe initial={panel()} />);
  act(() => controller().openEntry('in', 's1'));
  expect(screen.getByText('entri in Hijau-B total 10')).toBeInTheDocument();
  view.rerender(<Probe initial={panel({ rows: [stock({ total: 25 })] })} />);
  expect(screen.getByText('entri in Hijau-B total 25')).toBeInTheDocument();
});

test('baris hilang dari stok saat dialog terbuka: dialog ditutup dan pengguna diberi tahu', () => {
  const view = render(<Probe initial={panel()} />);
  act(() => controller().openEntry('in', 's1'));
  view.rerender(<Probe initial={panel({ rows: [] })} />);
  expect(screen.queryByText(/^entri/)).toBeNull();
  expect(toastInfo).toHaveBeenCalledWith('Stok stiker berubah; dialog ditutup');
  // Baris kembali: dialog tidak terbuka sendiri lagi.
  view.rerender(<Probe initial={panel()} />);
  expect(screen.queryByText(/^entri/)).toBeNull();
});
