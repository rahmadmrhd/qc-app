import type { ImportClResult } from '@shared/contract';
import { CL_TEXT_MAX_BYTES } from '@shared/countrylock-bundle';
import { X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { formatBytes } from '@/components/file-dialog/accept';
import { FilePicker } from '@/components/file-dialog/file-picker';
import { FormPage } from '@/components/page/form-page';
import { FormSection } from '@/components/page/form-section';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { parseLegacyConfig, validateNetwork, withNetwork } from '../lib/parse-legacy-config';
import { mergeImportResults, splitImport } from '../lib/split-import';
import { useRunImport } from '../queries';

const FORM_ID = 'cl-import-form';

interface ScriptFile {
  path: string;
  text: string;
}

/** Satu kali memilih skrip (satu folder lama); pilihan berikutnya menjadi kelompok baru, bukan mengganti. */
interface ScriptGroup {
  id: number;
  files: ScriptFile[];
}

/** `config.QC` lama berukuran beberapa KB; batas ini hanya pelindung terhadap salah pilih berkas. */
const CONFIG_MAX_BYTES = 512 * 1024;

function tooBigMessage(name: string, size: number, limit: number): string {
  return `${name} (${formatBytes(size)}) melebihi batas ${formatBytes(limit)}; dilewati tanpa dibaca`;
}

interface Message {
  path?: string | undefined;
  text: string;
}

/** Daftar pesan tanpa id; urutannya tak pernah berubah selama satu hasil baca. */
function MessageList({ items }: { items: readonly Message[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: teks pesan tak unik dan daftar statis per hasil baca.
        <li key={index}>
          {item.path ? <code className="mr-1 text-xs">{item.path}</code> : null}
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

export interface ImportPageProps {
  onCancel: () => void;
}

/**
 * Impor sekali pakai dari aplikasi Country Lock lama (`FormPage`): admin memilih `config.QC` dan berkas skrip lama; web
 * memetakannya ke draf (pengaturan, skrip, firmware), menampilkan masalah sebelum mengirim, lalu mengirim bertahap
 * (`splitImport`: batas ukuran server). Impor idempoten: mengulang tidak menimpa berkas yang isinya sudah ada.
 */
export function ImportPage({ onCancel }: ImportPageProps) {
  const runImport = useRunImport();
  const [configText, setConfigText] = useState<string | null>(null);
  const [configName, setConfigName] = useState('');
  const [groups, setGroups] = useState<ScriptGroup[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const nextGroupId = useRef(1);
  const scripts = useMemo(() => groups.flatMap((group) => group.files), [groups]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<ImportClResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const parsed = useMemo(
    () => (configText === null ? null : parseLegacyConfig(configText, scripts)),
    [configText, scripts],
  );
  const request = parsed?.request ?? null;
  // Jaringan komputer tidak ada di config.QC dan tidak ditebak: admin wajib mengisinya (keputusan pemilik 2026-11-28).
  const [computerIp, setComputerIp] = useState('');
  const [prefix, setPrefix] = useState('');
  const networkCheck = validateNetwork({ computerIp, prefix });

  const pickConfig = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setReport(null);
    setFailure(null);
    if (file.size > CONFIG_MAX_BYTES) {
      setRejected((previous) => [
        ...previous,
        tooBigMessage('config.QC', file.size, CONFIG_MAX_BYTES),
      ]);
      return;
    }
    setConfigName(file.name);
    setConfigText(await file.text());
  };
  const pickScripts = async (files: File[]) => {
    setReport(null);
    setFailure(null);
    const accepted = files.filter((file) => file.size <= CL_TEXT_MAX_BYTES);
    setRejected(
      files
        .filter((file) => file.size > CL_TEXT_MAX_BYTES)
        .map((file) => tooBigMessage(file.name, file.size, CL_TEXT_MAX_BYTES)),
    );
    if (accepted.length === 0) return;
    const read = await Promise.all(
      accepted.map(async (file) => ({ path: file.name, text: await file.text() })),
    );
    // Pilihan berikutnya MENAMBAH: dialog berkas hanya dapat memilih satu folder sekali jalan.
    setGroups((previous) => [...previous, { id: nextGroupId.current++, files: read }]);
  };
  const removeFile = (groupId: number, path: string) =>
    setGroups((previous) =>
      previous
        .map((group) =>
          group.id === groupId
            ? { ...group, files: group.files.filter((file) => file.path !== path) }
            : group,
        )
        .filter((group) => group.files.length > 0),
    );
  const removeGroup = (groupId: number) =>
    setGroups((previous) => previous.filter((group) => group.id !== groupId));

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const script of request?.scripts ?? []) {
      const folder = script.path.split('/')[0] ?? '';
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [request]);

  const submit = async () => {
    if (!request || !networkCheck.ok || busy) return;
    const parts = splitImport(withNetwork(request, networkCheck.network));
    setBusy(true);
    setFailure(null);
    setReport(null);
    const results: ImportClResult[] = [];
    try {
      for (const [index, part] of parts.entries()) {
        setProgress(`Mengimpor bagian ${index + 1} dari ${parts.length}…`);
        results.push(await runImport.mutateAsync(part));
      }
      setReport(mergeImportResults(results));
    } catch (error) {
      const done = results.length;
      setFailure(
        `${describeError(error)}${
          done > 0
            ? ` (${done} dari ${parts.length} bagian sudah masuk; impor aman diulang, berkas yang sama dilewati)`
            : ''
        }`,
      );
      if (done > 0) setReport(mergeImportResults(results));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <FormPage
      formId={FORM_ID}
      title="Impor dari aplikasi lama"
      onCancel={onCancel}
      submitting={busy}
      busyText="Mengimpor…"
      submitLabel="Impor"
      submitDisabled={request === null || !networkCheck.ok || report !== null}
    >
      <form
        id={FORM_ID}
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Alert color="info">
          <AlertDescription>
            Impor sekali pakai: membuat draf (pengaturan router, skrip, dan firmware) dari{' '}
            <code>config.QC</code> dan berkas skrip aplikasi lama. Sesudahnya periksa Pengaturan
            Router lalu terbitkan bundel.
          </AlertDescription>
        </Alert>

        <FormSection title="1. Berkas config.QC" columns={1}>
          <div className="flex flex-wrap items-center gap-3">
            <FilePicker anyType onFiles={(files) => void pickConfig(files)} accept={[]}>
              Pilih config.QC
            </FilePicker>
            <span className="text-sm text-muted-foreground">
              {configName === '' ? 'Belum dipilih' : configName}
            </span>
          </div>
        </FormSection>

        <FormSection title="2. Berkas skrip" columns={1}>
          <div className="flex flex-wrap items-center gap-3">
            <FilePicker anyType multiple onFiles={(files) => void pickScripts(files)} accept={[]}>
              Pilih skrip (boleh banyak)
            </FilePicker>
            <span className="text-sm text-muted-foreground">
              {scripts.length === 0 ? 'Belum dipilih' : `${scripts.length} berkas dipilih`}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Dialog berkas hanya dapat memilih satu folder sekali jalan. Pilih berkas folder pertama
            (mis. MIKROTIK), lalu pilih lagi untuk folder berikutnya (mis. UBIQUITI): pilihan baru
            MENAMBAH, tidak mengganti. Berkas yang tidak dirujuk firmware di config.QC dilewati.
          </p>
          {groups.map((group, index) => (
            <div key={group.id} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{`Pilihan ${index + 1}`}</span>
                <Button
                  type="button"
                  variant="ghost"
                  color="destructive"
                  size="sm"
                  onClick={() => removeGroup(group.id)}
                >
                  {`Hapus Pilihan ${index + 1}`}
                </Button>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {group.files.map((file) => (
                  <li
                    key={file.path}
                    className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
                  >
                    {file.path}
                    <button
                      type="button"
                      aria-label={`Hapus skrip ${file.path}`}
                      className="touch:size-11 inline-flex size-5 items-center justify-center rounded hover:bg-background"
                      onClick={() => removeFile(group.id, file.path)}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </FormSection>

        <FormSection title="3. Jaringan komputer" columns={2}>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Alamat komputer operator tidak tercatat di config.QC lama, jadi tidak ada nilai awal:
            isi sendiri (alamat IPv4 komputer di segmen yang sama dengan router jump, dan panjang
            prefix jaringannya). Dapat diubah lagi di Pengaturan Router.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="cl-import-computer-ip" required>
              IP komputer
            </Label>
            <Input
              id="cl-import-computer-ip"
              aria-required="true"
              value={computerIp}
              autoComplete="off"
              inputMode="decimal"
              aria-invalid={computerIp !== '' && !networkCheck.ok && networkCheck.ipError !== null}
              onChange={(event) => setComputerIp(event.target.value)}
            />
            {computerIp !== '' && !networkCheck.ok && networkCheck.ipError ? (
              <p className="text-xs text-destructive-text">{networkCheck.ipError}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-import-prefix" required>
              Panjang prefix jaringan
            </Label>
            <Input
              id="cl-import-prefix"
              aria-required="true"
              value={prefix}
              autoComplete="off"
              inputMode="numeric"
              aria-invalid={prefix !== '' && !networkCheck.ok && networkCheck.prefixError !== null}
              onChange={(event) => setPrefix(event.target.value)}
            />
            {prefix !== '' && !networkCheck.ok && networkCheck.prefixError ? (
              <p className="text-xs text-destructive-text">{networkCheck.prefixError}</p>
            ) : null}
          </div>
        </FormSection>

        {rejected.length > 0 ? (
          <Alert color="warning">
            <AlertDescription>
              <MessageList items={rejected.map((text) => ({ text }))} />
            </AlertDescription>
          </Alert>
        ) : null}

        {parsed ? (
          <FormSection title="Hasil pembacaan" columns={1}>
            {request ? (
              <p className="text-sm">
                {request.firmwares.length} firmware, {request.scripts.length} skrip siap diimpor.
              </p>
            ) : null}
            {folderCounts.length > 1 ? (
              <ul className="text-xs text-muted-foreground">
                {folderCounts.map(([folder, count]) => (
                  <li key={folder}>{`${folder}: ${count} skrip`}</li>
                ))}
              </ul>
            ) : null}
            {parsed.problems.length > 0 ? (
              <Alert color={request ? 'warning' : 'destructive'}>
                <AlertDescription>
                  <MessageList items={parsed.problems.map((text) => ({ text }))} />
                </AlertDescription>
              </Alert>
            ) : null}
            {parsed.notes.length > 0 ? (
              <Alert color="info">
                <AlertDescription>
                  <MessageList items={parsed.notes.map((text) => ({ text }))} />
                </AlertDescription>
              </Alert>
            ) : null}
          </FormSection>
        ) : null}

        {progress !== null ? <p className="text-sm text-muted-foreground">{progress}</p> : null}
        {failure !== null ? (
          <Alert color="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        {report ? (
          <FormSection title="Laporan impor" columns={1}>
            <Alert color="success">
              <AlertDescription>
                <p>
                  {report.filesCreated} berkas dibuat, {report.filesSkipped} dilewati,{' '}
                  {report.firmwaresLinked} firmware dikaitkan.
                </p>
              </AlertDescription>
            </Alert>
            {report.issues.length > 0 ? (
              <Alert color="warning">
                <AlertDescription>
                  <MessageList
                    items={report.issues.map((issue) => ({
                      path: issue.path,
                      text: issue.message,
                    }))}
                  />
                </AlertDescription>
              </Alert>
            ) : null}
          </FormSection>
        ) : null}
      </form>
    </FormPage>
  );
}
