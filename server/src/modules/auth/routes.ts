import { nowOf } from '@server/core/env';
import {
  DESKTOP_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  signDesktopToken,
  signSessionToken,
} from '@server/core/session';
import { readTextLimited } from '@server/http/body';
import { isLoopbackAddress } from '@server/http/proxy';
import {
  type AppBindings,
  cookieSecure,
  DESKTOP_COOKIE,
  errorEnvelope,
  isLocalHostname,
  OAUTH_COOKIE,
  SESSION_COOKIE,
} from '@server/http/security';
import { loadUserContext } from '@server/modules/access/context';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono/tiny';
import {
  consumeDesktopCode,
  DESKTOP_CODE_INVALID_MESSAGE,
  DESKTOP_CODE_MAX_LENGTH,
  DESKTOP_START_TTL_MS,
  isDesktopChallenge,
  isDesktopState,
  isDesktopVerifier,
  issueDesktopCode,
  readDesktopStart,
  signDesktopStart,
} from './desktop';
import { createLogin, exchangeCodeForEmail, OAUTH_STATE_TTL_MS, verifyLoginState } from './oauth';

/** Rute `/auth/*` (dipasang di `app.route('/auth', authApp)`). */
export const authApp = new Hono<AppBindings>();

authApp.get('/login', async (c) => {
  const { url, stateCookie } = await createLogin(c.env, c.req.raw);
  setCookie(c, OAUTH_COOKIE, stateCookie, {
    httpOnly: true,
    secure: cookieSecure(c.env),
    sameSite: 'Lax',
    path: '/auth',
    maxAge: OAUTH_STATE_TTL_MS / 1000,
  });
  return c.redirect(url, 302);
});

/**
 * Awal login aplikasi desktop (dibuka di peramban sistem): `challenge` = base64url(SHA-256(verifier)) dan `state`
 * dari aplikasi. Keduanya diikat ke peramban ini lewat cookie `qc_desktop`, lalu alur login Google biasa berjalan.
 */
authApp.get('/desktop/start', async (c) => {
  const challenge = c.req.query('challenge');
  const state = c.req.query('state');
  if (!isDesktopChallenge(challenge) || !isDesktopState(state)) {
    return c.json(errorEnvelope('VALIDATION', 'Parameter login desktop tidak valid'), 400);
  }
  setCookie(c, DESKTOP_COOKIE, await signDesktopStart(c.env, { challenge, state }), {
    httpOnly: true,
    secure: cookieSecure(c.env),
    sameSite: 'Lax',
    path: '/auth',
    maxAge: DESKTOP_START_TTL_MS / 1000,
  });
  return c.redirect('/auth/login', 302);
});

authApp.get('/callback', async (c) => {
  const desktopCookie = getCookie(c, DESKTOP_COOKIE);
  const stateOk = await verifyLoginState(c.env, getCookie(c, OAUTH_COOKIE), c.req.query('state'));
  // Cookie state sekali pakai: selalu dihapus, berhasil maupun gagal.
  deleteCookie(c, OAUTH_COOKIE, { path: '/auth', secure: cookieSecure(c.env) });
  if (desktopCookie !== undefined) {
    deleteCookie(c, DESKTOP_COOKIE, { path: '/auth', secure: cookieSecure(c.env) });
  }
  if (!stateOk) {
    return c.json(
      errorEnvelope('UNAUTHENTICATED', 'Login tidak valid atau sudah kedaluwarsa'),
      400,
    );
  }
  const code = c.req.query('code');
  if (c.req.query('error') || !code) return c.redirect('/?authError=LOGIN_FAILED', 302);

  const result = await exchangeCodeForEmail(c.env, c.req.raw, code);
  if (!result.ok) {
    console.error(`Login gagal: ${result.reason}`);
    return c.redirect('/?authError=LOGIN_FAILED', 302);
  }
  if (!(await loadUserContext(c.env, result.email))) {
    return c.redirect('/?authError=NOT_WHITELISTED', 302);
  }
  // Login yang dimulai aplikasi desktop: kirim kode sekali pakai ke `qc://auth`, JANGAN pasang cookie sesi web.
  const desktop = await readDesktopStart(c.env, desktopCookie);
  if (desktop) {
    const desktopCode = await issueDesktopCode(c.env, result.email, desktop.challenge);
    return c.redirect(`qc://auth?code=${desktopCode}&state=${desktop.state}`, 302);
  }
  setCookie(c, SESSION_COOKIE, await signSessionToken(c.env, result.email, nowOf(c.env)), {
    httpOnly: true,
    secure: cookieSecure(c.env),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.redirect('/', 302);
});

/**
 * Penukaran kode login desktop dengan token Bearer. Semua penolakan memakai pesan yang sama (400 untuk badan yang
 * salah bentuk, 401 untuk kode/verifier tidak sah, kedaluwarsa, terpakai, atau akun nonaktif); penyebabnya hanya
 * di log server. Dijaga `csrfGuard` seperti semua POST `/auth/*` (klien mengirim `X-Requested-With: qc`).
 */
authApp.post('/desktop/token', async (c) => {
  c.header('Cache-Control', 'no-store');
  const invalid = (status: 400 | 401) =>
    c.json(errorEnvelope('UNAUTHENTICATED', DESKTOP_CODE_INVALID_MESSAGE), status);
  let body: unknown;
  try {
    const text = await readTextLimited(c.req.raw, 4096);
    if (text === undefined) return invalid(400);
    body = JSON.parse(text);
  } catch {
    return invalid(400);
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const { code, verifier } = record;
  if (
    typeof code !== 'string' ||
    code === '' ||
    code.length > DESKTOP_CODE_MAX_LENGTH ||
    !isDesktopVerifier(verifier)
  ) {
    return invalid(400);
  }
  const now = nowOf(c.env);
  const result = await consumeDesktopCode(c.env, code, verifier, now);
  if (!result) return invalid(401);
  return c.json({
    token: await signDesktopToken(c.env, result.email, now),
    expiresAt: now + DESKTOP_TOKEN_TTL_MS,
    email: result.email,
  });
});

authApp.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: cookieSecure(c.env) });
  return c.json({ ok: true });
});

/**
 * Login pengembangan: aktif HANYA bila `DEV_LOGIN_EMAIL` ada (diisi lewat `server/.env`, tidak pernah di
 * produksi) DAN host permintaan localhost/127.0.0.1. Selain itu 404 seolah rute tak ada.
 * Menerbitkan cookie sesi untuk email itu bila terdaftar/aktif (atau super admin).
 */
authApp.get('/dev-login', async (c) => {
  const email = c.env.DEV_LOGIN_EMAIL?.trim();
  // Hanya dari mesin yang sama: peer TCP loopback DAN tanpa CF-Connecting-IP (bukan lewat reverse proxy), serta Host
  // lokal. Host saja tidak cukup: header itu dapat dikirim siapa pun yang mencapai proses ini.
  const direct =
    isLoopbackAddress(c.env.peerAddress ?? '') && c.req.header('cf-connecting-ip') === undefined;
  if (!email || !direct || !isLocalHostname(new URL(c.req.url).hostname)) return c.notFound();
  if (!(await loadUserContext(c.env, email))) {
    return c.json(
      errorEnvelope('UNAUTHENTICATED', 'DEV_LOGIN_EMAIL belum terdaftar; jalankan bun run db:seed'),
      404,
    );
  }
  setCookie(c, SESSION_COOKIE, await signSessionToken(c.env, email, nowOf(c.env)), {
    httpOnly: true,
    secure: cookieSecure(c.env),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.redirect('/', 302);
});
