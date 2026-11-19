import type { PackageDto } from '@countrylock/bridge-contract';
import { bridgeInterfaces } from '@countrylock/config';
import type { DesktopCatalogDto } from '@shared/desktop-catalog';
import { Network, Radar } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { UseMulti } from '../use-multi';
import { MultiCredentialPanel } from './multi-credential-panel';
import { type DeviceFilter, filterDevices, MultiDeviceTable } from './multi-device-table';
import { MULTI_BRAND, MultiForm } from './multi-form';

const BADGES: { filter: DeviceFilter; label: string; tone: string }[] = [
  { filter: 'waiting', label: 'Menunggu', tone: 'border-border' },
  { filter: 'queued', label: 'Antri', tone: 'border-amber-500/60' },
  { filter: 'injecting', label: 'Inject', tone: 'border-blue-500/60' },
  { filter: 'success', label: 'Selesai', tone: 'border-emerald-500/60' },
  { filter: 'failed', label: 'Gagal', tone: 'border-red-500/60' },
];

/** Bagian router yang diubah "Siapkan bridge router", disebut lengkap di dialog konfirmasi. */
function bridgeSetupText(pkg: PackageDto): string {
  const { server, brands } = pkg.config;
  const multi = brands[MULTI_BRAND]?.multi;
  const host = multi?.ipServer || server.ip;
  const bridge = multi?.interfaceBridge || server.interfaceBridge;
  const others = bridgeInterfaces(server);
  return `Ini mengubah konfigurasi router jump (${host}): semua bridge port di bridge ${bridge} selain interface ${server.interfaceComp} dihapus, lalu ${
    others.length > 0 ? others.join(', ') : 'interface lain di daftar'
  } ditambahkan ke bridge itu. Jalankan hanya bila memang perlu.`;
}

/**
 * Panel mode Multi-Device: form batch, tombol aksi massal, kredensial tambahan, lencana ringkasan, dan tabel perangkat.
 * Semua keadaan mesin berasal dari snapshot proses utama (`multi.snapshot`); panel ini hanya menampilkan dan mengirim perintah.
 */
export function MultiPanel({
  pkg,
  catalog,
  multi,
  injectBlocker,
}: {
  pkg: PackageDto;
  catalog: DesktopCatalogDto | null;
  multi: UseMulti;
  /** Alasan draft menahan inject (penuh/rusak), untuk ditampilkan sebelum batch dimulai. */
  injectBlocker: string | null;
}) {
  const { snapshot, actions } = multi;
  const running = snapshot?.running === true;
  const [filter, setFilter] = useState<DeviceFilter | null>(null);
  const [confirmBridge, setConfirmBridge] = useState(false);

  const devices = snapshot?.devices ?? [];
  const counts = snapshot?.counts;
  const shown = filterDevices(devices, filter);
  const heldReason = running ? (snapshot?.blockedReason ?? null) : injectBlocker;

  return (
    <>
      <Card className="w-full max-w-5xl">
        <CardHeader>
          <CardTitle>Multi-Device (Ubiquiti)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MultiForm pkg={pkg} catalog={catalog} multi={multi} />

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!running} onClick={actions.scan}>
              <Radar />
              Scan
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmBridge(true)}>
              <Network />
              Siapkan bridge router
            </Button>
            <Button type="button" disabled={!running} onClick={actions.injectAll}>
              Inject All
            </Button>
            <Button type="button" variant="outline" disabled={!running} onClick={actions.stopQueue}>
              Stop Antrean
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!running}
              onClick={actions.cancelAll}
            >
              Cancel All
            </Button>
          </div>

          {snapshot?.message ? (
            <p role="status" className="text-sm">
              {snapshot.message}
            </p>
          ) : null}
          {heldReason !== null ? (
            <p role="status" className="text-sm text-amber-600 dark:text-amber-400">
              Draft menahan inject: {heldReason}
            </p>
          ) : null}
          {running && snapshot?.queueStopped ? (
            <p role="status" className="text-sm text-amber-600 dark:text-amber-400">
              Antrean sedang berhenti: tekan Inject All atau nyalakan Auto Inject untuk melanjutkan.
            </p>
          ) : null}
          {multi.error ? (
            <Alert variant="destructive">
              <AlertDescription>{multi.error}</AlertDescription>
            </Alert>
          ) : null}

          <MultiCredentialPanel
            count={snapshot?.credentialCount ?? 0}
            onAdd={actions.addCredential}
          />
        </CardContent>
      </Card>

      <section
        aria-label="Daftar perangkat Multi"
        className="space-y-3 rounded-lg border bg-card p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Perangkat Multi</h2>
          <span className="text-sm text-muted-foreground">
            {devices.length} perangkat ({counts?.active ?? 0} aktif)
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {BADGES.map(({ filter: key, label, tone }) => {
            const active = filter === key;
            return (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={active ? 'default' : 'outline'}
                aria-pressed={active}
                className={cn(!active && tone)}
                onClick={() => setFilter(active ? null : key)}
              >
                {label} {counts?.[key] ?? 0}
              </Button>
            );
          })}
        </div>
        <MultiDeviceTable
          devices={shown}
          unrecorded={multi.unrecorded}
          actions={{
            onInject: actions.injectDevice,
            onCancel: actions.cancelDevice,
            onOpenWeb: actions.openWeb,
          }}
        />
      </section>

      <AlertDialog open={confirmBridge} onOpenChange={setConfirmBridge}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Siapkan bridge router?</AlertDialogTitle>
            <AlertDialogDescription>{bridgeSetupText(pkg)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => void actions.prepareBridge()}>
              Siapkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
