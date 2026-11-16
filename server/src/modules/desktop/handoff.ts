import { encodeBytes } from '@server/core/base64url';
import { DbError } from '@server/core/db';
import { type Env, nowOf } from '@server/core/env';
import { signValue, verifyValue } from '@server/core/session';
import { loadUserContext } from '@server/modules/access/context';
import { hasLevel } from '@shared/permissions';

/**
 * Serah-terima peramban -> aplikasi desktop (keputusan pemilik 2026-11-16): pengguna yang sudah login di web
 * menekan Country Lock, server menerbitkan TIKET (`desktop.handoff`, sesi cookie + izin `countrylock`), tiket ada di
 * tautan `qc://country-lock?handoff=...`, dan desktop menukarnya jadi token Bearer di `POST /auth/desktop/handoff`.
 *
 * Tiket adalah rahasia pembawa selama berlaku (berbeda dari login PKCE, yang kodenya terikat `verifier` yang tak
 * pernah ada di tautan), jadi risikonya DITERIMA pemilik dan dikurangi dengan: berlaku 60 detik, sekali pakai (penanda
 * `rate_limits`), akun dan izin diperiksa ulang saat ditukar, dan konfirmasi di aplikasi desktop bila akunnya berbeda.
 */

/** Tiket berlaku 60 detik: jauh di bawah 10 menit pembersihan penanda `rate_limits` (kalau tidak, tiket dapat diputar ulang). */
export const HANDOFF_TICKET_TTL_MS = 60 * 1000;
/** Tiket = base64url(JSON) + "." + HMAC; jauh di bawah ini. */
export const HANDOFF_TICKET_MAX_LENGTH = 1024;
/** Pesan seragam semua penolakan penukaran tiket; penyebabnya hanya di log server. */
export const HANDOFF_INVALID_MESSAGE = 'Tiket tidak valid atau kedaluwarsa';

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Tiket terikat ke `email` pemanggil (sudah lolos sesi dan izin di kernel REST). */
export async function issueHandoffTicket(env: Env, email: string): Promise<string> {
  return signValue(env, {
    typ: 'dhandoff',
    email,
    nonce: encodeBytes(crypto.getRandomValues(new Uint8Array(16))),
    exp: nowOf(env) + HANDOFF_TICKET_TTL_MS,
  });
}

/**
 * Menukar tiket: tanda tangan dan masa berlaku, akun masih aktif DAN masih berizin `countrylock: view` (pencabutan
 * berlaku seketika), lalu penanda `rate_limits` (`dhandoff:<sha256 tiket>`) lewat `INSERT` yang gagal duplikat bila
 * tiket sudah dipakai. Penanda ditulis paling akhir, jadi penolakan lain tidak menghabiskan tiket. `null` untuk semua
 * penolakan; alasannya hanya di log server (tanpa tiket).
 */
export async function consumeHandoffTicket(
  env: Env,
  ticket: string,
  now: number,
): Promise<{ email: string } | null> {
  const reject = (reason: string): null => {
    console.warn(`Penukaran tiket serah-terima desktop ditolak: ${reason}`);
    return null;
  };
  const payload = (await verifyValue(env, ticket)) as Record<string, unknown> | null;
  if (payload?.typ !== 'dhandoff') return reject('tiket tidak sah');
  if (typeof payload.exp !== 'number' || payload.exp <= now) return reject('tiket kedaluwarsa');
  const { email } = payload;
  if (typeof email !== 'string' || email === '') return reject('isi tiket tidak lengkap');
  const user = await loadUserContext(env, email);
  if (!user) return reject('akun tidak aktif');
  if (!hasLevel(user.permissions.countrylock, 'view')) return reject('izin dicabut');

  const marker = `dhandoff:${await sha256Hex(ticket)}`;
  try {
    await env.DB.prepare('INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?)')
      .bind(marker, now)
      .run();
  } catch (error) {
    if (error instanceof DbError && error.kind === 'duplicate') {
      return reject('tiket sudah dipakai');
    }
    throw error;
  }
  return { email: user.email };
}
