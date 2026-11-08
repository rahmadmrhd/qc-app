import type { BrandDto } from '@shared/contract';
import { ITEM_LIMITS } from '@shared/items';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface BrandsManagerProps {
  brands: readonly BrandDto[];
  canEdit: boolean;
  canManage: boolean;
  pendingStatusId: string | null;
  /** Mengembalikan pesan galat (tampil di bawah isian) atau `null` bila berhasil. */
  onSave: (input: { id?: string; name: string }) => Promise<string | null>;
  onToggleStatus: (brand: BrandDto) => void;
}

/** Daftar merk: tambah, ganti nama (berlaku ke semua item merk itu), nonaktifkan/aktifkan. */
export function BrandsManager({
  brands,
  canEdit,
  canManage,
  pendingStatusId,
  onSave,
  onToggleStatus,
}: BrandsManagerProps) {
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  // Mengubah: fokus langsung ke isian agar pengguna keyboard tidak harus mencarinya.
  useEffect(() => {
    if (editingId !== null) editRef.current?.focus();
  }, [editingId]);

  /** Galat tak terduga (mis. jaringan) menjadi pesan, bukan membuat `busy` macet. */
  async function saveSafely(input: { id?: string; name: string }): Promise<string | null> {
    try {
      return await onSave(input);
    } catch {
      return 'Gagal menyimpan merk';
    }
  }

  async function create() {
    setBusy(true);
    const error = await saveSafely({ name: newName });
    setBusy(false);
    setNewError(error);
    if (error === null) setNewName('');
  }

  async function rename(id: string) {
    setBusy(true);
    const error = await saveSafely({ id, name: editName });
    setBusy(false);
    setEditError(error);
    if (error === null) setEditingId(null);
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <form
          noValidate
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="flex gap-2">
            <Input
              aria-label="Nama merk baru"
              placeholder="Nama merk baru"
              maxLength={ITEM_LIMITS.brand}
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                setNewError(null);
              }}
            />
            <Button type="submit" disabled={busy || newName.trim() === ''}>
              Tambah merk
            </Button>
          </div>
          {newError ? (
            <p role="alert" className="text-sm text-destructive">
              {newError}
            </p>
          ) : null}
        </form>
      ) : null}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Merk</TableHead>
              <TableHead className="text-right">Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Belum ada merk. Merk juga dibuat otomatis saat item disimpan.
                </TableCell>
              </TableRow>
            ) : null}
            {brands.map((brand) => (
              <TableRow key={brand.id}>
                <TableCell className="font-medium">
                  {editingId === brand.id ? (
                    <form
                      noValidate
                      className="space-y-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!busy && editName.trim() !== '') void rename(brand.id);
                      }}
                    >
                      <Input
                        ref={editRef}
                        aria-label={`Nama baru untuk ${brand.name}`}
                        aria-invalid={editError ? true : undefined}
                        aria-describedby={editError ? 'brand-edit-error' : undefined}
                        maxLength={ITEM_LIMITS.brand}
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setEditingId(null);
                        }}
                      />
                      {editError ? (
                        <p id="brand-edit-error" role="alert" className="text-sm text-destructive">
                          {editError}
                        </p>
                      ) : null}
                    </form>
                  ) : (
                    brand.name
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{brand.itemCount}</TableCell>
                <TableCell>
                  <Badge variant={brand.status === 'active' ? 'default' : 'secondary'}>
                    {brand.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  {editingId === brand.id ? (
                    <>
                      <Button
                        size="sm"
                        aria-label={`Simpan nama ${brand.name}`}
                        disabled={busy || editName.trim() === ''}
                        onClick={() => void rename(brand.id)}
                      >
                        Simpan
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Batal ubah ${brand.name}`}
                        onClick={() => setEditingId(null)}
                      >
                        Batal
                      </Button>
                    </>
                  ) : (
                    <>
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Ubah ${brand.name}`}
                          onClick={() => {
                            setEditingId(brand.id);
                            setEditName(brand.name);
                            setEditError(null);
                          }}
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
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
