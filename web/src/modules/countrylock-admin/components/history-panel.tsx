import type { ClRevisionDto } from '@shared/contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type DataColumn, DataTable, type RowAction } from '@/components/data-table';
import { formatBytes } from '@/components/file-dialog/accept';
import { Select } from '@/components/select';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { isStaleSaveError } from '@/modules/sticker/lib/stale';
import type { CodeLanguage } from '../lib/language';
import {
  clKeys,
  fileQueryOptions,
  historyQueryOptions,
  revisionQueryOptions,
  useRevertFile,
} from '../queries';
import { DiffView } from './diff-view';

export interface HistoryPanelProps {
  fileId: string;
  kind: 'text' | 'binary';
  language: CodeLanguage;
  /** Boleh mengembalikan revisi (`countrylock: edit`). */
  canEdit: boolean;
}

function revisionLabel(revision: ClRevisionDto): string {
  return revision.message === ''
    ? `Revisi ${revision.seq}`
    : `Revisi ${revision.seq}: ${revision.message}`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Hash disalin');
  } catch {
    toast.error('Hash tidak dapat disalin');
  }
}

/** Perbandingan dua revisi teks: isi diambil per revisi (tak pernah berubah, jadi di-cache). */
function Compare({
  fileId,
  from,
  to,
  language,
}: {
  fileId: string;
  from: ClRevisionDto;
  to: ClRevisionDto;
  language: CodeLanguage;
}) {
  const original = useQuery(revisionQueryOptions(fileId, from.seq));
  const modified = useQuery(revisionQueryOptions(fileId, to.seq));
  if (original.isError || modified.isError) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        {describeError(original.error ?? modified.error)}
      </p>
    );
  }
  if (!original.data || !modified.data) {
    return <p className="text-sm text-muted-foreground">Memuat revisi…</p>;
  }
  return (
    <DiffView
      original={original.data.text ?? ''}
      modified={modified.data.text ?? ''}
      language={language}
      originalLabel={`Revisi ${from.seq}`}
      modifiedLabel={`Revisi ${to.seq}`}
    />
  );
}

/**
 * Tab Riwayat: daftar revisi berkas (terbaru di atas). Berkas teks: pilih dua revisi untuk melihat selisih dan
 * "Kembalikan revisi ini" (menjadi revisi BARU berisi isi lama). Berkas biner: daftar versi (hash, ukuran, pengunggah,
 * waktu) tanpa diff; hash dapat disalin.
 */
