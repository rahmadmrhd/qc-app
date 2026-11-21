import { splitSerialInput } from '@shared/serials';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FormPage } from '@/components/page/form-page';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { STATUS_LABEL } from '../lib/labels';
import { serialLookupQueryOptions } from '../queries';
import {
  ExistingReportForm,
  NewReportForm,
  REPORT_FORM_ID,
  type ReportFormState,
  UnitSummary,
} from './report-form';
import { type ScanFeedback, SerialScanInput } from './serial-scan-input';

export interface ReportPageProps {
  /** Pindah ke detail serial (laporan baru terbuka, atau menuju laporan aktif yang sudah ada: caseId). */
  onOpenSerial: (serialId: string, caseId?: string) => void;
  /** Batal / kembali (bar judul `FormPage`); pemanggil menavigasi lewat tumpukan layar. */
  onCancel: () => void;
}

const FEEDBACK_TEXT = { added: 'Dicari', duplicate: 'Dicari ulang', rejected: 'Ditolak' } as const;

/**
 * Halaman Lapor Rusak: ketik atau pindai Serial Number, lalu dicocokkan dengan serial yang boleh ditulis (Serial Number
 * unik se-sistem: paling banyak satu kecocokan, jadi tidak ada pemilih BU). Lolos = catatan lalu Lapor; sudah punya
 * laporan aktif atau sudah Rusak = ditolak dengan tautan; belum tercatat = dicatat langsung sebagai Dilaporkan (item,
 * lokasi, catatan); ada di BU yang tak boleh Anda tulis = peringatan dengan kode BU itu saja (tanpa data lain).
 */
export function ReportPage({ onOpenSerial, onCancel }: ReportPageProps) {
  const [query, setQuery] = useState('');
  // Keadaan Simpan form aktif (pencarian yang lolos): tombol Lapor rusak milik FormPage mengikutinya; tanpa form = nonaktif.
  const [formState, setFormState] = useState<ReportFormState | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const lookup = useQuery(serialLookupQueryOptions(query));

  function search(text: string): ScanFeedback {
    const split = splitSerialInput(text);
    const first = split.serials[0];
    if (first === undefined) return 'rejected';
    setHint(
      split.serials.length > 1
        ? `Satu laporan untuk satu Serial Number: yang dipakai ${first}.`
        : null,
    );
    if (first === query) {
      void lookup.refetch();
      return 'duplicate';
    }
    setQuery(first);
    return 'added';
  }

  const matches = lookup.data?.matches ?? [];
  const selected = matches[0];
  const elsewhere = lookup.data?.elsewhere ?? null;

  return (
    // FormPage (keputusan pemilik 2026-11-21): judul, Batal, dan Lapor rusak di bar judul yang menempel (desktop) atau
    // bar bawah (ponsel); form laporan yang aktif mengirim lewat REPORT_FORM_ID.
    <FormPage
      formId={REPORT_FORM_ID}
      title="Lapor Rusak"
      onCancel={onCancel}
      submitting={formState?.pending ?? false}
      submitLabel="Lapor rusak"
      submitDisabled={formState === null || !formState.canSubmit}
      saveTour="report-submit"
    >
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Ketik atau scan Serial Number yang bermasalah. Kalau belum tercatat, Serial Number akan
          dicatat langsung sebagai Dilaporkan.
        </p>
        <div data-tour="report-serial">
          <SerialScanInput
            id="report-serial"
            label="Serial Number"
            onSubmit={search}
            feedbackText={FEEDBACK_TEXT}
            // Satu laporan untuk satu Serial Number: dialog kamera tanpa tabel (serial sah pertama langsung dipakai).
            cameraSingle
            autoFocus
          />
        </div>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {query === '' ? null : lookup.isPending ? (
          <p className="text-sm text-muted-foreground">Mencari {query}…</p>
        ) : lookup.isError ? (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(lookup.error)}
          </p>
        ) : matches.length === 0 && elsewhere !== null ? (
          <section
            aria-label="Tidak bisa dilaporkan"
            className="space-y-3 rounded-lg border border-warning-text/35 bg-warning-text/10 p-4"
            data-tour="report-result"
          >
            <p role="status" className="text-sm">
              {`Serial ini ada di BU ${elsewhere.buCode} dan Anda tidak punya akses untuk melaporkannya.`}
            </p>
          </section>
        ) : matches.length === 0 ? (
          <NewReportForm
            key={query}
            serial={query}
            onDone={onOpenSerial}
            onStateChange={setFormState}
          />
        ) : (
          <div className="space-y-4">
            {selected === undefined ? null : selected.status === 'broken' ? (
              <Blocked match={selected} onOpen={onOpenSerial}>
                Unit ini sudah dinyatakan rusak. Laporan baru tidak bisa dibuka; catatan klaim
                vendor atau unit pengganti bisa ditulis di halaman Serial Number-nya.
              </Blocked>
            ) : selected.openCaseId !== null ? (
              <Blocked match={selected} onOpen={onOpenSerial}>
                Serial ini sudah punya laporan aktif ({selected.openCaseNumber}). Lanjutkan
                penanganannya di laporan itu.
              </Blocked>
            ) : selected.status === 'good' ? (
              <ExistingReportForm
                key={selected.id}
                match={selected}
                onDone={onOpenSerial}
                onStateChange={setFormState}
              />
            ) : (
              <Blocked match={selected} onOpen={onOpenSerial}>
                Serial Number ini berstatus {STATUS_LABEL[selected.status]}, jadi tidak bisa
                dilaporkan dari sini.
              </Blocked>
            )}
          </div>
        )}
      </div>
    </FormPage>
  );
}

function Blocked({
  match,
  onOpen,
  children,
}: {
  match: Parameters<typeof UnitSummary>[0]['match'];
  onOpen: (serialId: string, caseId?: string) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label="Tidak bisa dilaporkan"
      className="space-y-3 rounded-lg border border-warning-text/35 bg-warning-text/10 p-4"
      data-tour="report-result"
    >
      <UnitSummary match={match} />
      <p role="status" className="text-sm">
        {children}
      </p>
      <Button
        type="button"
        variant="outline"
        color="primary"
        size="sm"
        data-tour="report-blocked-open"
        onClick={() => (match.openCaseId ? onOpen(match.id, match.openCaseId) : onOpen(match.id))}
      >
        {match.openCaseNumber ? `Buka ${match.openCaseNumber}` : 'Buka Serial Number ini'}
      </Button>
    </section>
  );
}
