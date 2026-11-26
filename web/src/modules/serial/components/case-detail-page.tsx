import { formatBuLabel } from '@shared/business-units';
import type { SerialCaseDetailDto } from '@shared/contract';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { BusyLabel } from '@/components/spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { serialActorModules } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { CUSTODY_LABEL, daysSpan, formatDay, TEAM_LABEL } from '../lib/labels';
import { PROOF_POLL_MS, pagesHavePendingProof } from '../lib/proof-state';
import { useSerialActions } from '../lib/use-serial-actions';
import {
  serialCaseDetailQueryOptions,
  serialDetailQueryOptions,
  serialHistoryInfiniteQueryOptions,
} from '../queries';
import { actButtonSpecs } from './act-buttons';
import { SerialStatusBadge } from './serial-status-badge';
import { caseStepperState, SerialStepper } from './serial-stepper';
import { Timeline } from './timeline';

const OUTCOME_LABEL = { good: 'Lolos', broken: 'Rusak' } as const;

/** Laporan tak ada, terhapus, atau di luar hak baca: server menjawab `NOT_FOUND` seragam (`FORBIDDEN` bagi tanpa modul). */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

/** "Nama (Tim)" untuk penutup laporan; tim yang tak dikenal tidak ditampilkan. */
function closerLabel(report: SerialCaseDetailDto): string | null {
  if (!report.closedBy) return null;
  const team = report.closedByTeam;
  return team && team in TEAM_LABEL
    ? `${report.closedBy} (${TEAM_LABEL[team as keyof typeof TEAM_LABEL]})`
    : report.closedBy;
}

export interface CaseDetailPageProps {
  caseId: string;
  /** Kembali ke daftar Laporan (tombol pada keadaan tidak ditemukan/galat). */
  onBack: () => void;
}

function Summary({ report }: { report: SerialCaseDetailDto }) {
  const closed = report.closedOn !== null;
  const closer = closerLabel(report);
  return (
    <section aria-label="Ringkasan laporan">
      <DetailList
        items={[
          { label: 'Nomor laporan', value: <span className="font-mono">{report.number}</span> },
          {
            label: 'Serial Number',
            value: (
              <Link
                to="/serial/$serialId"
                params={{ serialId: report.serialId }}
                className="font-mono font-medium text-info-text underline-offset-4 hover:underline"
              >
                {report.serial}
              </Link>
            ),
          },
          { label: 'Item', value: report.itemLabel },
          {
            label: 'Business Unit',
            value: (
              <Badge variant="outline" color="primary">
                {formatBuLabel({ code: report.buCode, name: report.buName })}
              </Badge>
            ),
          },
          { label: 'Pelapor', value: report.reporter },
          { label: 'Dibuka', value: formatDay(report.openedOn) },
          {
            label: 'Ditutup',
            value: closed
              ? `${formatDay(report.closedOn as string)}${closer ? ` oleh ${closer}` : ''}`
              : 'Belum ditutup',
          },
          {
            label: 'Hasil',
            value: report.outcome ? (
              <Badge variant="soft" color={report.outcome === 'good' ? 'success' : 'destructive'}>
                {OUTCOME_LABEL[report.outcome]}
              </Badge>
            ) : (
              'Belum ada (laporan masih terbuka)'
            ),
          },
          {
            label: 'Status Serial kini',
            value: <SerialStatusBadge status={report.serialStatus} />,
          },
          {
            label: 'Posisi sekarang',
            value: report.locationName
              ? `${report.locationName} · ${CUSTODY_LABEL[report.custody]}`
              : CUSTODY_LABEL[report.custody],
          },
          {
            label: 'Durasi penanganan',
            value: closed
              ? `Selesai dalam ${daysSpan(report.durationDays)}`
              : `Berjalan ${daysSpan(report.durationDays)} · di status ini ${daysSpan(report.daysInStatus)}`,
          },
        ]}
      />
    </section>
  );
}

