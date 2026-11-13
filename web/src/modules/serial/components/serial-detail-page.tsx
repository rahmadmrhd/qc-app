import type { SerialDto, SerialEventDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { buIdsWithLevelOf } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { CUSTODY_LABEL, formatDay, STATUS_LABEL } from '../lib/labels';
import { todayWib } from '../lib/locations';
import { lastShipmentNote } from '../lib/transit';
import { useSerialLocations } from '../lib/use-serial-locations';
import { serialDetailQueryOptions } from '../queries';
import { ActComposer } from './act-composer';
import { CustodyPanel } from './custody-panel';
import { EditSerialDialog } from './edit-serial-dialog';
import { SerialStepper } from './serial-stepper';
import { TimelineTabs } from './timeline-tabs';

export interface SerialDetailPageProps {
  serialId: string;
  onBack: () => void;
}

/** Kejadian yang berarti "lolos": pencatatan awal dan cek ulang yang lolos. */
const PASS_TYPES = new Set(['recorded', 'recheck', 'recheck_pass']);

/** Tanggal kejadian lolos terakhir (`recorded`/`recheck`/`recheck_pass`; cek ulang tidak lolos tidak dihitung). */
export function lastPassDate(events: readonly SerialEventDto[]): string | null {
  const dates = events
    .filter((event) => PASS_TYPES.has(event.type) && event.data.result !== 'fail')
    .map((event) => event.occurredOn)
    .sort();
  return dates.at(-1) ?? null;
}

/**
 * Lokasi awal: nama dari kejadian `recorded` bila ada; bila tidak (linimasa terpotong, kejadian pertama tidak termuat)
 * dicari menurut `serial.recordedLocationId` di daftar lokasi yang dikenal pengguna.
 */
function recordedLocationName(
  events: readonly SerialEventDto[],
  recordedLocationId: string,
  known: readonly { id: string; name: string }[],
): string {
  const recorded = events.find((event) => event.type === 'recorded');
  const name = recorded?.data.locationName;
  if (typeof name === 'string' && name !== '') return name;
  return known.find((location) => location.id === recordedLocationId)?.name ?? '';
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Summary({ serial, events }: { serial: SerialDto; events: readonly SerialEventDto[] }) {
  const lastPass = lastPassDate(events);
  const { locations } = useSerialLocations();
  const firstLocation = recordedLocationName(events, serial.recordedLocationId, locations);
  return (
    <section aria-label="Ringkasan" className="rounded-lg border p-4">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Tanggal uji (pertama)">{formatDay(serial.testDate)}</Fact>
        <Fact label="Terakhir lolos">{lastPass ? formatDay(lastPass) : '—'}</Fact>
        <Fact label="Lokasi awal">{firstLocation || '—'}</Fact>
        <Fact label="Lokasi terakhir">{serial.locationName}</Fact>
        <Fact label="Sample">{serial.sample ? 'Ya' : 'Tidak'}</Fact>
        <Fact label="Dicatat oleh">{serial.createdBy}</Fact>
        <Fact label="Catatan">{serial.note === '' ? '—' : serial.note}</Fact>
        <Fact label="Stiker ditempel">
          {serial.stickers.length === 0
            ? '—'
            : serial.stickers.map((sticker) => `${sticker.name} ×${sticker.qty}`).join(', ')}
        </Fact>
      </dl>
    </section>
  );
}

/** Detail serial bergaya tiket: kepala, ringkasan, linimasa (terbaru di atas), kotak pembaruan baru, dan ubah data. */
export function SerialDetailPage({ serialId, onBack }: SerialDetailPageProps) {
  const me = useMe();
  const detail = useQuery(serialDetailQueryOptions(serialId));
  const [editing, setEditing] = useState(false);

  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">Memuat…</p>;
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {detail.error ? describeError(detail.error) : 'Serial tidak ditemukan.'}
        </p>
        <Button variant="outline" onClick={onBack}>
          Kembali ke daftar
        </Button>
      </div>
    );
  }
  const { serial, events } = detail.data;
  const canWrite = buIdsWithLevelOf(me, 'serial', 'edit').includes(serial.buId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <Button variant="link" className="h-auto p-0 text-xs" onClick={onBack}>
            ← Daftar serial
          </Button>
          <h1 className="font-mono text-2xl font-semibold">{serial.serial}</h1>
          <p className="text-sm text-muted-foreground">{serial.itemLabel}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{serial.buCode}</Badge>
            <Badge variant={serial.status === 'good' ? 'secondary' : 'destructive'}>
              {STATUS_LABEL[serial.status]}
            </Badge>
            <Badge variant="outline">
              {serial.custody === 'transit'
                ? `${CUSTODY_LABEL.transit}${serial.transitToLocationName ? ` · ke ${serial.transitToLocationName}` : ''}`
                : `${CUSTODY_LABEL[serial.custody]} · ${serial.locationName}`}
            </Badge>
            {serial.openCase ? (
              <Badge variant="outline">{`${serial.openCase.number} (terbuka)`}</Badge>
            ) : null}
          </div>
          {serial.openCase?.damage ? (
            <p className="text-sm text-muted-foreground">Kerusakan: {serial.openCase.damage}</p>
          ) : null}
        </div>
        {canWrite ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Ubah data
          </Button>
        ) : null}
      </div>
      <SerialStepper status={serial.status} hasCases={serial.cases.length > 0} />
      <CustodyPanel serial={serial} shipmentNote={lastShipmentNote(events)} today={todayWib()} />
      <Summary serial={serial} events={events} />
      <section aria-label="Riwayat" className="space-y-3">
        <h2 className="text-sm font-semibold">Riwayat</h2>
        <TimelineTabs serial={serial} />
      </section>
      <ActComposer serial={serial} />
      {editing ? <EditSerialDialog serial={serial} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
