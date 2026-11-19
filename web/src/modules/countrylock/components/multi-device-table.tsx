import type { MultiDeviceDto } from '@countrylock/bridge-contract';
import type { DeviceStatus } from '@countrylock/multi/types';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { cn } from '@/lib/utils';

/** Lencana ringkasan yang dapat diklik untuk menyaring tabel (istilah aplikasi lama). */
export type DeviceFilter = 'waiting' | 'queued' | 'injecting' | 'success' | 'failed';

/** `waiting` = Waiting + Pinging + FetchingInfo + Ready, sama dengan hitungan engine (`counts.waiting`). */
export const FILTER_STATUSES: Record<DeviceFilter, readonly DeviceStatus[]> = {
  waiting: ['waiting', 'pinging', 'fetching_info', 'ready'],
  queued: ['queued'],
  injecting: ['injecting'],
  success: ['success'],
  failed: ['failed'],
};

export function filterDevices(
  devices: readonly MultiDeviceDto[],
  filter: DeviceFilter | null,
): MultiDeviceDto[] {
  if (filter === null) return [...devices];
  const allowed = FILTER_STATUSES[filter];
  return devices.filter((device) => allowed.includes(device.status));
}

const STATUS_LABEL: Record<DeviceStatus, string> = {
  waiting: 'Menunggu',
  pinging: 'Ping',
  fetching_info: 'Baca info',
  ready: 'Siap',
  queued: 'Antri',
  injecting: 'Inject',
  success: 'Selesai',
  failed: 'Gagal',
  disconnected: 'Terputus',
};

const STATUS_CLASS: Record<DeviceStatus, string> = {
  waiting: 'bg-muted text-muted-foreground',
  pinging: 'bg-muted text-muted-foreground',
  fetching_info: 'bg-muted text-muted-foreground',
  ready: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  queued: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  injecting: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  disconnected: 'bg-muted text-muted-foreground line-through',
};

/**
 * Aksi inject pada satu baris: Inject (siap), Retry (gagal, atau menunggu dengan kredensial habis = coba kredensial dari
 * awal), Cancel (antri/sedang inject). Perangkat selesai tidak punya aksi inject.
 */
export function rowAction(device: MultiDeviceDto): 'inject' | 'retry' | 'cancel' | null {
  switch (device.status) {
    case 'ready':
      return 'inject';
    case 'failed':
      return 'retry';
    case 'waiting':
      return device.credentialsExhausted ? 'retry' : null;
    case 'queued':
    case 'injecting':
      return 'cancel';
    default:
      return null;
  }
}

export interface DeviceActions {
  onInject(mac: string): void;
  onCancel(mac: string): void;
  onOpenWeb(mac: string): void;
}

function StatusPill({ device }: { device: MultiDeviceDto }) {
  return (
    <span
      className={cn(
        'inline-block rounded px-1.5 py-0.5 text-xs font-medium',
        STATUS_CLASS[device.status],
      )}
    >
      {STATUS_LABEL[device.status]}
    </span>
  );
}

function PingDot({ pingable }: { pingable: boolean }) {
  const label = pingable ? 'Merespon ping' : 'Tidak merespon ping';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-block size-2.5 rounded-full',
        pingable ? 'bg-emerald-500' : 'bg-muted-foreground/40',
      )}
    />
  );
}

function DeviceLog({ log }: { log: readonly string[] }) {
  if (log.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Log ({log.length})</summary>
      {/* Teks dari perangkat: hanya dirender sebagai teks, sandi sudah disamarkan di proses utama. */}
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono">
        {log.join('\n')}
      </pre>
    </details>
  );
}

function SessionNote({ device, unrecorded }: { device: MultiDeviceDto; unrecorded: boolean }) {
  return (
    <>
      {unrecorded ? (
        <span className="block text-xs font-medium text-destructive">Belum tercatat di draft</span>
      ) : null}
      {device.injectedThisSession ? (
        <span className="block text-xs text-muted-foreground">Sudah di-inject di sesi ini</span>
      ) : null}
      {device.alreadyRegistered && !device.injectedThisSession ? (
        <span className="block text-xs text-muted-foreground">Serial sudah ada di draft</span>
      ) : null}
    </>
  );
}

