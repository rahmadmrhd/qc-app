import { HANDOVER_LIMITS } from '@shared/handover';
import type { CustomerDto } from '@shared/rpc';
import { useState } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(id: string) {
    setBusy(true);
    let message: string | null;
    try {
      message = await onRename({ id, name });
    } catch {
      message = 'Gagal menyimpan customer';
    }
    setBusy(false);
    setError(message);
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
                  <div className="space-y-1">
                    <Input
                      aria-label={`Nama baru untuk ${customer.name}`}
                      maxLength={HANDOVER_LIMITS.customerName}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    {error ? (
                      <p role="alert" className="text-sm text-destructive">
                        {error}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  customer.name
                )}
              </TableCell>
              <TableCell>
                <Badge variant={customer.status === 'active' ? 'default' : 'secondary'}>
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
