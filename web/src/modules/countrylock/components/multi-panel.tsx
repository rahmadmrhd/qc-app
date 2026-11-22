import type { PackageDto } from '@countrylock/bridge-contract';
import { buildBridgePlan, describeBridgePlan } from '@countrylock/multi/bridge-plan';
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
  { filter: 'queued', label: 'Antri', tone: 'border-warning-text/35' },
  { filter: 'injecting', label: 'Inject', tone: 'border-info-text/35' },
  { filter: 'success', label: 'Selesai', tone: 'border-success-text/35' },
  { filter: 'failed', label: 'Gagal', tone: 'border-destructive-text/35' },
];

/**
 * Teks konfirmasi "Siapkan bridge router": dibangun dari rencana yang SAMA dengan perintah yang dijalankan proses utama
 * (`bridge-plan.ts`), jadi host, daftar interface, dan cakupan penghapusan selalu persis seperti kenyataannya.
 */
function bridgeSetupText(pkg: PackageDto): string {
  const { server, brands } = pkg.config;
  return describeBridgePlan(buildBridgePlan(server, brands[MULTI_BRAND]?.multi.interfaceBridge));
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
  const [preparing, setPreparing] = useState(false);

  const devices = snapshot?.devices ?? [];
  const counts = snapshot?.counts;
  const shown = filterDevices(devices, filter);
  const heldReason = running ? (snapshot?.blockedReason ?? null) : injectBlocker;
  // Mengubah bridge port router memutus perangkat yang sedang di-inject (keputusan pemilik 2026-11-19).
  const injectBusy = (counts?.injecting ?? 0) > 0 || (counts?.queued ?? 0) > 0;

  return (
    <>
      <Card className="w-full max-w-5xl">
        <CardHeader>
          <CardTitle>Multi-Device (Ubiquiti)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MultiForm pkg={pkg} catalog={catalog} multi={multi} />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              color="primary"
              disabled={!running}
              onClick={actions.scan}
            >
              <Radar />
              Scan
            </Button>
            <Button
              type="button"
              variant="outline"
              color="primary"
              disabled={injectBusy || preparing}
              title={
                injectBusy ? 'Tidak dapat menyiapkan bridge saat inject sedang berjalan' : undefined
              }
              onClick={() => setConfirmBridge(true)}
            >
              <Network />
              Siapkan bridge router
            </Button>
            {injectBusy ? (
              <p role="status" className="self-center text-xs text-muted-foreground">
                Tidak dapat menyiapkan bridge saat inject sedang berjalan.
              </p>
            ) : null}
            {preparing ? (
              <p role="status" className="self-center text-xs text-muted-foreground">
                Sedang menyiapkan bridge router; inject ditahan sampai selesai.
              </p>
            ) : null}
            <Button type="button" disabled={!running || preparing} onClick={actions.injectAll}>
              Inject All
            </Button>
            <Button
              type="button"
              variant="outline"
              color="primary"
              disabled={!running}
              onClick={actions.stopQueue}
            >
              Stop Antrean
            </Button>
            <Button
              type="button"
              variant="soft"
              color="destructive"
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
            <p role="status" className="text-sm text-warning-text">
              Draft menahan inject: {heldReason}
            </p>
          ) : null}
          {running && snapshot?.queueStopped ? (
            <p role="status" className="text-sm text-warning-text">
              Antrean sedang berhenti: tekan Inject All atau nyalakan Auto Inject untuk melanjutkan.
            </p>
          ) : null}
          {multi.error ? (
            <Alert color="destructive" icon={false}>
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
                variant={active ? 'solid' : 'outline'}
                color="primary"
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
            <AlertDialogAction
              onClick={() => {
                // Inject ditahan selama penyiapan (host dan engine juga menahannya); dilepas setelah selesai.
                setPreparing(true);
                void actions.prepareBridge().finally(() => setPreparing(false));
              }}
            >
              Siapkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
