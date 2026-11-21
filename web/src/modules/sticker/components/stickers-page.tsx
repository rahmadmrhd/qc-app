import type {
  BusinessUnitOptionDto,
  StickerDto,
  StickerStockDto,
  StickerTypeDto,
} from '@shared/contract';
import { formatStockQty, type StickerStatus } from '@shared/stickers';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LinkField } from '@/components/link-field';
import { Select } from '@/components/select';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { STICKER_STATUS_LABEL } from '../lib/status';
import {
  StickerFormDialog,
  type StickerFormDialogProps,
  type StickerSaveInput,
  type StickerSaveResult,
} from './sticker-form-dialog';
import {
  StockEntryDialog,
  type StockEntryMode,
  type StockSaveResult,
  type StockWrite,
} from './stock-entry-dialog';

export interface StockPageLocation {
  id: string;
  code: string;
  name: string;
}

/** Bagian stok halaman: hanya ada bila user boleh melihat stok di minimal satu lokasi terpilih. */
export interface StickerStockPanel {
  rows: readonly StickerStockDto[];
  /** Lokasi yang sedang ditampilkan (terpilih dan boleh dilihat user). */
  locations: readonly StockPageLocation[];
  /** Catat masuk/keluar (`stickerstock: edit`). */
  canEdit: boolean;
  /** Koreksi dan stok opname (`stickerstock: manage`). */
  canManage: boolean;
  onWrite: (write: StockWrite) => Promise<StockSaveResult>;
  /** Membuka halaman stok opname. */
  onStartOpname: () => void;
  onShowHistory: (row: StickerStockDto) => void;
}

export interface StickersPageProps {
  /**
   * Katalog (butuh `sticker: view`). Tanpa ini (user hanya berizin stok) halaman dibangun dari baris stok saja:
   * kolom BU/minimum dan aksi katalog tidak tampil.
   */
  stickers?: readonly StickerDto[] | undefined;
  types: readonly StickerTypeDto[];
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Stok per lokasi (butuh `stickerstock: view` di lokasi terpilih); kosong = kolom dan aksi stok tak tampil. */
  stock?: StickerStockPanel | undefined;
  canEdit: boolean;
  canManage: boolean;
  pendingStatusId: string | null;
  /** Mengembalikan galat (tampil di dialog) atau `null` bila berhasil. */
  onSave: (input: StickerSaveInput) => Promise<StickerSaveResult>;
  /** Diteruskan ke form stiker: tambah jenis/BU dan tautan buka BU, hanya bila user berhak (lihat `lib/link-access`). */
  onCreateType?: StickerFormDialogProps['onCreateType'];
  onCreateBusinessUnit?: StickerFormDialogProps['onCreateBusinessUnit'];
  openBusinessUnitHref?: StickerFormDialogProps['openBusinessUnitHref'];
  onToggleStatus: (sticker: StickerDto) => void;
}

type StatusFilter = '' | StickerStatus;

/** Nama yang tampil untuk tim QC: alias bila ada, selain itu nama stiker. */
function displayName(sticker: Pick<StickerDto, 'name' | 'alias'>): string {
  return sticker.alias === '' ? sticker.name : sticker.alias;
}

/** Satu baris tabel: gabungan katalog dan stok stiker yang sama (salah satunya bisa tidak ada). */
interface Row {
  id: string;
  label: string;
  /** Nama asli bila `label` adalah alias. */
  fullName: string | null;
  typeName: string;
  status: StickerStatus;
  low: boolean;
  catalog: StickerDto | undefined;
  stock: StickerStockDto | undefined;
}

function buildRows(
  stickers: readonly StickerDto[] | undefined,
  stock: readonly StickerStockDto[] | undefined,
): Row[] {
  const stockById = new Map((stock ?? []).map((row) => [row.stickerId, row]));
  if (stickers) {
    return stickers.map((sticker) => ({
      id: sticker.id,
      label: displayName(sticker),
      fullName: sticker.alias === '' ? null : sticker.name,
      typeName: sticker.typeName,
      status: sticker.status,
      low: sticker.low,
      catalog: sticker,
      stock: stockById.get(sticker.id),
    }));
  }
  return (stock ?? []).map((row) => ({
    id: row.stickerId,
    label: row.name,
    fullName: null,
    typeName: row.typeName,
    status: row.status,
    low: row.low,
    catalog: undefined,
    stock: row,
  }));
}

