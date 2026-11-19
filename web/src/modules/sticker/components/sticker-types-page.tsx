import type { StickerTypeDto } from '@shared/contract';
import { useState } from 'react';
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
import { STICKER_RULE_LABEL } from '../schemas';
import {
  StickerTypeFormDialog,
  type StickerTypeSaveInput,
  type StickerTypeSaveResult,
} from './sticker-type-form-dialog';

export interface StickerTypesPageProps {
  types: readonly StickerTypeDto[];
  canEdit: boolean;
  canManage: boolean;
  pendingStatusId: string | null;
  /** Mengembalikan galat (tampil di dialog) atau `null` bila berhasil. */
  onSave: (input: StickerTypeSaveInput) => Promise<StickerTypeSaveResult>;
  onToggleStatus: (type: StickerTypeDto) => void;
}

/** Daftar jenis stiker: tambah dan ubah (lewat dialog), nonaktifkan/aktifkan. Jenis tidak dihapus. */
export function StickerTypesPage({
  types,
  canEdit,
  canManage,
  pendingStatusId,
  onSave,
  onToggleStatus,
}: StickerTypesPageProps) {
  /** `'new'` = dialog tambah; objek = dialog ubah jenis itu. */
  const [dialog, setDialog] = useState<StickerTypeDto | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Jenis Stiker</h1>
        {canEdit ? <Button onClick={() => setDialog('new')}>Tambah jenis</Button> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Jenis mengelompokkan stiker dan menentukan aturannya. Jenis tidak dihapus, hanya
        dinonaktifkan.
      </p>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jenis</TableHead>
              <TableHead>Aturan</TableHead>
              <TableHead className="text-right">Stiker</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Belum ada jenis stiker.
                </TableCell>
              </TableRow>
            ) : null}
            {types.map((type) => (
              <TableRow key={type.id}>
                <TableCell className="font-medium">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{type.name}</span>
                    {type.systemKind !== '' ? <Badge variant="outline">Sistem</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{STICKER_RULE_LABEL[type.rule]}</TableCell>
                <TableCell className="text-right tabular-nums">{type.stickerCount}</TableCell>
                <TableCell>
                  <Badge
                    color={type.status === 'active' ? 'success' : 'secondary'}
                    variant="soft"
                    dot
                  >
                    {type.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  {/* Jenis sistem dikelola aplikasi: nama dan aturannya tak dapat diubah lewat form. */}
                  {canEdit && type.systemKind === '' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Ubah ${type.name}`}
                      onClick={() => setDialog(type)}
                    >
                      Ubah
                    </Button>
                  ) : null}
                  {/* Jenis sistem selalu aktif (keputusan pemilik 2026-11-11): tanpa tombol status. */}
                  {canManage && type.systemKind === '' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${type.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${type.name}`}
                      disabled={pendingStatusId === type.id}
                      onClick={() => onToggleStatus(type)}
                    >
                      {type.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <StickerTypeFormDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        type={dialog === null || dialog === 'new' ? undefined : dialog}
        onSave={onSave}
      />
    </div>
  );
}
