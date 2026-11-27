import { CL_TEXT_MAX_BYTES } from '@shared/countrylock-bundle';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { formatBytes } from '@/components/file-dialog/accept';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage } from '@/components/page/view-page';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { isStaleSaveError } from '@/modules/sticker/lib/stale';
import { ROLE_LABELS } from '../lib/labels';
import { languageOf } from '../lib/language';
import { fileQueryOptions, useAfterUpload, useRemoveFile, useSaveFile } from '../queries';
import { BinaryUploadDialog } from './binary-upload';
import { CodeEditor } from './code-editor';
import { HistoryPanel } from './history-panel';

const MESSAGE_MAX = 200;

/** Berkas tak ada (atau sudah dihapus): server menjawab `NOT_FOUND` seragam. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

/** Versi server yang menjadi dasar suntingan: dikirim sebagai `baseSeq` dan `If-Match` saat menyimpan. */
interface Base {
  seq: number;
  updatedAt: string;
  text: string;
}

export interface FileEditorPageProps {
  fileId: string;
  /** Kembali ke daftar berkas (juga setelah menghapus). */
  onBack: () => void;
}

/**
 * View satu berkas draf (kit CRUD, `ViewPage`): tab "Isi" (editor + catatan perubahan; hanya berkas teks) dan
 * "Riwayat" (revisi, perbandingan, kembalikan). Simpan mengirim `baseSeq` dan `If-Match`; bila orang lain sudah
 * menyimpan lebih dulu (412), suntingan di editor TIDAK ditimpa: dialog menawarkan memuat ulang (membuang suntingan)
 * atau tetap di sini. `settings.json` hanya dibaca di sini; ia diubah lewat form Pengaturan Router.
 */
