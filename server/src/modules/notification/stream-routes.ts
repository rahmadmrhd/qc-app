import { nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { credentialOf, sessionOfCredential } from '@server/core/router';
import { SESSION_COOKIE } from '@server/core/session';
import { problemResponse, toProblem } from '@server/http/problem';
import { type AppBindings, newRequestId } from '@server/http/security';
import { loadUserContext } from '@server/modules/access/context';
import { Hono } from 'hono/tiny';
import { openNotificationStream, type StreamKind } from './stream-hub';

/**
 * `GET /api/v1/notifications/stream` (dipasang di `app.ts` SEBELUM kernel REST): aliran SSE notifikasi untuk aplikasi
 * desktop (Web Push tidak ada di Electron; keputusan pemilik 2026-11-16) dan untuk lonceng web yang terbuka (keputusan
 * pemilik 2026-11-16: satu hub untuk keduanya). Sengaja di luar `API_ROUTES`: kernel REST mengembalikan satu respons
 * JSON, sedangkan ini respons berumur panjang. Aturan yang sama dengan kernel: sesi diperiksa SEBELUM apa pun, galat =
 * problem+json, `no-store`.
 *
 * Kredensial mengikuti `credentialOf` seperti kernel: bila header `Authorization` ada, Bearer SAJA yang dipakai
 * (token desktop `typ: 'desktop'`; salah = 401 tanpa jatuh ke cookie) dan koneksi berjenis `desktop`; bila tidak ada,
 * cookie sesi web dan koneksi berjenis `web`. Rute ini hanya MEMBACA dan tak punya efek samping, jadi jalur cookie tak
 * membuka celah CSRF (peramban lintas-situs tak dapat membaca responsnya tanpa CORS).
 */
export const notificationStreamApp = new Hono<AppBindings>();

notificationStreamApp.get('/', async (c) => {
  const requestId = newRequestId();
  const fail = (code: 'UNAUTHENTICATED' | 'UNAVAILABLE', message: string) =>
    problemResponse(toProblem(appError(code, message), requestId));

  const kind: StreamKind = c.req.raw.headers.has('authorization') ? 'desktop' : 'web';
  const session = await sessionOfCredential(
    c.env,
    credentialOf(c.req.raw, SESSION_COOKIE),
    nowOf(c.env),
  );
  if (!session) return fail('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir');
  const user = await loadUserContext(c.env, session.email);
  if (!user) return fail('UNAUTHENTICATED', 'Akun tidak aktif atau tidak terdaftar');

  const opened = openNotificationStream(
    c.env,
    user.email,
    c.req.header('last-event-id'),
    session.exp,
    kind,
  );
  if (!opened.ok) return fail('UNAVAILABLE', 'Server sedang penuh, coba lagi sebentar');
  return opened.response;
});
