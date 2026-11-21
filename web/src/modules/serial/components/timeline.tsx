import type { SerialEventDto } from '@shared/contract';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Components } from 'react-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/modules/markdown/markdown-view';
import {
  EVENT_LABEL,
  FIELD_LABEL,
  formatDay,
  formatStamp,
  legEventLabel,
  TEAM_LABEL,
} from '../lib/labels';
import { noteSummary } from '../lib/note-summary';
import { ProofBadge, ProofProblemBadge } from './proof-badge';
import { ProofGallery } from './proof-gallery';

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

/** Perpindahan BU pada cek ulang lolos (`data.bu = { fromCode, toCode }`, hanya bila BU berubah); selain itu `null`. */
function buMove(data: SerialEventDto['data']): string | null {
  const bu = data.bu;
  if (typeof bu !== 'object' || bu === null) return null;
  const { fromCode, toCode } = bu as { fromCode?: unknown; toCode?: unknown };
  if (typeof fromCode !== 'string' || typeof toCode !== 'string') return null;
  return `Pindah BU: ${fromCode || '—'} → ${toCode || '—'}`;
}

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
 * Rincian per jenis riwayat dari `data` (laporan, kirim/terima, hasil cek ulang). Bagian `damage` dan status Tidak lolos
 * hanya ada pada kejadian lama (sebelum alur laporan rusak dipangkas) dan tetap dirender apa adanya; `shipmentNote`
 * (catatan pengiriman) diisi pada kejadian kirim.
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
  if (event.type === 'recheck' || event.type === 'recheck_pass') {
    const move = buMove(data);
    if (move !== null) details.push(move);
  }
  return details;
}

const show = (value: string | null) => (value === null || value === '' ? '—' : value);

/** Catatan serial berbentuk Markdown: chip perubahan menampilkan ringkasan teks polosnya. */
const shownChange = (field: string, value: string | null) =>
  field === 'note' && value !== null ? noteSummary(value) : value;

function EventCard({
  event,
  showLatestBadge,
  markdownComponents,
}: {
  event: SerialEventDto;
  showLatestBadge: boolean;
  markdownComponents: Components | undefined;
}) {
  const hasProof = event.proofPhotos.length > 0;
  const proofProblems = event.proofPhotos.filter((photo) => photo.state === 'failed').length;
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
            {showLatestBadge ? (
              <Badge variant="soft" color="secondary" className="ml-2 align-middle">
                Terbaru
              </Badge>
            ) : null}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{event.actorName}</span>
            <Badge variant="outline" color="primary">
              {TEAM_LABEL[event.actorTeam]}
            </Badge>
            {hasProof ? <ProofBadge /> : null}
            <ProofProblemBadge count={proofProblems} />
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <p className="text-base font-semibold tabular-nums">{formatDay(event.occurredOn)}</p>
            {event.createdAt !== '' ? (
              <p className="text-xs text-muted-foreground">
                dicatat {formatStamp(event.createdAt)}
              </p>
            ) : null}
          </div>
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
        <MarkdownView
          source={event.message}
          className="mt-3 text-sm"
          {...(markdownComponents ? { components: markdownComponents } : {})}
        />
      ) : null}
      {event.changes.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Perubahan">
          {event.changes.map((change) => (
            <li key={`${change.field}|${change.from}|${change.to}`}>
              <Badge variant="soft" color="secondary" className="h-auto whitespace-normal py-0.5">
                {`${FIELD_LABEL[change.field] ?? change.field}: ${show(shownChange(change.field, change.from))} → ${show(shownChange(change.field, change.to))}`}
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
      {hasProof ? <ProofGallery photos={event.proofPhotos} /> : null}
    </li>
  );
}

/** Baris pelipat satu kelompok riwayat: panah + label, `aria-expanded` mengikuti keadaan. */
function GroupToggle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="list-none">
      <Button
        type="button"
        variant="ghost"
        color="primary"
        size="sm"
        className="w-full justify-start gap-1.5 text-muted-foreground"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        {label}
      </Button>
    </li>
  );
}

/**
 * Daftar kartu riwayat serial, URUT LAMA DI ATAS (seq naik), urutan yang sama di aplikasi dan halaman publik. Riwayat
 * lama dilipat bersama (keputusan pemilik 2026-11-15, menggantikan lipatan per kartu): "Tampilkan riwayat sebelumnya"
 * (semua riwayat lama, tertutup sejak awal) lalu judul "Riwayat saat ini" (riwayat terbaru, selalu tampil dan tidak
 * dapat dilipat). Kartu selalu tampil lengkap. `markLatest` memberi badge "Terbaru" pada entri terbaru (tab Semua). `loadOlder`
 * (mis. tombol "Muat yang lebih lama") tampil di dalam kelompok riwayat sebelumnya, di atas kartu tertua.
 */
export function Timeline({
  events,
  markLatest = false,
  markdownComponents,
  loadOlder,
}: {
  events: readonly SerialEventDto[];
  markLatest?: boolean;
  /** Penimpa render Markdown (halaman publik: gambar lewat rute berkas bertoken). */
  markdownComponents?: Components;
  loadOlder?: ReactNode;
}) {
  const [previousOpen, setPreviousOpen] = useState(false);
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>;
  }
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const current = ordered[ordered.length - 1] as SerialEventDto;
  const previous = ordered.slice(0, -1);
  const card = (event: SerialEventDto, badge: boolean) => (
    <EventCard
      key={event.id}
      event={event}
      showLatestBadge={badge}
      markdownComponents={markdownComponents}
    />
  );
  return (
    <ol aria-label="Linimasa" className="space-y-3">
      {previous.length > 0 || loadOlder ? (
        <>
          <GroupToggle
            label={previousOpen ? 'Sembunyikan riwayat sebelumnya' : 'Tampilkan riwayat sebelumnya'}
            open={previousOpen}
            onToggle={() => setPreviousOpen((value) => !value)}
          />
          {previousOpen ? (
            <>
              {loadOlder ? <li className="list-none">{loadOlder}</li> : null}
              {previous.map((event) => card(event, false))}
            </>
          ) : null}
        </>
      ) : null}
      <li className="list-none">
        <h3 className="px-2 py-1.5 text-sm font-medium text-muted-foreground">Riwayat saat ini</h3>
      </li>
      {card(current, markLatest)}
    </ol>
  );
}