export function FileEditorPage({ fileId, onBack }: FileEditorPageProps) {
  const detail = useQuery(fileQueryOptions(fileId));
  const save = useSaveFile();
  const remove = useRemoveFile();
  const afterUpload = useAfterUpload();
  const file = detail.data;
  const [base, setBase] = useState<Base | null>(null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [stale, setStale] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const dirty = base !== null && text !== base.text;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const baseRef = useRef<Base | null>(null);
  baseRef.current = base;
  useUnsavedChanges(dirty);

  // Memasang versi server ke editor saat pertama dimuat, dan saat berubah selama belum ada suntingan lokal.
  useEffect(() => {
    if (!file || file.text === null) return;
    const current = baseRef.current;
    const sameVersion =
      current !== null && current.seq === file.headRev && current.updatedAt === file.updatedAt;
    if (current !== null && (dirtyRef.current || sameVersion)) return;
    setBase({ seq: file.headRev, updatedAt: file.updatedAt, text: file.text });
    setText(file.text);
  }, [file]);

  if (detail.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }
  if (detail.isError || !file) {
    const missing = isMissing(detail.error);
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {missing ? 'Berkas tidak ditemukan' : 'Berkas tidak dapat dimuat'}
        </h1>
        {missing ? null : (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(detail.error)}
          </p>
        )}
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke daftar berkas
        </Button>
      </PageContent>
    );
  }

  const isText = file.kind === 'text';
  const settingsFile = file.role === 'settings';
  const language = languageOf(file.path);
  const textBytes = isText ? new TextEncoder().encode(text).length : 0;
  const tooLarge = textBytes > CL_TEXT_MAX_BYTES;
  const canSave = isText && !settingsFile && base !== null && dirty && !tooLarge;

  const submit = () => {
    if (!base || !canSave) return;
    const note = message.trim();
    save.mutate(
      {
        path: file.path,
        role: file.role,
        text,
        ...(note === '' ? {} : { message: note }),
        baseSeq: base.seq,
        expectedUpdatedAt: base.updatedAt,
      },
      {
        onSuccess: (saved) => {
          setBase({
            seq: saved.headRev,
            updatedAt: saved.updatedAt,
            text: saved.text ?? text,
          });
          setMessage('');
          toast.success(`Revisi ${saved.headRev} disimpan`);
        },
        onError: (error) => {
          if (isStaleSaveError(error)) setStale(true);
          else toast.error(describeError(error));
        },
      },
    );
  };

  const reload = async () => {
    const fresh = await detail.refetch();
    const data = fresh.data;
    if (data && data.text !== null) {
      setBase({ seq: data.headRev, updatedAt: data.updatedAt, text: data.text });
      setText(data.text);
      setMessage('');
    }
    setStale(false);
  };

  const doDelete = () =>
    remove.mutate(file.id, {
      onSuccess: () => {
        setConfirmDelete(false);
        toast.success(`${file.path} dihapus`);
        onBack();
      },
      onError: (error) => {
        setConfirmDelete(false);
        toast.error(describeError(error));
      },
    });

  const info = (
    <DetailList
      items={[
        { label: 'Nama berkas', value: <code>{file.path}</code> },
        { label: 'Peran', value: ROLE_LABELS[file.role] },
        { label: 'Revisi terbaru', value: `Revisi ${file.headRev}` },
        { label: 'Ukuran', value: formatBytes(file.size) },
        {
          label: 'sha256',
          value: <code className="break-all text-xs">{file.sha256}</code>,
          hidden: isText,
        },
      ]}
    />
  );

  const editTab = (
    <div className="space-y-3">
      {settingsFile ? (
        <Alert color="info">
          <AlertDescription>
            settings.json diubah lewat halaman{' '}
            <Link to="/countrylock/settings" className="underline">
              Pengaturan Router
            </Link>{' '}
            (form yang divalidasi). Di sini hanya dibaca; tab Riwayat dapat mengembalikan revisi
            lama.
          </AlertDescription>
        </Alert>
      ) : null}
      {tooLarge ? (
        <Alert color="destructive">
          <AlertDescription>
            Isi berkas {formatBytes(textBytes)} melebihi batas {formatBytes(CL_TEXT_MAX_BYTES)}.
          </AlertDescription>
        </Alert>
      ) : null}
      <CodeEditor
        value={text}
        onChange={setText}
        language={language}
        readOnly={settingsFile}
        label={`Isi ${file.path}`}
      />
      {settingsFile ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="cl-save-message">Catatan perubahan (opsional)</Label>
          <Input
            id="cl-save-message"
            value={message}
            maxLength={MESSAGE_MAX}
            placeholder="Apa yang diubah dan kenapa"
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>
      )}
    </div>
  );

  const historyTab = (
    <div className="space-y-4">
      {isText ? null : info}
      <HistoryPanel fileId={file.id} kind={file.kind} language={language} canEdit />
    </div>
  );

  return (
    <>
      <ViewPage
        title={file.path}
        badge={
          <span className="inline-flex items-center gap-2">
            <Badge variant="soft" color="secondary">
              {ROLE_LABELS[file.role]}
            </Badge>
            {dirty ? (
              <Badge variant="soft" color="warning">
                Belum disimpan
              </Badge>
            ) : null}
          </span>
        }
        actionItems={[
          {
            id: 'save',
            action: 'save',
            primary: true,
            hidden: !isText || settingsFile,
            busy: save.isPending,
            disabled: !canSave,
            ...(canSave || !isText
              ? {}
              : { disabledReason: dirty ? 'Isi terlalu besar' : 'Belum ada perubahan' }),
            onSelect: submit,
          },
          {
            id: 'upload',
            action: 'upload',
            label: 'Unggah versi baru',
            primary: true,
            hidden: isText,
            onSelect: () => setUploadOpen(true),
          },
          {
            id: 'delete',
            action: 'delete',
            hidden: settingsFile,
            onSelect: () => setConfirmDelete(true),
          },
        ]}
        tabs={
          isText
            ? [
                { id: 'isi', label: 'Isi', content: editTab },
                { id: 'riwayat', label: 'Riwayat', content: historyTab },
              ]
            : [{ id: 'riwayat', label: 'Riwayat', content: historyTab }]
        }
        aside={<ViewMeta updatedBy={file.updatedBy} updatedAt={file.updatedAt} />}
      />
      <AlertDialog open={stale} onOpenChange={(open) => !open && setStale(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Berkas diubah orang lain</AlertDialogTitle>
            <AlertDialogDescription>
              Orang lain menyimpan revisi baru sejak Anda membuka berkas ini, jadi suntingan Anda
              belum disimpan. Suntingan tetap ada di editor sampai Anda memuat ulang. Muat ulang
              akan membuang suntingan dan menampilkan revisi terbaru ({formatStamp(file.updatedAt)}
              ).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tetap di sini</AlertDialogCancel>
            <AlertDialogAction color="destructive" onClick={() => void reload()}>
              Muat ulang (buang suntingan saya)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        count={1}
        subject={`berkas ${file.path}`}
        permanent
        usage="Riwayat revisinya tetap tersimpan di server; berkas dapat dibuat lagi dengan nama yang sama. Bundel yang sudah terbit tidak terpengaruh."
        onConfirm={doDelete}
        busy={remove.isPending}
      />
      <BinaryUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        fixedPath={file.path}
        onUploaded={afterUpload}
      />
    </>
  );
}
