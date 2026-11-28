import type { ClBundleDto } from '@shared/contract';
import type { ClIssue } from '@shared/countrylock-bundle';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { clKeys, draftQueryOptions, usePublishBundle } from '../queries';

const FORM_ID = 'cl-publish-form';
const NOTE_MAX = 200;

/** Penjelasan akibat per kode temuan (melengkapi pesan server): apa yang terjadi bila tetap terbit. */
const HINTS: Record<string, string> = {
  DUPLICATE_ROUTER_NAME:
    'Dua berkas router bernama sama saling menimpa di /temp router jump, sehingga skrip memakai berkas yang salah. Ganti salah satu namanya.',
};

/** Akibat perubahan alamat/jaringan yang harus dipahami penerbit sebelum bundel diterbitkan. */
const ADDRESS_CONSEQUENCES = [
  'Router yang sudah terpasang masih di alamat lama dan tidak akan ikut berubah sendiri.',
  'Komputer operator harus pindah segmen/alamat sesuai pengaturan baru agar dapat menjangkau router.',
];

function IssueList({
  issues,
  color,
  title,
}: {
  issues: readonly ClIssue[];
  color: 'destructive' | 'warning';
  title?: string;
}) {
  if (issues.length === 0) return null;
  return (
    <Alert color={color}>
      <AlertDescription>
        <span className="mb-1 block font-medium">
          {title ??
            (color === 'destructive'
              ? `${issues.length} masalah harus diperbaiki sebelum terbit`
              : `${issues.length} peringatan (tidak menghalangi terbit)`)}
        </span>
        <ul className="list-disc space-y-1 pl-5">
          {issues.map((issue, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: temuan tak punya id dan daftar ini statis per hasil validasi.
            <li key={`${issue.code}-${issue.path ?? ''}-${index}`}>
              {issue.path ? <code className="mr-1 text-xs">{issue.path}</code> : null}
              {issue.message}
              {HINTS[issue.code] ? (
                <span className="mt-0.5 block text-xs">{HINTS[issue.code]}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished: (bundle: ClBundleDto) => void;
}

/**
 * Dialog Terbitkan: menghitung ulang draf saat dibuka (berkas hidup, firmware, temuan validasi, hash kandidat). Temuan
 * `error` memblokir tombol, `warning` hanya ditampilkan; catatan wajib; draf yang sama dengan bundel terbit terakhir tidak
 * dapat diterbitkan lagi. Server tetap penjaga: draf yang berubah di tengah jalan menjawab konflik dan dialog menampilkannya.
 */
export function PublishDialog({ open, onOpenChange, onPublished }: PublishDialogProps) {
  const client = useQueryClient();
  const draft = useQuery({ ...draftQueryOptions(), enabled: open });
  const publish = usePublishBundle();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);

  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
      setUnderstood(false);
      // Draf dapat berubah sejak halaman dibuka: selalu hitung ulang saat dialog dibuka.
      void client.invalidateQueries({ queryKey: clKeys.draft });
    }
  }, [open, client]);

  const data = draft.data;
  const errors = data?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const addressChanges = data?.issues.filter((issue) => issue.code === 'ADDRESS_CHANGED') ?? [];
  const warnings =
    data?.issues.filter(
      (issue) => issue.severity === 'warning' && issue.code !== 'ADDRESS_CHANGED',
    ) ?? [];
  // Perubahan alamat tidak memblokir, tetapi penerbit wajib menyatakan paham akibatnya.
  const needsAcknowledge = addressChanges.length > 0;
  const blockedReason =
    data === undefined
      ? null
      : errors.length > 0
        ? 'Perbaiki masalah di atas dulu'
        : data.changed
          ? null
          : 'Tidak ada perubahan dari bundel terbit terakhir';
  // Selama draf dihitung ulang (dialog baru dibuka) hasil lama tidak boleh dipakai memutuskan boleh terbit.
  const canSubmit =
    data !== undefined &&
    !draft.isFetching &&
    blockedReason === null &&
    note.trim() !== '' &&
    (!needsAcknowledge || understood);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    publish.mutate(note.trim(), {
      onSuccess: (bundle) => {
        toast.success(`Bundel ${bundle.number} diterbitkan`);
        onPublished(bundle);
        onOpenChange(false);
      },
      onError: (failure) => setError(describeError(failure)),
    });
  };

  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={FORM_ID}
      title="Terbitkan bundel"
      description="Bundel memuat revisi terbaru semua berkas draf dan tidak dapat diubah setelah terbit."
      size="lg"
      submitting={publish.isPending}
      submitDisabled={!canSubmit}
      submitLabel="Terbitkan"
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        {draft.isFetching ? (
          <p role="status" className="text-sm text-muted-foreground">
            Memeriksa draf…
          </p>
        ) : null}
        {draft.isError ? (
          <Alert color="destructive">
            <AlertDescription>{describeError(draft.error)}</AlertDescription>
          </Alert>
        ) : null}
        {data ? (
          <>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted-foreground">Isi draf</dt>
              <dd>
                {data.files.length} berkas, {data.firmwares.length} firmware
              </dd>
              <dt className="text-muted-foreground">Hash komputer</dt>
              <dd>
                <code className="break-all text-xs">{data.computerHash.slice(0, 16)}</code>
              </dd>
              <dt className="text-muted-foreground">Hash router</dt>
              <dd>
                <code className="break-all text-xs">{data.routerHash.slice(0, 16)}</code>
              </dd>
            </dl>
            <IssueList issues={errors} color="destructive" />
            {needsAcknowledge ? (
              <div className="space-y-2">
                <IssueList
                  issues={addressChanges}
                  color="warning"
                  title="Alamat atau jaringan berubah dari bundel terbit terakhir"
                />
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {ADDRESS_CONSEQUENCES.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="cl-publish-understood"
                    checked={understood}
                    onCheckedChange={(checked) => setUnderstood(checked === true)}
                  />
                  <Label htmlFor="cl-publish-understood">Saya paham akibatnya</Label>
                </div>
              </div>
            ) : null}
            <IssueList issues={warnings} color="warning" />
            {data.changed ? null : (
              <Alert color="info">
                <AlertDescription>
                  Tidak ada perubahan dari bundel terbit terakhir, jadi tidak ada yang perlu
                  diterbitkan.
                </AlertDescription>
              </Alert>
            )}
          </>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="cl-publish-note" required>
            Catatan rilis
          </Label>
          <Input
            id="cl-publish-note"
            value={note}
            maxLength={NOTE_MAX}
            required
            aria-required="true"
            placeholder="Ringkas apa yang berubah"
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
