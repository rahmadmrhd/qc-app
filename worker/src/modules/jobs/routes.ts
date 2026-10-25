import type { RouteTable } from '@worker/core/router';
import { readObject } from '@worker/core/validate';
import { getJobDto } from './service';

/** `jobs.get`: cukup login; pembuat job atau pengguna dengan izin lihat modul `qrcode` (pemeriksaan di service). */
export function jobsRoutes(): Pick<RouteTable, 'jobs.get'> {
  return {
    'jobs.get': {
      validate: (raw) => {
        const reader = readObject(raw);
        const id = reader.str('id', { required: true, max: 100 });
        reader.done();
        return { id };
      },
      handler: (input, ctx) => getJobDto(ctx.env, input, ctx.user),
    },
  };
}
