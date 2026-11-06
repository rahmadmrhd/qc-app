import type { QrPresetDto } from '@shared/rpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { describeError } from '@/lib/api/describe-error';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { requirePermission } from '@/modules/auth/permissions';
import { LogoLibraryField } from '@/modules/qrcode/components/logo-library-field';
import {
  qrDefaultsQueryOptions,
  useDeleteQrPreset,
  useSaveQrLogoLibrary,
} from '@/modules/qrcode/queries';

export const Route = createFileRoute('/_app/qrcode/default/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'manage'),
  loader: ({ context }) => context.queryClient.ensureQueryData(qrDefaultsQueryOptions()),
  component: QrPresetsPage,
});

function LogoLibrarySection({ saved, version }: { saved: readonly string[]; version: string }) {
  const [library, setLibrary] = useState<string[]>([...saved]);
  const [busy, setBusy] = useState(false);
  const save = useSaveQrLogoLibrary();
  const changed = library.join(',') !== saved.join(',');
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-semibold">Pustaka logo</h2>
        <p className="text-sm text-muted-foreground">
          Logo yang dapat dipilih user saat membuat QR dan sebagai logo awal tiap konfigurasi
          default. Mengeluarkan logo dari pustaka mengosongkan logo awal default yang memakainya.
        </p>
      </div>
      <LogoLibraryField library={library} onLibraryChange={setLibrary} onBusyChange={setBusy} />
      <Button
        disabled={!changed || busy || save.isPending}
        onClick={() =>
          save.mutate(
            { ...(version ? { expectedUpdatedAt: version } : {}), logoFileIds: library },
            {
              onSuccess: () => toast.success('Pustaka logo disimpan'),
              onError: (error) => toast.error(describeError(error)),
            },
          )
        }
      >
        {save.isPending ? <BusyLabel>Menyimpan pustaka logo…</BusyLabel> : 'Simpan pustaka logo'}
      </Button>
    </section>
  );
}

function QrPresetsPage() {
  const navigate = useNavigate();
  const { data: defaults } = useSuspenseQuery(qrDefaultsQueryOptions());
  const remove = useDeleteQrPreset();
  const [deleting, setDeleting] = useState<QrPresetDto | null>(null);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Konfigurasi default QR</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void navigate({ to: '/qrcode' })}>
            Kembali
          </Button>
          <Button onClick={() => void navigate({ to: '/qrcode/default/new' })}>
            Tambah default
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Saat membuat QR baru, user wajib memilih salah satu konfigurasi default; semua isian
        (kecuali sumber link) langsung terisi darinya. Mengubah atau menghapus default tidak
        mengubah QR yang sudah dibuat.
      </p>
      {defaults.presets.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          Belum ada konfigurasi default. User belum dapat membuat QR baru sebelum ada minimal satu.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Diperbarui</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {defaults.presets.map((preset) => (
                <TableRow key={preset.id}>
                  <TableCell className="font-medium">{preset.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {preset.title || '—'}
                  </TableCell>
                  <TableCell className="text-sm">{formatAuditTime(preset.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Ubah ${preset.name}`}
                        onClick={() =>
                          void navigate({
                            to: '/qrcode/default/$presetId/edit',
                            params: { presetId: preset.id },
                          })
                        }
                      >
                        Ubah
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        aria-label={`Hapus ${preset.name}`}
                        onClick={() => setDeleting(preset)}
                      >
                        Hapus
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <LogoLibrarySection
        key={defaults.logoUpdatedAt}
        saved={defaults.logoFileIds}
        version={defaults.logoUpdatedAt}
      />
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus konfigurasi default?</DialogTitle>
            <DialogDescription>
              "{deleting?.name}" dihapus. QR yang sudah dibuat dari konfigurasi ini tidak berubah.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(
                  { id: deleting.id },
                  {
                    onSuccess: () => toast.success('Konfigurasi default dihapus'),
                    onError: (error) => toast.error(describeError(error)),
                    onSettled: () => setDeleting(null),
                  },
                );
              }}
            >
              {remove.isPending ? <BusyLabel>Menghapus…</BusyLabel> : 'Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
