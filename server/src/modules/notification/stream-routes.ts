import { nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { bearerTokenOf, sessionOfCredential } from '@server/core/router';
import { problemResponse, toProblem } from '@server/http/problem';
import { type AppBindings, newRequestId } from '@server/http/security';
import { loadUserContext } from '@server/modules/access/context';
import { Hono } from 'hono/tiny';
import { openNotificationStream } from './stream-hub';

/**
 * `GET /api/v1/notifications/stream` (dipasang di `app.ts` SEBELUM kernel REST): aliran SSE notifikasi untuk aplikasi
 * desktop (Web Push tidak ada di Electron; keputusan pemilik 2026-11-16). Sengaja di luar `API_ROUTES`: kernel REST
 * mengembalikan satu respons JSON, sedangkan ini respons berumur panjang. Aturan yang sama dengan kernel: sesi
 * diperiksa SEBELUM apa pun, galat = problem+json, `no-store`. Hanya token Bearer desktop (`typ: 'desktop'`) yang
 * diterima: cookie web tidak (peramban memakai Web Push), jadi tak ada jalur CSRF atau cookie ke rute ini.
 */
export const notificationStreamApp = new Hono<AppBindings>();

notificationStreamApp.get('/', async (c) => {
  const requestId = newRequestId();
  const fail = (code: 'UNAUTHENTICATED' | 'UNAVAILABLE', message: string) =>
    problemResponse(toProblem(appError(code, message), requestId));

  const bearer = bearerTokenOf(c.req.raw);
  if (bearer === null) return fail('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir');
  const session = await sessionOfCredential(c.env, { bearer }, nowOf(c.env));
  if (!session) return fail('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir');
  const user = await loadUserContext(c.env, session.email);
  if (!user) return fail('UNAUTHENTICATED', 'Akun tidak aktif atau tidak terdaftar');

  const opened = openNotificationStream(c.env, user.email, c.req.header('last-event-id'));
  if (!opened.ok) return fail('UNAVAILABLE', 'Server sedang penuh, coba lagi sebentar');
  return opened.response;
});
