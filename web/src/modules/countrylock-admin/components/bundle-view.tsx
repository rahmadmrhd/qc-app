import type { ClBundleDetailDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { type DataColumn, DataTable } from '@/components/data-table';
import { formatBytes } from '@/components/file-dialog/accept';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { can } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { BRAND_LABELS, ROLE_LABELS } from '../lib/labels';
import { bundleQueryOptions, bundlesQueryOptions, useReactivateBundle } from '../queries';
import { bundleOrigin } from './bundles-page';

const FORM_ID = 'cl-reactivate-form';

type BundleFile = ClBundleDetailDto['files'][number];
type BundleFirmware = ClBundleDetailDto['firmwares'][number];

function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function ReactivateDialog({
  bundle,
  open,
  onOpenChange,
  onDone,
}: {
  bundle: ClBundleDetailDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (number: number) => void;
}) {
  const reactivate = useReactivateBundle();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (note.trim() === '') return;
    setError(null);
    reactivate.mutate(
      { number: bundle.number, note: note.trim() },
      {
        onSuccess: (created) => {
          toast.success(
            `Bundel ${bundle.number} diaktifkan ulang sebagai bundel ${created.number}`,
          );
          onOpenChange(false);
          onDone(created.number);
        },
        onError: (failure) => setError(describeError(failure)),
      },
    );
  };
  return (
    <FormDialogShell
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setNote('');
          setError(null);
        }
        onOpenChange(next);
      }}
      formId={FORM_ID}
      title={`Jadikan bundel ${bundle.number} versi aktif`}
      description="Isi bundel ini diterbitkan lagi sebagai bundel BARU (nomor berikutnya); riwayat tidak ditulis ulang dan desktop akan memakainya."
      submitting={reactivate.isPending}
      submitDisabled={note.trim() === ''}
      submitLabel="Jadikan versi aktif"
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cl-reactivate-note" required>
            Catatan
          </Label>
          <Input
            id="cl-reactivate-note"
            value={note}
            maxLength={200}
            required
            aria-required="true"
            placeholder="Alasan kembali ke versi ini"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        {error === null ? null : (
          <Alert color="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
    </FormDialogShell>
  );
}

export interface BundleViewProps {
  number: number;
  onBack: () => void;
}

/**
 * View satu bundel terbit (kit CRUD, `ViewPage` tanpa tab): ringkasan (hash, minApp, penerbit, catatan, asal), berkas,
 * dan firmware. "Jadikan versi aktif" hanya bagi `countrylock: manage` dan hanya untuk bundel yang BUKAN yang terbaru.
 */
export function BundleView({ number, onBack }: BundleViewProps) {
  const me = useMe();
  const stack = useStackNavigation();
  const detail = useQuery(bundleQueryOptions(number));
  const list = useQuery(bundlesQueryOptions());
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const bundle = detail.data;
  const latest = list.data?.reduce((max, item) => Math.max(max, item.number), 0);
  const isActive = latest !== undefined && bundle !== undefined && bundle.number === latest;
  const canManage = can(me, 'countrylock', 'manage');

  if (detail.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }
  if (detail.isError || !bundle) {
    const missing = isMissing(detail.error);
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {missing ? 'Bundel tidak ditemukan' : 'Bundel tidak dapat dimuat'}
        </h1>
        {missing ? null : (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(detail.error)}
          </p>
        )}
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar bundel
        </Button>
      </PageContent>
    );
  }

  const fileColumns: DataColumn<BundleFile>[] = [
    { id: 'path', header: 'Nama berkas', mobile: 'title', cell: (file) => file.path },
    { id: 'role', header: 'Peran', mobile: 'badge', cell: (file) => ROLE_LABELS[file.role] },
    { id: 'size', header: 'Ukuran', align: 'right', cell: (file) => formatBytes(file.size) },
    {
      id: 'sha',
      header: 'sha256',
      mobile: 'hide',
      cell: (file) => <code className="text-xs">{file.sha256.slice(0, 12)}</code>,
    },
  ];
  const firmwareColumns: DataColumn<BundleFirmware>[] = [
    {
      id: 'code',
      header: 'Kode',
      mobile: 'title',
      cell: (firmware) => `${BRAND_LABELS[firmware.brand]} ${firmware.code}`,
    },
    { id: 'label', header: 'Label', cell: (firmware) => firmware.label },
    { id: 'script', header: 'Skrip', cell: (firmware) => firmware.scriptPath ?? 'Belum ada skrip' },
    {
      id: 'parallel',
      header: 'Paralel',
      cell: (firmware) => (firmware.parallel ? 'Ya' : 'Tidak'),
    },
  ];

  return (
    <>
      <ViewPage
        title={`Bundel #${bundle.number}`}
        badge={
          isActive ? (
            <Badge variant="solid" color="success">
              Aktif
            </Badge>
          ) : null
        }
        actionItems={[
          {
            id: 'reactivate',
            action: 'restore',
            label: 'Jadikan versi aktif',
            primary: true,
            hidden: !canManage || isActive || latest === undefined,
            onSelect: () => setReactivateOpen(true),
          },
        ]}
        aside={<ViewMeta createdBy={bundle.publishedBy} createdAt={bundle.createdAt} />}
      >
        <ViewSection title="Ringkasan">
          <DetailList
            items={[
              { label: 'Nomor', value: `#${bundle.number}` },
              { label: 'Catatan', value: bundle.note },
              { label: 'Asal', value: bundleOrigin(bundle) },
              { label: 'Diterbitkan oleh', value: bundle.publishedBy },
              { label: 'Waktu terbit', value: formatStamp(bundle.createdAt) },
              { label: 'Versi aplikasi minimum', value: bundle.minApp },
              {
                label: 'Hash komputer',
                value: <code className="break-all text-xs">{bundle.computerHash}</code>,
              },
              {
                label: 'Hash router',
                value: <code className="break-all text-xs">{bundle.routerHash}</code>,
              },
            ]}
          />
        </ViewSection>
        <ViewSection title={`Berkas (${bundle.files.length})`}>
          <DataTable
            rows={bundle.files}
            rowKey={(file) => file.path}
            columns={fileColumns}
            label="Berkas dalam bundel"
            fit="content"
            empty="Bundel tanpa berkas."
          />
        </ViewSection>
        <ViewSection title={`Firmware (${bundle.firmwares.length})`}>
          <DataTable
            rows={bundle.firmwares}
            rowKey={(firmware) => `${firmware.brand}:${firmware.code}`}
            columns={firmwareColumns}
            label="Firmware dalam bundel"
            fit="content"
            empty="Bundel tanpa firmware."
          />
        </ViewSection>
      </ViewPage>
      <ReactivateDialog
        bundle={bundle}
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        onDone={(created) =>
          stack.replace({ to: '/countrylock/bundles/$number', params: { number: String(created) } })
        }
      />
    </>
  );
}
