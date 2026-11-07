import { writeAudit } from '@server/core/audit';
import type { ActorRef } from '@server/core/context';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { readObject } from '@server/core/validate';
import type { ExportSheetsInput, ExportSheetsJobDto } from '@shared/rpc';
import { findActiveJob } from './repo';
import { enqueueJob } from './service';
import { EXPORT_TABLES } from './sheets-export';

/**
 * Pemicu manual ekspor database -> Spreadsheet (Spek 8.3). Hanya tabel dalam `EXPORT_TABLES` yang boleh diminta;
 * tabel operasional/rahasia (jobs, counters, rate_limits, settings, d1_migrations, job_blobs) tidak pernah.
 */
export function validateExportSheets(raw: unknown): ExportSheetsInput {
  if (raw === null || raw === undefined) return {};
  const reader = readObject(raw);
  const value = reader.raw('tables');
  const allowed = EXPORT_TABLES.map((spec) => spec.table);
  let tables: string[] | undefined;
  if (value !== undefined && value !== null) {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((name) => typeof name !== 'string')
    ) {
      reader.fail(
        'tables',
        'Harus berupa daftar nama tabel (minimal satu), atau kosongkan untuk semua',
      );
    } else {
      const unknown = (value as string[]).filter((name) => !allowed.includes(name));
      if (unknown.length > 0)
        reader.fail(
          'tables',
          `Tabel tidak dikenal atau tidak boleh diekspor: ${unknown.join(', ')}`,
        );
      else tables = [...new Set(value as string[])];
    }
  }
  reader.done();
  return tables ? { tables } : {};
}

/** Urutan kanonis daftar tabel (urutan EXPORT_TABLES) agar permintaan sama dikenali. */
function canonicalTables(input: ExportSheetsInput): string[] {
  const wanted = input.tables ?? EXPORT_TABLES.map((spec) => spec.table);
  return EXPORT_TABLES.map((spec) => spec.table).filter((name) => wanted.includes(name));
}

/**
 * `exports.sheets`: antre job `sheets_export`. Tidak ada dua ekspor serentak: bila sudah ada job aktif dengan daftar
 * tabel yang sama, kembalikan jobId-nya; daftar berbeda -> CONFLICT. Audit `export.sheets` hanya untuk job baru.
 */
export async function requestSheetsExport(
  env: Env,
  input: ExportSheetsInput,
  actor: ActorRef,
): Promise<ExportSheetsJobDto> {
  const tables = canonicalTables(input);
  const active = await findActiveJob(env, 'sheets_export');
  if (active) {
    const running = (JSON.parse(active.input || '{}') as { tables?: string[] }).tables ?? [];
    if (running.join(',') === tables.join(',')) return { jobId: active.id };
    throw appError('CONFLICT', 'Ekspor Spreadsheet lain sedang berjalan; tunggu sampai selesai');
  }
  const jobId = await enqueueJob(env, 'sheets_export', { tables }, actor.email);
  await env.DB.batch([
    writeAudit(env.DB, {
      ts: nowIso(env),
      actor: actor.email,
      action: 'export.sheets',
      target: 'Spreadsheet',
      before: null,
      after: { jobId, tables: tables.join(',') },
    }),
  ]);
  return { jobId };
}
