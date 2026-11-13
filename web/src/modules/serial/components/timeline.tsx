import type { SerialEventDto } from '@shared/contract';
import { Badge } from '@/components/ui/badge';
import { MarkdownView } from '@/modules/markdown/markdown-view';
import {
  EVENT_LABEL,
  FIELD_LABEL,
  formatDay,
  formatStamp,
  legEventLabel,
  TEAM_LABEL,
} from '../lib/labels';

/** Ringkasan stiker pada kejadian `recorded`: nama dan jumlah dari `data.stickers` (tanpa angka stok). */
function recordedStickers(event: SerialEventDto): string[] {
  if (event.type !== 'recorded') return [];
  const list = event.data.stickers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): string[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { name, qty } = entry as { name?: unknown; qty?: unknown };
    return typeof name === 'string' && typeof qty === 'number' ? [`${name} ×${qty}`] : [];
  });
}

function recordedLocation(event: SerialEventDto): string {
  if (event.type !== 'recorded') return '';
  const name = event.data.locationName;
  return typeof name === 'string' ? name : '';
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Tahap diagnosis (`data.stage`); kejadian lama tanpa `stage` tidak menampilkan baris tahap. */
const DIAGNOSIS_STAGE_LABEL: Record<string, string> = {
  diagnosis: 'Diagnosis',
  repairing: 'Sedang diperbaiki',
  done: 'Selesai, kembali ke QC untuk cek ulang',
};

/** Judul kartu: kirim/terima menurut leg, selain itu label jenis riwayat. */
function eventTitle(event: SerialEventDto): string {
  if (event.type === 'send' || event.type === 'receive') {
    return legEventLabel(event.type, event.data.leg);
  }
  return EVENT_LABEL[event.type];
}

/**
 * Rincian per jenis riwayat dari `data` (laporan, kirim/terima, hasil cek ulang). Bagian `damage`, `shipmentNote`, dan
 * status Tidak lolos hanya ada pada kejadian lama (sebelum alur laporan rusak dipangkas) dan tetap dirender apa adanya.
 */
function eventDetails(event: SerialEventDto): string[] {
  const { data } = event;
  const caseNumber = text(data.caseNumber);
  const damage = text(data.damage);
  const details: string[] = [];
  switch (event.type) {
    case 'recorded':
      if (data.status === 'failed') {
        details.push(`Dicatat langsung sebagai Tidak lolos${damage ? `: ${damage}` : ''}`);
      }
      break;
    case 'report_failure':
      details.push(`Laporan ${caseNumber || '—'} dibuka${damage ? `: ${damage}` : ''}`);
      break;
    case 'identify_damage':
    case 'service_diagnosis': {
      const stage = DIAGNOSIS_STAGE_LABEL[text(data.stage)];
      if (stage) details.push(`Tahap: ${stage}`);
      if (damage) details.push(`Kerusakan: ${damage}`);
      if (caseNumber) details.push(`Laporan ${caseNumber}`);
      break;
    }
    case 'declare_broken':
      details.push(`Laporan ${caseNumber || '—'} ditutup: rusak`);
      break;
    case 'recheck_pass':
      if (caseNumber) details.push(`Laporan ${caseNumber} ditutup: lolos`);
      break;
    case 'recheck_fail':
      if (caseNumber) details.push(`Laporan ${caseNumber} masih terbuka`);
      if (damage) details.push(`Kerusakan: ${damage}`);
      break;
    case 'recheck':
      if (data.result === 'pass' || data.result === 'fail') {
        details.push(`Hasil: ${data.result === 'pass' ? 'Lolos' : 'Tidak lolos'}`);
      }
      break;
    case 'send':
    case 'receive': {
      const from = text(data.fromLocationName);
      const to = text(data.toLocationName);
      if (from || to) details.push(`${from || '—'} → ${to || '—'}`);
      const note = text(data.shipmentNote);
      if (note) details.push(`Catatan pengiriman: ${note}`);
      if (event.type === 'receive' && typeof data.daysInTransit === 'number') {
        details.push(
          data.daysInTransit === 0
            ? 'Diterima di hari yang sama'
            : `Lama di perjalanan: ${data.daysInTransit} hari`,
        );
      }
      break;
    }
    default:
      break;
  }
  return details;
}

const show = (value: string | null) => (value === null || value === '' ? '—' : value);

function EventCard({ event, latest }: { event: SerialEventDto; latest: boolean }) {
  const stickers = recordedStickers(event);
  const location = recordedLocation(event);
  const details = eventDetails(event);
  return (
    <li className="relative rounded-lg border bg-card p-4" data-seq={event.seq}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">
            {eventTitle(event)}
            {location ? (
              <span className="font-normal text-muted-foreground"> di {location}</span>
            ) : null}
            {latest ? (
              <Badge variant="secondary" className="ml-2 align-middle">
                Terbaru
              </Badge>
            ) : null}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{event.actorName}</span>
            <Badge variant="outline">{TEAM_LABEL[event.actorTeam]}</Badge>
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold tabular-nums">{formatDay(event.occurredOn)}</p>
          <p className="text-xs text-muted-foreground">dicatat {formatStamp(event.createdAt)}</p>
        </div>
      </div>
      {details.length > 0 ? (
        <ul aria-label="Rincian" className="mt-3 space-y-0.5 text-sm">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {event.message.trim() !== '' ? (
        <MarkdownView source={event.message} className="mt-3 text-sm" />
      ) : null}
      {event.changes.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Perubahan">
          {event.changes.map((change) => (
            <li key={`${change.field}|${change.from}|${change.to}`}>
              <Badge variant="secondary" className="h-auto whitespace-normal py-0.5">
                {`${FIELD_LABEL[change.field] ?? change.field}: ${show(change.from)} → ${show(change.to)}`}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {stickers.length > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Stiker ditempel dan stok dipotong: {stickers.join(', ')}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Daftar kartu riwayat serial: urutan dari server (TERBARU DI ATAS, seq menurun) dipakai apa adanya. `markLatest`
 * memberi badge "Terbaru" pada entri paling atas (seq tertinggi); dipakai tab Semua.
 */
export function Timeline({
  events,
  markLatest = false,
}: {
  events: readonly SerialEventDto[];
  markLatest?: boolean;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>;
  }
  return (
    <ol aria-label="Linimasa" className="space-y-3">
      {events.map((event, index) => (
        <EventCard key={event.id} event={event} latest={markLatest && index === 0} />
      ))}
    </ol>
  );
}