export function HistoryPanel({ fileId, kind, language, canEdit }: HistoryPanelProps) {
  const client = useQueryClient();
  const history = useQuery(historyQueryOptions(fileId));
  // Dasar pengembalian (`baseSeq` dan `If-Match`) SELALU dari satu detail berkas yang sama, bukan dari daftar riwayat:
  // dua sumber berbeda bisa tidak serempak dan memunculkan 412 positif palsu.
  const detail = useQuery(fileQueryOptions(fileId));
  const revert = useRevertFile();
  const revisions = useMemo(
    () => [...(history.data ?? [])].sort((a, b) => b.seq - a.seq),
    [history.data],
  );
  const [fromSeq, setFromSeq] = useState<number | null>(null);
  const [toSeq, setToSeq] = useState<number | null>(null);
  const [comparing, setComparing] = useState(false);
  const [revertTarget, setRevertTarget] = useState<ClRevisionDto | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);
  // Versi detail berkas saat revisi dipilih; dikirim ke server agar suntingan orang lain tak tertimpa.
  const [revertBase, setRevertBase] = useState<{ seq: number; updatedAt: string } | null>(null);
  const [revertStale, setRevertStale] = useState(false);
  const latest = revisions[0]?.seq;
  const effectiveTo = toSeq ?? latest ?? null;
  const effectiveFrom = fromSeq ?? revisions[1]?.seq ?? null;
  const bySeq = new Map(revisions.map((revision) => [revision.seq, revision]));
  const fromRevision = effectiveFrom === null ? undefined : bySeq.get(effectiveFrom);
  const toRevision = effectiveTo === null ? undefined : bySeq.get(effectiveTo);
  const options = revisions.map((revision) => ({
    value: String(revision.seq),
    label: revisionLabel(revision),
  }));

  const columns: DataColumn<ClRevisionDto>[] = [
    {
      id: 'seq',
      header: 'Revisi',
      mobile: 'title',
      cell: (revision) => (
        <span className="inline-flex items-center gap-2">
          <span>Revisi {revision.seq}</span>
          {revision.seq === latest ? (
            <Badge variant="solid" color="primary">
              Terbaru
            </Badge>
          ) : null}
        </span>
      ),
    },
    { id: 'message', header: 'Catatan', cell: (revision) => revision.message },
    { id: 'author', header: 'Penulis', cell: (revision) => revision.author },
    { id: 'createdAt', header: 'Waktu', cell: (revision) => formatStamp(revision.createdAt) },
    {
      id: 'size',
      header: 'Ukuran',
      align: 'right',
      cell: (revision) => formatBytes(revision.size),
    },
    {
      id: 'sha256',
      header: 'Hash',
      mobile: 'hide',
      cell: (revision) =>
        kind === 'binary' ? (
          <span className="inline-flex items-center gap-2">
            <code className="break-all text-xs">{revision.sha256}</code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              color="primary"
              aria-label={`Salin hash revisi ${revision.seq}`}
              onClick={() => void copyText(revision.sha256)}
            >
              Salin
            </Button>
          </span>
        ) : (
          <code className="text-xs">{revision.sha256.slice(0, 12)}</code>
        ),
    },
  ];

  const actions = (revision: ClRevisionDto): RowAction[] => [
    {
      id: 'revert',
      action: 'restore',
      label: `Kembalikan revisi ${revision.seq}`,
      shortLabel: 'Kembalikan revisi ini',
      showLabel: true,
      hidden: !canEdit || kind !== 'text' || revision.seq === (detail.data?.headRev ?? latest),
      busy: revert.isPending && revert.variables?.seq === revision.seq,
      disabled: revert.isPending || detail.data === undefined,
      ...(detail.data === undefined ? { disabledReason: 'Memuat versi berkas…' } : {}),
      onSelect: () => {
        const file = detail.data;
        if (!file) return;
        setRevertError(null);
        setRevertStale(false);
        setRevertBase({ seq: file.headRev, updatedAt: file.updatedAt });
        setRevertTarget(revision);
      },
    },
  ];

  // Konfirmasi pengembalian: server menegakkan versi (`baseSeq` + `If-Match`); orang lain yang sudah menyimpan sejak
  // dialog dibuka = 412, dan dialog menjelaskannya tanpa menimpa apa pun.
  const confirmRevert = () => {
    const target = revertTarget;
    if (!target || revertBase === null) return;
    setRevertError(null);
    revert.mutate(
      {
        id: fileId,
        seq: target.seq,
        baseSeq: revertBase.seq,
        expectedUpdatedAt: revertBase.updatedAt,
      },
      {
        onSuccess: () => {
          toast.success(`Revisi ${target.seq} dikembalikan sebagai revisi baru`);
          setRevertTarget(null);
        },
        onError: (error) => {
          if (isStaleSaveError(error)) {
            setRevertStale(true);
            setRevertError(
              'Berkas sudah diubah orang lain sejak dialog ini dibuka, jadi tidak ada yang dikembalikan. Riwayat dimuat ulang: tutup dialog, tinjau revisi terbaru, lalu coba lagi.',
            );
            void history.refetch();
            void client.invalidateQueries({ queryKey: clKeys.file(fileId) });
          } else {
            setRevertError(describeError(error));
          }
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      {kind === 'text' && revisions.length >= 2 ? (
        <section aria-label="Bandingkan revisi" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              id="cl-compare-from"
              label="Dari revisi"
              options={options}
              value={effectiveFrom === null ? '' : String(effectiveFrom)}
              onValueChange={(value) => {
                setFromSeq(Number(value));
                setComparing(false);
              }}
            />
            <Select
              id="cl-compare-to"
              label="Ke revisi"
              options={options}
              value={effectiveTo === null ? '' : String(effectiveTo)}
              onValueChange={(value) => {
                setToSeq(Number(value));
                setComparing(false);
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            color="primary"
            disabled={
              fromRevision === undefined ||
              toRevision === undefined ||
              fromRevision.seq === toRevision.seq
            }
            onClick={() => setComparing(true)}
          >
            Bandingkan
          </Button>
          {comparing && fromRevision && toRevision ? (
            <Compare fileId={fileId} from={fromRevision} to={toRevision} language={language} />
          ) : null}
        </section>
      ) : null}
      <DataTable
        rows={revisions}
        rowKey={(revision) => String(revision.seq)}
        columns={columns}
        label="Riwayat revisi"
        selectLabel={(revision) => `Revisi ${revision.seq}`}
        actions={actions}
        fit="content"
        empty="Belum ada revisi."
        isLoading={history.isPending}
        isError={history.isLoadingError}
        onRetry={() => void history.refetch()}
      />
      <AlertDialog
        open={revertTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revert.isPending) setRevertTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kembalikan revisi {revertTarget?.seq}?</AlertDialogTitle>
            <AlertDialogDescription>
              Isi revisi {revertTarget?.seq} dijadikan revisi BARU di atas revisi terbaru; riwayat
              tidak ditulis ulang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revertError === null ? null : (
            <Alert color="destructive">
              <AlertDescription>{revertError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revert.isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              color="primary"
              disabled={revert.isPending || revertStale}
              onClick={(event) => {
                // Dialog tetap terbuka sampai berhasil: galat dan konflik tampil di dalamnya.
                event.preventDefault();
                confirmRevert();
              }}
            >
              Kembalikan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
