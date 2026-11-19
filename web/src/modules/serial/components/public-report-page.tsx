import type { SerialEventDto } from '@shared/contract';
import { parseFileRef } from '@shared/files';
import type { SerialPublicEventDto } from '@shared/serial-public';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Components } from 'react-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDay, STATUS_LABEL } from '../lib/labels';
import { fetchPublicReport, PublicReportError, publicFileUrl } from '../lib/public-api';
import { Timeline } from './timeline';

export interface PublicReportPageProps {
  token: string;
  /** Pemegang tautan yang login dan berizin: pindah ke halaman biasa (semua izinnya berlaku). */
  onOpenSerial: (serialId: string, caseId: string) => void;
}

/**
 * Token ada di URL halaman ini: peramban tidak boleh mengirimnya sebagai Referer ke situs lain (tautan di catatan,
 * sumber daya luar). Meta `referrer` dipasang selama halaman tampil dan dilepas sesudahnya.
 */
function useNoReferrer(): void {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.append(meta);
    return () => meta.remove();
  }, []);
}

/** Kejadian publik dalam bentuk kartu linimasa biasa: tanpa `data` mentah dan tanpa stempel "dicatat". */
function toTimelineEvent(event: SerialPublicEventDto, caseNumber: string): SerialEventDto {
  return {
    id: `seq-${event.seq}`,
    caseId: null,
    seq: event.seq,
    type: event.type,
    occurredOn: event.occurredOn,
    createdAt: '',
    actorName: event.actorName,
    actorTeam: event.actorTeam,
    message: event.message,
    changes: event.changes,
    // Semua kejadian publik berada dalam lingkup satu laporan: nomornya mengisi rincian "Laporan LP/... dibuka/ditutup".
    data: { caseNumber },
    // Foto bukti QC tidak pernah tampil di halaman publik (rancangan 2026-11-16 §5.2).
    proofPhotos: [],
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/40 p-4">
      <main className="mx-auto max-w-3xl space-y-5 py-4">{children}</main>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Halaman publik laporan rusak lewat tautan bertanda tangan (rancangan §4.8): hanya baca, tanpa tombol aksi.
 * Detail unit dan linimasa dalam lingkup nomor LP itu (§5a). Semua kegagalan token (salah, kedaluwarsa, laporan tak
 * ada) dan batas laju memakai SATU pesan, sama seperti jawaban server.
 */
export function PublicReportPage({ token, onOpenSerial }: PublicReportPageProps) {
  useNoReferrer();
  const report = useQuery({
    queryKey: ['serial', 'public-report', token],
    queryFn: () => fetchPublicReport(token),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const viewerCanOpen = report.data?.viewerCanOpen === true;
  const serialId = report.data?.serialId;
  const caseId = report.data?.caseId;
  useEffect(() => {
    if (viewerCanOpen && serialId && caseId) onOpenSerial(serialId, caseId);
  }, [viewerCanOpen, serialId, caseId, onOpenSerial]);

  if (report.isPending || viewerCanOpen) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Memuat laporan…</p>
      </Shell>
    );
  }
  if (report.isError) {
    const invalid = report.error instanceof PublicReportError && report.error.isInvalidLink;
    return (
      <Shell>
        <section role="alert" className="space-y-2 rounded-lg border bg-card p-5">
          <h1 className="text-xl font-semibold">
            {invalid ? 'Tautan tidak berlaku atau sudah kedaluwarsa' : 'Laporan belum bisa dimuat'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {invalid
              ? 'Tautan ke laporan ini salah, sudah lewat masa berlakunya, atau terlalu sering dicoba. Minta tautan baru ke tim QC kalau masih perlu.'
              : 'Koneksi bermasalah atau server sedang sibuk. Coba lagi sebentar lagi.'}
          </p>
          {invalid ? null : (
            <Button type="button" variant="outline" size="sm" onClick={() => void report.refetch()}>
              Coba lagi
            </Button>
          )}
        </section>
      </Shell>
    );
  }

  const data = report.data;
  // Gambar pesan dilayani rute berkas bertoken; rujukan lain tidak dirender.
  const components: Components = {
    img: ({ src, alt }) => {
      const id = typeof src === 'string' ? parseFileRef(src) : null;
      return id ? (
        <img
          src={publicFileUrl(token, id)}
          alt={alt ?? ''}
          referrerPolicy="no-referrer"
          className="my-2 max-h-96 max-w-full rounded-md border"
        />
      ) : null;
    },
  };
  const outcome =
    data.outcome === 'broken'
      ? { label: 'Rusak', variant: 'destructive' as const }
      : data.outcome === 'good'
        ? { label: 'Selesai: lolos', variant: 'secondary' as const }
        : { label: 'Masih terbuka', variant: 'outline' as const };

  return (
    <Shell>
      <header className="space-y-2">
        <p className="text-xs text-muted-foreground">Laporan Serial Number rusak</p>
        <h1 className="font-mono text-2xl font-semibold">{data.number}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={outcome.variant}>{outcome.label}</Badge>
          <span className="text-xs text-muted-foreground">
            Dibuka {formatDay(data.openedOn)}
            {data.closedOn ? ` · selesai ${formatDay(data.closedOn)}` : ''}
          </span>
        </div>
      </header>
      <p role="note" className="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
        Tampilan baca-saja lewat tautan. Tautan ini berlaku sampai {formatDay(data.expiresOn)}.
      </p>
      <section aria-label="Unit" className="rounded-lg border bg-card p-4">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Serial Number">
            <span className="font-mono">{data.unit.serial}</span>
          </Fact>
          <Fact label="Item">{data.unit.itemLabel}</Fact>
          <Fact label="Business Unit">
            {data.unit.buCode} · {data.unit.buName}
          </Fact>
          <Fact label="Lokasi">{data.unit.locationName || '—'}</Fact>
          <Fact label="Tanggal uji">{formatDay(data.unit.testDate)}</Fact>
          <Fact label="Sample">{data.unit.sample ? 'Ya' : 'Tidak'}</Fact>
          <Fact label="Status unit">{STATUS_LABEL[data.unit.status]}</Fact>
        </dl>
      </section>
      <section aria-label="Linimasa laporan" className="space-y-3">
        <h2 className="text-sm font-semibold">Linimasa laporan</h2>
        <Timeline
          events={data.events.map((event) => toTimelineEvent(event, data.number))}
          markdownComponents={components}
        />
      </section>
    </Shell>
  );
}
