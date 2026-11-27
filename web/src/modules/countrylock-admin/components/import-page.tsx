import type { ImportClResult } from '@shared/contract';
import { useMemo, useState } from 'react';
import { FilePicker } from '@/components/file-dialog/file-picker';
import { FormPage } from '@/components/page/form-page';
import { FormSection } from '@/components/page/form-section';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { describeError } from '@/lib/api/describe-error';
import { parseLegacyConfig } from '../lib/parse-legacy-config';
import { mergeImportResults, splitImport } from '../lib/split-import';
import { useRunImport } from '../queries';

const FORM_ID = 'cl-import-form';

interface ScriptFile {
  path: string;
  text: string;
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
  const [scripts, setScripts] = useState<ScriptFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<ImportClResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const parsed = useMemo(
    () => (configText === null ? null : parseLegacyConfig(configText, scripts)),
    [configText, scripts],
  );
  const request = parsed?.request ?? null;

  const pickConfig = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setReport(null);
    setFailure(null);
    setConfigName(file.name);
    setConfigText(await file.text());
  };
  const pickScripts = async (files: File[]) => {
    setReport(null);
    setFailure(null);
    const next = await Promise.all(
      files.map(async (file) => ({ path: file.name, text: await file.text() })),
    );
    setScripts(next);
  };

  const submit = async () => {
    if (!request || busy) return;
    const parts = splitImport(request);
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
      submitDisabled={request === null || report !== null}
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
            Pilih semua berkas dari folder skrip lama (mis. MIKROTIK dan UBIQUITI). Berkas yang
            tidak dirujuk firmware di config.QC dilewati.
          </p>
        </FormSection>

        {parsed ? (
          <FormSection title="Hasil pembacaan" columns={1}>
            {request ? (
              <p className="text-sm">
                {request.firmwares.length} firmware, {request.scripts.length} skrip siap diimpor.
              </p>
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