/** Katalog dan stok stiker: filter jenis/status, tambah/ubah (dialog), nonaktifkan, catat stok, opname, riwayat. */
export function StickersPage({
  stickers,
  types,
  businessUnits,
  stock,
  canEdit,
  canManage,
  pendingStatusId,
  onSave,
  onCreateType,
  onCreateBusinessUnit,
  openBusinessUnitHref,
  onToggleStatus,
}: StickersPageProps) {
  /** `'new'` = dialog tambah; objek = dialog ubah stiker itu. */
  const [dialog, setDialog] = useState<StickerDto | 'new' | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  // Hanya mode dan id yang disimpan; barisnya diturunkan dari stok terbaru agar "Stok saat ini" di dialog ikut
  // diperbarui bila stok dimuat ulang saat dialog terbuka.
  const [entry, setEntry] = useState<{ mode: StockEntryMode; stickerId: string } | null>(null);
  const entryRow = entry
    ? (stock?.rows.find((row) => row.stickerId === entry.stickerId) ?? null)
    : null;
  // Baris hilang dari stok saat dialog terbuka (mis. stiker nonaktif yang stoknya menjadi 0): tutup dengan bersih
  // dan beri tahu, alih-alih menghilang diam-diam atau terbuka sendiri lagi bila baris kembali.
  useEffect(() => {
    if (entry !== null && entryRow === null) {
      setEntry(null);
      toast.info('Stok stiker berubah; dialog ditutup');
    }
  }, [entry, entryRow]);

  const buById = new Map(businessUnits.map((bu) => [bu.id, bu]));
  const catalogMode = stickers !== undefined;
  const codeById = new Map(
    (stock?.locations ?? []).map((location) => [location.id, location.code]),
  );
  const showBreakdown = (stock?.locations.length ?? 0) > 1;
  // Hanya Manual Book yang punya penjaga "versi terbaru"; stiker Postel bebas diaktifkan kembali selama catatannya masih ada (server menolak bila catatannya sudah dihapus).
  const manualBookTypeIds = new Set(
    types.filter((type) => type.systemKind === 'manual_book').map((t) => t.id),
  );
  const rows = buildRows(stickers, stock?.rows);
  // Jenis difilter menurut nama (unik tanpa membedakan huruf besar/kecil di server): berlaku juga bagi user yang
  // hanya berizin stok dan tak punya daftar jenis.
  const typeNames = catalogMode
    ? types.map((type) => type.name)
    : [...new Set(rows.map((row) => row.typeName))].sort((a, b) => a.localeCompare(b));
  const visible = rows.filter(
    (row) =>
      (typeFilter === '' || row.typeName === typeFilter) &&
      (statusFilter === '' || row.status === statusFilter),
  );
  const columns = 4 + (catalogMode ? 2 : 0) + (stock ? 1 : 0) + (showBreakdown ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Stiker</h1>
        <div className="flex flex-wrap gap-2">
          {stock?.canManage ? (
            <Button variant="outline" onClick={stock.onStartOpname}>
              Stok opname
            </Button>
          ) : null}
          {catalogMode && canEdit ? (
            <Button onClick={() => setDialog('new')}>Tambah stiker</Button>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {catalogMode
          ? 'Katalog stiker beserta stok, BU, dan batas minimum. Stiker tidak dihapus, hanya dinonaktifkan.'
          : 'Stok stiker di lokasi yang dipilih.'}
        {stock ? ' "Menipis" dihitung dari total semua lokasi.' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <LinkField
          id="sticker-filter-type"
          label="Filter jenis"
          hideLabel
          className="w-48"
          placeholder="Semua jenis"
          options={typeNames.map((name) => ({ id: name, label: name }))}
          localFilter
          highlight
          value={typeFilter === '' ? null : typeFilter}
          onChange={(next) => setTypeFilter(next ?? '')}
        />
        <Select
          id="sticker-filter-status"
          label="Filter status"
          hideLabel
          className="w-40"
          options={[
            { value: '', label: 'Semua status' },
            { value: 'active', label: 'Aktif' },
            { value: 'inactive', label: 'Nonaktif' },
            { value: 'deprecated', label: 'Usang' },
          ]}
          value={statusFilter}
          onValueChange={(next) => setStatusFilter(next as StatusFilter)}
        />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stiker</TableHead>
              <TableHead>Jenis</TableHead>
              {catalogMode ? <TableHead>BU</TableHead> : null}
              {stock ? <TableHead className="text-right">Stok</TableHead> : null}
              {showBreakdown ? <TableHead>Per lokasi</TableHead> : null}
              {catalogMode ? <TableHead className="text-right">Batas minimum</TableHead> : null}
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns} className="text-center text-muted-foreground">
                  {rows.length === 0 ? 'Belum ada stiker.' : 'Tidak ada stiker yang cocok.'}
                </TableCell>
              </TableRow>
            ) : null}
            {visible.map((row) => {
              const { catalog, stock: stockRow, label } = row;
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{label}</span>
                      {row.low ? (
                        <Badge color="warning" variant="soft" dot>
                          Menipis
                        </Badge>
                      ) : null}
                      {stockRow?.typeStatus === 'inactive' ? (
                        <Badge color="secondary" variant="soft" dot>
                          Jenis nonaktif
                        </Badge>
                      ) : null}
                    </div>
                    {row.fullName !== null ? (
                      <div className="text-xs text-muted-foreground">{row.fullName}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.typeName}</TableCell>
                  {catalogMode ? (
                    <TableCell>
                      {!catalog || catalog.businessUnitIds.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {catalog.businessUnitIds.map((buId) => {
                            const bu = buById.get(buId);
                            return bu ? (
                              <Badge key={buId} variant="outline" title={bu.name}>
                                {bu.code}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      )}
                    </TableCell>
                  ) : null}
                  {stock ? (
                    <TableCell
                      className={`text-right tabular-nums${stockRow && stockRow.total < 0 ? ' text-destructive-text' : ''}`}
                    >
                      {stockRow ? formatStockQty(stockRow.total) : '0'}
                    </TableCell>
                  ) : null}
                  {showBreakdown ? (
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(stockRow?.byLocation ?? []).map((item) => (
                          <Badge key={item.locationId} variant="outline">
                            {`${codeById.get(item.locationId) ?? item.locationId} ${formatStockQty(item.qty)}`}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  ) : null}
                  {catalogMode ? (
                    <TableCell className="text-right tabular-nums">{catalog?.minQty}</TableCell>
                  ) : null}
                  <TableCell>
                    <ActiveStatusBadge
                      status={row.status}
                      label={STICKER_STATUS_LABEL[row.status]}
                    />
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {catalog && canEdit ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Ubah ${label}`}
                        onClick={() => setDialog(catalog)}
                      >
                        Ubah
                      </Button>
                    ) : null}
                    {/* Usang hanya dapat menjadi nonaktif (server menolak mengaktifkannya); stiker Manual Book yang
                        nonaktif hanya dapat diaktifkan kembali bila versi TERBARU konfigurasinya (spek 4a §3 butir
                        15, keputusan pemilik 2026-11-11); stiker Postel tidak dibatasi (spek 4b §3 butir 5). */}
                    {catalog &&
                    canManage &&
                    (catalog.status !== 'inactive' ||
                      !manualBookTypeIds.has(catalog.typeId) ||
                      catalog.latestManualBookVersion) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`${catalog.status === 'inactive' ? 'Aktifkan' : 'Nonaktifkan'} ${label}`}
                        disabled={pendingStatusId === catalog.id}
                        onClick={() => onToggleStatus(catalog)}
                      >
                        {catalog.status === 'inactive' ? 'Aktifkan' : 'Nonaktifkan'}
                      </Button>
                    ) : null}
                    {stock && stockRow ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`Stok ${label}`}
                          >
                            Stok
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {stock.canEdit &&
                          stockRow.status === 'active' &&
                          stockRow.typeStatus === 'active' ? (
                            <DropdownMenuItem
                              onSelect={() => setEntry({ mode: 'in', stickerId: row.id })}
                            >
                              Catat masuk
                            </DropdownMenuItem>
                          ) : null}
                          {stock.canEdit ? (
                            <DropdownMenuItem
                              onSelect={() => setEntry({ mode: 'out', stickerId: row.id })}
                            >
                              Catat keluar
                            </DropdownMenuItem>
                          ) : null}
                          {stock.canManage ? (
                            <DropdownMenuItem
                              onSelect={() => setEntry({ mode: 'adjust', stickerId: row.id })}
                            >
                              Koreksi
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onSelect={() => stock.onShowHistory(stockRow)}>
                            Riwayat
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <StickerFormDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        sticker={dialog === null || dialog === 'new' ? undefined : dialog}
        types={types}
        businessUnits={businessUnits}
        onSave={onSave}
        onCreateType={onCreateType}
        onCreateBusinessUnit={onCreateBusinessUnit}
        openBusinessUnitHref={openBusinessUnitHref}
      />
      {stock ? (
        <StockEntryDialog
          mode={entry?.mode ?? null}
          sticker={entryRow}
          onOpenChange={(open) => (open ? undefined : setEntry(null))}
          onSave={stock.onWrite}
        />
      ) : null}
    </div>
  );
}
