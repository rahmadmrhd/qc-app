import type { BrandDto, BusinessUnitOptionDto } from '@shared/contract';
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
import { BrandFormDialog, type BrandSaveInput, type BrandSaveResult } from './brand-form-dialog';

export interface BrandsManagerProps {
  brands: readonly BrandDto[];
  businessUnits: readonly BusinessUnitOptionDto[];
  canEdit: boolean;
  canManage: boolean;
  pendingStatusId: string | null;
  /** Mengembalikan galat (tampil di dialog) atau `null` bila berhasil. */
  onSave: (input: BrandSaveInput) => Promise<BrandSaveResult>;
  onToggleStatus: (brand: BrandDto) => void;
}

/** Daftar merk: tambah dan ganti nama (lewat dialog; berlaku ke semua item merk itu), nonaktifkan/aktifkan. */
export function BrandsManager({
  brands,
  businessUnits,
  canEdit,
  canManage,
  pendingStatusId,
  onSave,
  onToggleStatus,
}: BrandsManagerProps) {
  /** `'new'` = dialog tambah; objek = dialog ganti nama merk itu. */
  const [dialog, setDialog] = useState<BrandDto | 'new' | null>(null);
  const buById = new Map(businessUnits.map((bu) => [bu.id, bu]));

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={() => setDialog('new')}>Tambah merk</Button>
        </div>
      ) : null}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Merk</TableHead>
              <TableHead>BU bawaan</TableHead>
              <TableHead className="text-right">Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Belum ada merk.
                </TableCell>
              </TableRow>
            ) : null}
            {brands.map((brand) => (
              <TableRow key={brand.id}>
                <TableCell className="font-medium">{brand.name}</TableCell>
                <TableCell>
                  {(brand.businessUnitIds ?? []).length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(brand.businessUnitIds ?? []).map((buId) => {
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
                <TableCell className="text-right tabular-nums">{brand.itemCount}</TableCell>
                <TableCell>
                  <Badge variant={brand.status === 'active' ? 'default' : 'secondary'}>
                    {brand.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Ubah ${brand.name}`}
                      onClick={() => setDialog(brand)}
                    >
                      Ubah
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${brand.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${brand.name}`}
                      disabled={pendingStatusId === brand.id}
                      onClick={() => onToggleStatus(brand)}
                    >
                      {brand.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <BrandFormDialog
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        brand={dialog === null || dialog === 'new' ? undefined : dialog}
        businessUnits={businessUnits}
        onSave={onSave}
      />
    </div>
  );
}
