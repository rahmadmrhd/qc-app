import type { QrPresetDto } from '@shared/contract';
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
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';
import { ClonePresetDialog } from '@/modules/qrcode/components/clone-preset-dialog';
import { LogoLibraryField } from '@/modules/qrcode/components/logo-library-field';
import {
  qrDefaultsQueryOptions,
  useClonePreset,
  useDeleteQrPreset,
  useSaveQrLogoLibrary,
} from '@/modules/qrcode/queries';

export const Route = createFileRoute('/_app/qrcode/default/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'manage'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(qrDefaultsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]),
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
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
  const remove = useDeleteQrPreset();
  const clone = useClonePreset();
  const [deleting, setDeleting] = useState<QrPresetDto | null>(null);
  const [cloning, setCloning] = useState<QrPresetDto | null>(null);
  const buName = (id: string) => businessUnits.find((unit) => unit.id === id)?.name;

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
        Tiap Business Unit punya satu konfigurasi default. Saat membuat QR baru dari item, default
        BU item ditarik otomatis (item lintas BU: user memilih satu); semua isian (kecuali sumber
        link) langsung terisi darinya. Mengubah atau menghapus default tidak mengubah QR yang sudah
        dibuat.
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
                <TableHead>Business Unit</TableHead>
                <TableHead>Nama Manual Book di</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Diperbarui</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {defaults.presets.map((preset) => (
                <TableRow key={preset.id}>
                  <TableCell className="font-medium">{preset.name}</TableCell>
                  <TableCell className="text-sm">
                    {preset.buId === '' ? (
                      <span className="text-muted-foreground">Belum diatur</span>
                    ) : (
                      (buName(preset.buId) ?? '—')
                    )}
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {preset.namePlacement === '' ? '—' : preset.namePlacement}
                  </TableCell>
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
                        variant="outline"
                        aria-label={`Kloning ${preset.name}`}
                        onClick={() => setCloning(preset)}
                      >
                        Kloning ke BU lain
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
      {cloning ? (
        <ClonePresetDialog
          key={cloning.id}
          open
          onOpenChange={(open) => (open ? undefined : setCloning(null))}
          source={cloning}
          businessUnits={businessUnits}
          presets={defaults.presets}
          onClone={async (input) => {
            await clone.mutateAsync(input);
            toast.success('Konfigurasi default dikloning');
          }}
        />
      ) : null}
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
