import { appError } from '@server/core/errors';
import type { RouteTable } from '@server/core/router';
import { issueHandoffTicket } from './handoff';

type DesktopMethod = 'desktop.handoff';

function validateNoInput(raw: unknown): Record<string, never> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) return {};
  throw appError('VALIDATION', 'Method ini tidak menerima input');
}

/**
 * Tiket serah-terima ke aplikasi desktop: butuh sesi web dan izin global `countrylock: view` (diperiksa kernel REST).
 * Penukaran tiketnya di `POST /auth/desktop/handoff` (tanpa sesi; `modules/auth/routes.ts`).
 */
export function desktopApiRoutes(): Pick<RouteTable, DesktopMethod> {
  return {
    'desktop.handoff': {
      permission: { module: 'countrylock', level: 'view' },
      validate: validateNoInput,
      handler: async (_input, ctx) => ({
        ticket: await issueHandoffTicket(ctx.env, ctx.user.email),
        email: ctx.user.email,
      }),
    },
  };
}
