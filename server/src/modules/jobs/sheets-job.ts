import { getBridge, viaBridge } from '@server/core/bridge-client';
import type { JobHandler, StepOutcome } from './consumer';
import {
  EXPORT_TABLES,
  type ExportTableSpec,
  exportTableSpec,
  readExportPage,
} from './sheets-export';

/** Halaman baris database per langkah job. */
export const SHEETS_PAGES_PER_STEP = 4;

interface SheetsInput {
  /** Nama tabel; kosong = semua tabel yang diekspor. */
  tables?: string[];
}

interface SheetsState {
  /** Indeks tabel yang sedang diekspor. */
  table?: number;
  /** Kunci terakhir halaman sebelumnya (kursor keyset); null = awal tabel. */
  after?: string | null;
}

function tablesOf(input: SheetsInput): ExportTableSpec[] {
  const wanted = input.tables ?? [];
  if (wanted.length === 0) return [...EXPORT_TABLES];
  return wanted.flatMap((name) => {
    const spec = exportTableSpec(name);
    return spec ? [spec] : [];
  });
}

/**
 * Ekspor database -> Spreadsheet (`export_<tabel>`). Tiap langkah membaca beberapa halaman berindeks dan mengirim
 * potongan ke jembatan. Potongan pertama tiap tabel `replace` (menimpa), sehingga mengulang job menyembuhkan
 * sheet; potongan `append` yang terkirim ulang saat crash di jendela sempit dapat menggandakan baris sampai
 * ekspor berikutnya (sheet laporan hanya-baca, bukan sumber data).
 */
export const sheetsExportHandler: JobHandler = {
  async run(ctx): Promise<StepOutcome> {
    const input = JSON.parse(ctx.job.input || '{}') as SheetsInput;
    const tables = tablesOf(input);
    const state = ctx.state as SheetsState;
    let index = state.table ?? 0;
    let after = state.after ?? null;
    const bridge = getBridge(ctx.env);
    for (let page = 0; page < SHEETS_PAGES_PER_STEP && index < tables.length; page++) {
      const spec = tables[index] as ExportTableSpec;
      const read = await readExportPage(ctx.env.DB, spec, after, after === null);
      for (const chunk of read.chunks) await viaBridge(() => bridge.sheetsExport(chunk));
      if (read.nextKey === null) {
        index += 1;
        after = null;
      } else {
        after = read.nextKey;
      }
    }
    state.table = index;
    state.after = after;
    if (index >= tables.length) {
      return { progress: 100, done: { result: JSON.stringify({ tables: tables.length }) } };
    }
    return { progress: Math.floor((index / tables.length) * 100) };
  },
};
