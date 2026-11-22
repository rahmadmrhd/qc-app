import type { SerialCaseDto, SerialEventDto } from '@shared/contract';
import type { SerialStatus } from '@shared/serials';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDay, STATUS_LABEL, TEAM_LABEL } from '../lib/labels';

/** Kejadian yang menutup laporan: dinyatakan rusak, atau cek ulang lolos. */
const CLOSING_TYPES = new Set(['declare_broken', 'recheck_pass']);

const OUTCOME_LABEL = { good: 'Lolos', broken: 'Rusak' } as const;

function actorLabel(event: SerialEventDto | undefined): string | null {
  return event ? `${event.actorName} (${TEAM_LABEL[event.actorTeam]})` : null;
}

export interface CaseCardProps {
  caseInfo: SerialCaseDto;
  /** Kejadian laporan ini yang SUDAH termuat (halaman lama bisa belum, jadi pelapor/penutup dapat belum diketahui). */
  events: readonly SerialEventDto[];
  /** Status Serial sekarang; hanya ditampilkan bagi laporan yang masih terbuka. */
  serialStatus: SerialStatus;
  /** Jumlah seluruh kejadian laporan (dari `counts.byCase` server), bila diketahui. */
  eventCount?: number | undefined;
  showLatestBadge?: boolean;
}

/**
 * Satu kartu ringkas untuk SEMUA kejadian satu laporan di tab Semua Riwayat Serial (menggantikan tab per laporan):
 * nomor, pelapor, status (laporan terbuka: status Serial kini; selesai: hasil), kapan dan oleh siapa diselesaikan.
 * Seluruh kartu membuka halaman detail laporan lewat tautan nomornya (tautan memanjang menutupi kartu).
 */
export function CaseCard({
  caseInfo,
  events,
  serialStatus,
  eventCount,
  showLatestBadge = false,
}: CaseCardProps) {
  const reporter = actorLabel(
    events.find((event) => event.type === 'report_failure') ??
      events.find((event) => event.type === 'recorded'),
  );
  const closer = actorLabel(events.find((event) => CLOSING_TYPES.has(event.type)));
  const closed = caseInfo.closedOn !== null;
  return (
    <li
      className="relative rounded-lg border bg-card p-4 hover:bg-accent/40"
      data-case-id={caseInfo.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold">
            <Link
              to="/serial/reports/$caseId"
              params={{ caseId: caseInfo.id }}
              aria-label={`Buka laporan ${caseInfo.number}`}
              className="font-mono text-info-text underline-offset-4 outline-none after:absolute after:inset-0 after:rounded-lg hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {caseInfo.number}
            </Link>
            <span className="font-normal text-muted-foreground"> · laporan rusak</span>
            {showLatestBadge ? (
              <Badge variant="solid" color="primary" className="ml-2 align-middle">
                Terbaru
              </Badge>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {reporter ? `Dilaporkan oleh ${reporter}` : 'Pelapor ada di riwayat yang lebih lama'}
          </p>
        </div>
        <div className="flex items-start gap-1">
          <div className="text-right">
            <p className="text-base font-semibold tabular-nums">{formatDay(caseInfo.openedOn)}</p>
            <p className="text-xs text-muted-foreground">dibuka</p>
          </div>
          <ChevronRight aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
        </div>
      </div>
      <ul aria-label="Ringkasan laporan" className="mt-3 space-y-0.5 text-sm">
        {closed && caseInfo.outcome ? (
          <>
            <li>
              Hasil:{' '}
              <Badge variant="soft" color={caseInfo.outcome === 'good' ? 'success' : 'destructive'}>
                {OUTCOME_LABEL[caseInfo.outcome]}
              </Badge>
            </li>
            <li>
              Selesai {formatDay(caseInfo.closedOn as string)}
              {closer ? ` oleh ${closer}` : ''}
            </li>
          </>
        ) : (
          <li>Masih terbuka · status Serial kini: {STATUS_LABEL[serialStatus]}</li>
        )}
        {eventCount !== undefined ? <li>{eventCount} kejadian</li> : null}
      </ul>
    </li>
  );
}
