import type { PostelAttachmentDto, PostelDto, PostelNumberDto } from '@shared/contract';
import { type ReactNode, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { describeError } from '@/lib/api/describe-error';
import { saveFileDownload } from '@/modules/qrcode/lib/download';
import { daysLeftLabel, formatPostelDate, numberStatusLabel } from '../lib/condition';
import { PostelConditionBadge } from './postel-condition-badge';

export interface PostelViewProps {
  postel: PostelDto;
  canEdit: boolean;
  onEdit: () => void;
  /** Dipanggil setelah pengguna mengonfirmasi hapus di dialog; galat ditangani pemanggil. */
  onRemove: () => void | Promise<void>;
  onBack?: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Hanya URL http(s) yang dijadikan tautan (server sudah memvalidasi; ini pengaman tampilan). */
const isWebUrl = (value: string) => /^https?:\/\//i.test(value);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const format = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  if (bytes < 1_048_576) return `${format(bytes / 1024)} KB`;
  return `${format(bytes / 1_048_576)} MB`;
}

function NumberRow({ entry }: { entry: PostelNumberDto }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{entry.number}</TableCell>
      <TableCell>{formatPostelDate(entry.expiresOn)}</TableCell>
      <TableCell>{daysLeftLabel(entry.daysLeft)}</TableCell>
      <TableCell>
        {entry.role === 'old' && entry.condition !== 'expired' ? (
          <span className="text-sm text-muted-foreground">
            {numberStatusLabel(entry.role, entry.condition)}
          </span>
        ) : (
          <PostelConditionBadge
            condition={entry.condition}
            label={numberStatusLabel(entry.role, entry.condition)}
          />
        )}
      </TableCell>
      <TableCell>
        {isWebUrl(entry.link) ? (
          <a
            href={entry.link}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Buka sertifikat
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function AttachmentList({ attachments }: { attachments: readonly PostelAttachmentDto[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(attachment: PostelAttachmentDto) {
    setBusyId(attachment.id);
    setError(null);
    try {
      const file = await api('postelFiles.get', { id: attachment.id });
      saveFileDownload({ bytes: file.bytes, mime: file.mime, filename: attachment.filename });
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusyId(null);
    }
  }

  if (attachments.length === 0)
    return <p className="text-sm text-muted-foreground">Belum ada lampiran.</p>;
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 break-all font-medium">{attachment.filename}</span>
            <span className="text-muted-foreground">{formatSize(attachment.size)}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={busyId === attachment.id}
              onClick={() => void download(attachment)}
            >
              Unduh
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Tampilan baca satu catatan Postel: nomor sertifikat, item (menurut BU pembaca), catatan, dan lampiran. */
export function PostelView({ postel, canEdit, onEdit, onRemove, onBack }: PostelViewProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{postel.name}</h1>
        <div className="flex flex-wrap gap-2">
          {onBack ? (
            <Button variant="outline" onClick={onBack}>
              Kembali ke daftar
            </Button>
          ) : null}
          {canEdit ? <Button onClick={onEdit}>Ubah</Button> : null}
          {canEdit ? (
            <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
              Hapus
            </Button>
          ) : null}
        </div>
      </div>

      <Section title="Nomor sertifikat">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor</TableHead>
                <TableHead>Tanggal habis</TableHead>
                <TableHead>Sisa hari</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tautan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {postel.numbers.map((entry) => (
                <NumberRow key={entry.id} entry={entry} />
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Item">
        {postel.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada item yang dapat Anda lihat.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {postel.items.map((item) => (
              <li key={item.id}>{`${item.brand} ${item.model}`}</li>
            ))}
          </ul>
        )}
        {postel.hiddenItemCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            {`${postel.hiddenItemCount} item lain tergabung di sini tetapi tidak terlihat oleh Anda`}
          </p>
        ) : null}
      </Section>

      {postel.note.trim() !== '' ? (
        <Section title="Catatan">
          <p className="text-sm break-words whitespace-pre-wrap">{postel.note}</p>
        </Section>
      ) : null}

      <Section title="Lampiran">
        <AttachmentList attachments={postel.attachments} />
      </Section>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus catatan Postel?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Catatan "${postel.name}" akan dihapus dan semua itemnya dilepas. Lampiran ikut dihapus dan tidak dapat dikembalikan.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false);
                void onRemove();
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
