import type { BrandDto } from '@shared/contract';
import { ITEM_LIMITS } from '@shared/items';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface BrandFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Merk yang diganti namanya; kosong = merk baru. */
  brand?: Pick<BrandDto, 'id' | 'name'>;
  /** Mengembalikan pesan galat (tampil di bawah isian) atau `null` bila berhasil (dialog menutup sendiri). */
  onSave: (input: { id?: string; name: string }) => Promise<string | null>;
}

interface BrandFormBodyProps {
  brand?: Pick<BrandDto, 'id' | 'name'>;
  onSave: BrandFormDialogProps['onSave'];
  onClose: () => void;
}

/** Terpasang hanya saat dialog terbuka, sehingga isian dan galat selalu mulai bersih. */
function BrandFormBody({ brand, onSave, onClose }: BrandFormBodyProps) {
  const [name, setName] = useState(brand?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || name.trim() === '') return;
    setBusy(true);
    let message: string | null;
    try {
      message = await onSave(brand ? { id: brand.id, name } : { name });
    } catch {
      // Galat tak terduga (mis. jaringan) menjadi pesan, bukan membuat tombol macet.
      message = 'Gagal menyimpan merk';
    }
    setBusy(false);
    setError(message);
    if (message === null) onClose();
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        // Dialog ini bisa dibuka dari dalam form lain (form item): submit tidak boleh menjalar ke sana.
        event.stopPropagation();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="brand-form-name">Nama merk</Label>
        <Input
          id="brand-form-name"
          autoFocus
          maxLength={ITEM_LIMITS.brand}
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'brand-form-error' : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p id="brand-form-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={busy || name.trim() === ''}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Dialog tambah/ganti nama merk; dipakai halaman Merk dan tombol "Tambah" pada field Merk di form item. */
export function BrandFormDialog({ open, onOpenChange, brand, onSave }: BrandFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{brand ? `Ubah merk ${brand.name}` : 'Tambah merk'}</DialogTitle>
          <DialogDescription>
            {brand
              ? 'Mengganti nama berlaku untuk semua item merk ini.'
              : 'Merk baru langsung dapat dipilih.'}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <BrandFormBody
            key={brand?.id ?? 'new'}
            brand={brand}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
