import type { CustomerDto } from '@shared/contract';
import { HANDOVER_LIMITS } from '@shared/handover';
import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
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

export interface CustomersManagerProps {
  customers: readonly CustomerDto[];
  canManage: boolean;
  pendingStatusId: string | null;
  /** Mengembalikan pesan galat (tampil di bawah isian) atau `null` bila berhasil. */
  onRename: (input: { id: string; name: string }) => Promise<string | null>;
  onToggleStatus: (customer: CustomerDto) => void;
}

/** Daftar customer: ganti nama dan nonaktifkan/aktifkan. Customer baru dibuat langsung dari form task. */
export function CustomersManager({
  customers,
  canManage,
  pendingStatusId,
  onRename,
  onToggleStatus,
}: CustomersManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  // Galat milik satu baris (id), supaya tidak tampil di baris lain.
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Sedang mengubah nama dan isiannya berbeda dari nama tersimpan.
  useUnsavedChanges(
    editingId !== null &&
      name !== (customers.find((customer) => customer.id === editingId)?.name ?? name),
  );
  const editRef = useRef<HTMLInputElement>(null);
  // Mengubah: fokus langsung ke isian agar pengguna keyboard tidak harus mencarinya.
  useEffect(() => {
    if (editingId !== null) editRef.current?.focus();
  }, [editingId]);

  async function save(id: string) {
    setBusy(true);
    let message: string | null;
    try {
      message = await onRename({ id, name });
    } catch {
      message = 'Gagal menyimpan customer';
    }
    setBusy(false);
    setError(message === null ? null : { id, message });
    if (message === null) setEditingId(null);
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                Belum ada customer. Customer dibuat otomatis saat task serah terima disimpan.
              </TableCell>
            </TableRow>
          ) : null}
          {customers.map((customer) => (
            <TableRow key={customer.id}>
              <TableCell className="font-medium">
                {editingId === customer.id ? (
                  <form
                    noValidate
                    className="space-y-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!busy && name.trim() !== '') void save(customer.id);
                    }}
                  >
                    <Input
                      ref={editRef}
                      aria-label={`Nama baru untuk ${customer.name}`}
                      aria-invalid={error?.id === customer.id ? true : undefined}
                      aria-describedby={
                        error?.id === customer.id ? 'customer-edit-error' : undefined
                      }
                      maxLength={HANDOVER_LIMITS.customerName}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                    />
                    {error?.id === customer.id ? (
                      <p id="customer-edit-error" role="alert" className="text-sm text-destructive">
                        {error.message}
                      </p>
                    ) : null}
                  </form>
                ) : (
                  customer.name
                )}
              </TableCell>
              <TableCell>
                <Badge
                  color={customer.status === 'active' ? 'success' : 'secondary'}
                  variant="soft"
                  dot
                >
                  {customer.status === 'active' ? 'Aktif' : 'Nonaktif'}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2 text-right">
                {editingId === customer.id ? (
                  <>
                    <Button
                      size="sm"
                      aria-label={`Simpan nama ${customer.name}`}
                      disabled={busy || name.trim() === ''}
                      onClick={() => void save(customer.id)}
                    >
                      Simpan
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Batal ubah ${customer.name}`}
                      onClick={() => setEditingId(null)}
                    >
                      Batal
                    </Button>
                  </>
                ) : canManage ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Ubah ${customer.name}`}
                      onClick={() => {
                        setEditingId(customer.id);
                        setName(customer.name);
                        setError(null);
                      }}
                    >
                      Ubah
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${customer.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${customer.name}`}
                      disabled={pendingStatusId === customer.id}
                      onClick={() => onToggleStatus(customer)}
                    >
                      {customer.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  </>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