function RowButtons({ device, actions }: { device: MultiDeviceDto; actions: DeviceActions }) {
  const action = rowAction(device);
  return (
    <div className="flex flex-wrap gap-1">
      {action === 'inject' || action === 'retry' ? (
        <Button
          type="button"
          size="sm"
          aria-label={`${action === 'retry' ? 'Retry' : 'Inject'} ${device.mac}`}
          onClick={() => actions.onInject(device.mac)}
        >
          {action === 'retry' ? 'Retry' : 'Inject'}
        </Button>
      ) : null}
      {action === 'cancel' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Cancel ${device.mac}`}
          onClick={() => actions.onCancel(device.mac)}
        >
          Cancel
        </Button>
      ) : null}
      {device.status !== 'disconnected' ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Buka web ${device.mac}`}
          onClick={() => actions.onOpenWeb(device.mac)}
        >
          <ExternalLink />
          Buka web
        </Button>
      ) : null}
    </div>
  );
}

function DeviceRow({
  device,
  actions,
  unrecorded,
}: {
  device: MultiDeviceDto;
  actions: DeviceActions;
  unrecorded: boolean;
}) {
  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-2 py-2">
        <PingDot pingable={device.pingable} />
      </td>
      <td className="px-2 py-2 font-mono text-xs">{device.mac}</td>
      <td className="px-2 py-2 font-mono text-xs">{device.ip}</td>
      <td className="px-2 py-2">{device.model === '' ? '-' : device.model}</td>
      <td className="px-2 py-2 font-mono text-xs">
        {device.serial === '' ? '-' : device.serial}
        <SessionNote device={device} unrecorded={unrecorded} />
      </td>
      <td className="px-2 py-2">{device.country === '' ? '-' : device.country}</td>
      <td className="px-2 py-2">{device.credentialSource}</td>
      <td className="space-y-1 px-2 py-2">
        <StatusPill device={device} />
        <span className="block text-xs text-muted-foreground">{device.message}</span>
        <DeviceLog log={device.log} />
      </td>
      <td className="px-2 py-2">
        <RowButtons device={device} actions={actions} />
      </td>
    </tr>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm', mono && 'font-mono')}>{value === '' ? '-' : value}</dd>
    </div>
  );
}

function DeviceCard({
  device,
  actions,
  unrecorded,
}: {
  device: MultiDeviceDto;
  actions: DeviceActions;
  unrecorded: boolean;
}) {
  return (
    <article aria-label={`Perangkat ${device.mac}`} className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-mono text-xs">
          <PingDot pingable={device.pingable} />
          {device.mac}
        </span>
        <StatusPill device={device} />
      </div>
      <p className="text-xs text-muted-foreground">{device.message}</p>
      <dl className="grid grid-cols-2 gap-2">
        <Field label="IP" value={device.ip} mono />
        <Field label="Model" value={device.model} />
        <Field label="Serial" value={device.serial} mono />
        <Field label="Negara" value={device.country} />
        <Field label="Kredensial" value={device.credentialSource} />
      </dl>
      <SessionNote device={device} unrecorded={unrecorded} />
      <DeviceLog log={device.log} />
      <RowButtons device={device} actions={actions} />
    </article>
  );
}

/** Tabel perangkat (layar lebar) atau daftar kartu (di bawah 768 px). */
export function MultiDeviceTable({
  devices,
  actions,
  unrecorded,
}: {
  devices: readonly MultiDeviceDto[];
  actions: DeviceActions;
  /** MAC perangkat selesai yang belum tercatat ke draft. */
  unrecorded: ReadonlySet<string>;
}) {
  const wide = useIsDesktop();
  if (devices.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada perangkat yang terdeteksi.</p>;
  }
  if (!wide) {
    return (
      <div className="space-y-2">
        {devices.map((device) => (
          <DeviceCard
            key={device.mac}
            device={device}
            actions={actions}
            unrecorded={unrecorded.has(device.mac)}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table aria-label="Perangkat Multi" className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-1 font-medium">
              <span className="sr-only">Ping</span>
            </th>
            {['MAC', 'IP', 'Model', 'Serial', 'Negara', 'Kredensial', 'Status', 'Aksi'].map(
              (title) => (
                <th key={title} scope="col" className="px-2 py-1 font-medium">
                  {title}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <DeviceRow
              key={device.mac}
              device={device}
              actions={actions}
              unrecorded={unrecorded.has(device.mac)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
