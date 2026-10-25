import type { RouteTable } from '@worker/core/router';
import { readObject } from '@worker/core/validate';
import { requestSheetsExport, validateExportSheets } from './export-sheets';
import { getJobDto } from './service';

type JobsMethod = 'jobs.get' | 'exports.sheets';

export function jobsRoutes(): Pick<RouteTable, JobsMethod> {
  return {
    /** Cukup login; pembuat job atau pengguna dengan izin lihat modul `qrcode` (pemeriksaan di service). */
    'jobs.get': {
      validate: (raw) => {
        const reader = readObject(raw);
        const id = reader.str('id', { required: true, max: 100 });
        reader.done();
        return { id };
      },
      handler: (input, ctx) => getJobDto(ctx.env, input, ctx.user),
    },
    /** Hanya administrator: modul `access` level kelola (level tertinggi yang ada; global, bukan per lokasi). */
    'exports.sheets': {
      permission: { module: 'access', level: 'manage' },
      validate: validateExportSheets,
      handler: (input, ctx) => requestSheetsExport(ctx.env, input, ctx.user),
    },
  };
}
