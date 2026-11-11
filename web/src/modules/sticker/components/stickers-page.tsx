import type { BusinessUnitOptionDto, StickerDto, StickerTypeDto } from '@shared/contract';
import type { StickerStatus } from '@shared/stickers';
import { useState } from 'react';
import { LinkField } from '@/components/link-field';
import { Select } from '@/components/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

export interface StickersPageProps {
  stickers: readonly StickerDto[];
  types: readonly StickerTypeDto[];
  businessUnits: readonly BusinessUnitOptionDto[];
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

/** Katalog stiker: filter jenis/status, tambah dan ubah (lewat dialog), nonaktifkan/aktifkan. */
export function StickersPage({
  stickers,
  types,
  businessUnits,
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
  const buById = new Map(businessUnits.map((bu) => [bu.id, bu]));
  // Hanya Manual Book yang punya penjaga "versi terbaru"; stiker jenis sistem lain (Postel) bebas diaktifkan kembali.
  const manualBookTypeIds = new Set(
    types.filter((type) => type.systemKind === 'manual_book').map((t) => t.id),
  );
  const visible = stickers.filter(
    (sticker) =>
      (typeFilter === '' || sticker.typeId === typeFilter) &&
      (statusFilter === '' || sticker.status === statusFilter),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Stiker</h1>
        {canEdit ? <Button onClick={() => setDialog('new')}>Tambah stiker</Button> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Katalog stiker beserta BU dan batas minimum stok. Stiker tidak dihapus, hanya dinonaktifkan.
      </p>
      <div className="flex flex-wrap gap-2">
        <LinkField
          id="sticker-filter-type"
          label="Filter jenis"
          hideLabel
          className="w-48"
          placeholder="Semua jenis"
          options={types.map((type) => ({ id: type.id, label: type.name }))}
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
              <TableHead>BU</TableHead>
              <TableHead className="text-right">Batas minimum</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {stickers.length === 0 ? 'Belum ada stiker.' : 'Tidak ada stiker yang cocok.'}
                </TableCell>
              </TableRow>
            ) : null}
            {visible.map((sticker) => {
              const label = displayName(sticker);
              return (
                <TableRow key={sticker.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{label}</span>
                      {sticker.low ? <Badge variant="destructive">Menipis</Badge> : null}
                    </div>
                    {sticker.alias !== '' ? (
                      <div className="text-xs text-muted-foreground">{sticker.name}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{sticker.typeName}</TableCell>
                  <TableCell>
                    {sticker.businessUnitIds.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {sticker.businessUnitIds.map((buId) => {
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
                  <TableCell className="text-right tabular-nums">{sticker.minQty}</TableCell>
                  <TableCell>
                    <Badge variant={sticker.status === 'active' ? 'default' : 'secondary'}>
                      {STICKER_STATUS_LABEL[sticker.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Ubah ${label}`}
                        onClick={() => setDialog(sticker)}
                      >
                        Ubah
                      </Button>
                    ) : null}
                    {/* Usang hanya dapat menjadi nonaktif (server menolak mengaktifkannya); stiker Manual Book yang
                        nonaktif hanya dapat diaktifkan kembali bila versi TERBARU konfigurasinya (spek 4a §3 butir
                        15, keputusan pemilik 2026-11-11); stiker Postel tidak dibatasi (spek 4b §3 butir 5). */}
                    {canManage &&
                    (sticker.status !== 'inactive' ||
                      !manualBookTypeIds.has(sticker.typeId) ||
                      sticker.latestManualBookVersion) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`${sticker.status === 'inactive' ? 'Aktifkan' : 'Nonaktifkan'} ${label}`}
                        disabled={pendingStatusId === sticker.id}
                        onClick={() => onToggleStatus(sticker)}
                      >
                        {sticker.status === 'inactive' ? 'Aktifkan' : 'Nonaktifkan'}
                      </Button>
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
    </div>
  );
}