/** Linimasa kejadian laporan ini saja (`serials.history` ber-`caseId`): urut lama di atas, kartu dilipat kecuali terbaru. */
function CaseTimeline({ report }: { report: SerialCaseDetailDto }) {
  const history = useInfiniteQuery({
    ...serialHistoryInfiniteQueryOptions({ id: report.serialId, group: 'all', caseId: report.id }),
    // Selama ada foto bukti yang menunggu cap, linimasa disegarkan berkala agar statusnya terlihat.
    refetchInterval: (query) =>
      pagesHavePendingProof(query.state.data?.pages ?? []) ? PROOF_POLL_MS : false,
  });
  const events = history.data?.pages.flatMap((page) => page.events) ?? [];
  if (history.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;
  if (history.isError) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        {describeError(history.error)}
      </p>
    );
  }
  return (
    <Timeline
      events={events}
      markLatest
      loadOlder={
        history.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            color="primary"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {history.isFetchingNextPage ? <BusyLabel>Memuat…</BusyLabel> : 'Muat yang lebih lama'}
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * View laporan rusak (kit CRUD, `ViewPage` tanpa tab): ringkasan (nomor, Serial Number bertautan, item, BU, pelapor,
 * dibuka, ditutup beserta penutup, hasil, status Serial kini, posisi, durasi penanganan) dan linimasa kejadian laporan
 * itu. Laporan TERBUKA punya aksi di header (`useSerialActions`: aksi utama menurut status, mis. Cek ulang dan Kirim ke
 * servis, sisanya di menu "Aksi lainnya"; tanpa Lapor rusak dan Ubah data, yang tetap di detail Serial); laporan selesai tanpa aksi. `SerialDto` induk dimuat hanya bila ada aksi yang
 * boleh dikerjakan pengguna. Laporan tak terbaca/terhapus = "tidak ditemukan".
 */
export function CaseDetailPage({ caseId, onBack }: CaseDetailPageProps) {
  const me = useMe();
  const detail = useQuery(serialCaseDetailQueryOptions(caseId));
  const report = detail.data;
  const open = report !== undefined && report.closedOn === null;
  const subject = open
    ? { status: report.status, custody: report.custody, buId: report.buId }
    : undefined;
  // Aksi hanya bagi laporan terbuka dan bila pengguna punya aksi yang cocok; selain itu `serials.get` tak dipanggil.
  const actionable =
    subject !== undefined &&
    actButtonSpecs(subject, serialActorModules(me, subject.buId)).some(
      (spec) => spec.kind !== 'report',
    );
  const serialQuery = useQuery({
    ...serialDetailQueryOptions(report?.serialId ?? ''),
    enabled: actionable,
  });
  const actions = useSerialActions({
    me,
    context: 'case',
    subject: actionable && !serialQuery.isError ? subject : undefined,
    serial: serialQuery.data?.serial,
    pending: serialQuery.isPending,
  });
  if (detail.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }
  if (detail.isError || !report) {
    const missing = isMissing(detail.error);
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {missing ? 'Laporan tidak ditemukan' : 'Laporan tidak dapat dimuat'}
        </h1>
        {missing ? null : (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(detail.error)}
          </p>
        )}
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar Laporan
        </Button>
      </PageContent>
    );
  }
  return (
    <>
      <ViewPage
        title={<span className="font-mono">{report.number}</span>}
        badge={
          report.closedOn && report.outcome ? (
            <Badge variant="soft" color={report.outcome === 'good' ? 'success' : 'destructive'}>
              Selesai: {OUTCOME_LABEL[report.outcome]}
            </Badge>
          ) : (
            <Badge variant="soft" color="warning">
              Laporan aktif
            </Badge>
          )
        }
        actionsTour="serial-actions"
        actionItems={actions.items}
        aside={<ViewMeta createdBy={report.reporter} />}
      >
        <SerialStepper {...caseStepperState(report)} />
        <ViewSection title="Ringkasan">
          <Summary report={report} />
        </ViewSection>
        <ViewSection title="Linimasa laporan">
          <CaseTimeline report={report} />
        </ViewSection>
      </ViewPage>
      {actions.dialog}
    </>
  );
}
