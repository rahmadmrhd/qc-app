import { QCSN_MAX_BYTES } from '@shared/serial-file';
import { Download, Ellipsis, Trash2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StagingRow } from '../lib/draft';
import {
  exportableRows,
  exportQcsn,
  importQcsn,
  QCSN_EXTENSION,
  type QcsnImport,
} from '../lib/qcsn';

export interface ImportExportBarProps {
  rows: readonly StagingRow[];
  disabled?: boolean;
  /** Hasil membaca berkas (struktur sah); pemanggil yang menambahkan barisnya ke tabel dan melaporkan. */
  onImported: (result: QcsnImport, fileName: string) => void;
  /** Berkas tidak bisa dibaca atau tidak sah sama sekali. */
  onImportFailed: (message: string) => void;
  onExported: (info: { exported: number; skipped: number }) => void;
  /** Ponsel: satu tombol menu (Impor, Ekspor, Kosongkan draft) alih-alih dua tombol; dipakai bar bawah. */
  compact?: boolean;
  /** Hanya `compact`: butir "Kosongkan draft" di menu. */
  onClearDraft?: () => void;
}

const APP_INFO = { name: 'qc-web', version: '1' } as const;

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Berkas tidak bisa dibaca'));
    reader.readAsText(file);
  });
}

function fileStamp(now: Date): string {
  return now.toISOString().slice(0, 19).replace(/[-:T]/g, '');
}

/** Impor dan ekspor berkas `.qcsn` (pertukaran tabel sementara antar perangkat; terpisah dari draf otomatis). */
export function ImportExportBar({
  rows,
  disabled,
  onImported,
  onImportFailed,
  onExported,
  compact = false,
  onClearDraft,
}: ImportExportBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (file.size > QCSN_MAX_BYTES) {
      onImportFailed('Berkas terlalu besar');
      return;
    }
    try {
      const result = await importQcsn(await readFileText(file));
      if (result.fatal !== null) onImportFailed(result.fatal);
      else onImported(result, file.name);
    } catch {
      onImportFailed('Berkas tidak bisa dibaca');
    }
  }

  async function handleExport() {
    const now = new Date();
    const usable = exportableRows(rows);
    const text = await exportQcsn(usable, APP_INFO, now);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `serial-${fileStamp(now)}${QCSN_EXTENSION}`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onExported({ exported: usable.length, skipped: rows.length - usable.length });
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={`${QCSN_EXTENSION},application/json`}
      aria-label="Impor berkas .qcsn"
      className="sr-only"
      tabIndex={-1}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void handleFile(file);
      }}
    />
  );

  if (compact) {
    return (
      <>
        {fileInput}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              color="primary"
              size="icon"
              aria-label="Menu draft"
            >
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuItem
              disabled={disabled ?? false}
              onSelect={() => inputRef.current?.click()}
            >
              <Upload aria-hidden /> Impor .qcsn
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={(disabled ?? false) || rows.length === 0}
              onSelect={() => void handleExport()}
            >
              <Download aria-hidden /> Ekspor .qcsn
            </DropdownMenuItem>
            {onClearDraft && rows.length > 0 ? (
              <DropdownMenuItem
                variant="destructive"
                disabled={disabled ?? false}
                onSelect={onClearDraft}
              >
                <Trash2 aria-hidden /> Kosongkan draft
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {fileInput}
      <Button
        type="button"
        variant="outline"
        color="primary"
        size="sm"
        disabled={disabled ?? false}
        onClick={() => inputRef.current?.click()}
      >
        <Upload aria-hidden /> Impor .qcsn
      </Button>
      <Button
        type="button"
        variant="outline"
        color="primary"
        size="sm"
        disabled={(disabled ?? false) || rows.length === 0}
        onClick={() => void handleExport()}
      >
        <Download aria-hidden /> Ekspor .qcsn
      </Button>
    </div>
  );
}
