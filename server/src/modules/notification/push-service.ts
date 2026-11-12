import { createHash } from 'node:crypto';
import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import type { UserContext } from '@server/modules/access/context';
import type {
  PushConfigDto,
  PushPermissionInput,
  PushPreferenceInput,
  PushSubscribeInput,
  PushUnsubscribeInput,
  PushUserState,
  PushUserStatusDto,
} from '@shared/contract';
import { PUSH_FAILING_THRESHOLD } from './push';
import { PUSH_LIMITS } from './push-validate';

/**
 * Langganan, preferensi, dan status push per pengguna. Satu langganan melekat pada peramban: kunci
 * `(endpoint_hash, recipient)` membuat tiap pengguna di perangkat yang sama memiliki baris sendiri, sehingga
 * `subscribe` oleh pengguna lain TIDAK mengambil alih atau menghapus langganan orang lain, dan `unsubscribe`
 * hanya menghapus baris milik pemanggil (spek §5.2: logout tidak menghentikan push).
 */

export function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

export function pushConfig(env: Env): PushConfigDto {
  const enabled = env.PUSH !== undefined && (env.VAPID_PUBLIC_KEY ?? '') !== '';
  return { enabled, publicKey: enabled ? (env.VAPID_PUBLIC_KEY ?? '') : '' };
}

/** Idempoten: mendaftar ulang endpoint yang sama memperbarui kunci dan mereset hitungan gagal baris milik pemanggil. */
export async function subscribePush(
  env: Env,
  user: Pick<UserContext, 'email'>,
  input: PushSubscribeInput,
): Promise<{ ok: true }> {
  const recipient = normalizeEmail(user.email);
  const hash = endpointHash(input.endpoint);
  const now = nowIso(env);
  // Batas per pengguna dijaga serial lewat kunci baris `notification_prefs` milik pengguna: tanpa ini, `subscribe`
  // serentak sama-sama melihat < batas lalu sama-sama menambah (melewati 20). Baris dibuat bila belum ada (nilai
  // bawaan = perilaku tanpa baris) lalu dikunci `FOR UPDATE`; transaksi memuat ulang daftar langganan di bawah kunci.
  await env.DB.transaction(async (tx) => {
    await tx
      .prepare(
        'INSERT INTO notification_prefs (recipient, updated_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE recipient = recipient',
      )
      .bind(recipient, now)
      .run();
    await tx
      .prepare('SELECT recipient FROM notification_prefs WHERE recipient = ? FOR UPDATE')
      .bind(recipient)
      .first();
    const own = await tx
      .prepare(
        'SELECT endpoint_hash FROM push_subscriptions WHERE recipient = ? ORDER BY created_at, endpoint_hash',
      )
      .bind(recipient)
      .all<{ endpoint_hash: string }>();
    const known = own.results.some((row) => row.endpoint_hash === hash);
    if (!known && own.results.length >= PUSH_LIMITS.perUser) {
      // Batas per pengguna: langganan paling lama (kemungkinan perangkat lama) diganti.
      const overflow = own.results.length - PUSH_LIMITS.perUser + 1;
      for (const row of own.results.slice(0, overflow)) {
        await tx
          .prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND recipient = ?')
          .bind(row.endpoint_hash, recipient)
          .run();
      }
    }
    await tx
      .prepare(
        "INSERT INTO push_subscriptions (endpoint_hash, recipient, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE endpoint = VALUES(endpoint), p256dh = VALUES(p256dh), auth = VALUES(auth), fail_count = 0, last_error = '', last_error_at = ''",
      )
      .bind(hash, recipient, input.endpoint, input.p256dh, input.auth, now)
      .run();
  });
  return { ok: true };
}

export async function unsubscribePush(
  env: Env,
  user: Pick<UserContext, 'email'>,
  input: PushUnsubscribeInput,
): Promise<{ ok: true }> {
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND recipient = ?')
    .bind(endpointHash(input.endpoint), normalizeEmail(user.email))
    .run();
  return { ok: true };
}

export async function setPushPreference(
  env: Env,
  user: Pick<UserContext, 'email'>,
  input: PushPreferenceInput,
): Promise<{ enabled: boolean }> {
  await env.DB.prepare(
    'INSERT INTO notification_prefs (recipient, push_enabled, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE push_enabled = VALUES(push_enabled), updated_at = VALUES(updated_at)',
  )
    .bind(normalizeEmail(user.email), input.enabled ? 1 : 0, nowIso(env))
    .run();
  return { enabled: input.enabled };
}

/** Izin peramban yang dilaporkan klien (untuk status admin); tidak memengaruhi pengiriman. */
export async function reportPushPermission(
  env: Env,
  user: Pick<UserContext, 'email'>,
  input: PushPermissionInput,
): Promise<{ ok: true }> {
  await env.DB.prepare(
    'INSERT INTO notification_prefs (recipient, permission, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE permission = VALUES(permission), updated_at = VALUES(updated_at)',
  )
    .bind(normalizeEmail(user.email), input.state, nowIso(env))
    .run();
  return { ok: true };
}

/**
 * Status push semua pengguna aktif (hanya email, nama, status: tanpa pengenal perangkat atau rincian galat).
 * Urutan keputusan: izin ditolak (`denied`) > dimatikan pengguna (`disabled`) > tak ada langganan (`none`) >
 * pengiriman gagal berturut-turut pada SEMUA langganan (`failing`, ambang `PUSH_FAILING_THRESHOLD`) > `active`.
 * `failing` dan `active` berasal dari hasil pengiriman nyata (`fail_count`), bukan sekadar "pernah mengizinkan".
 */
export async function pushStatus(env: Env): Promise<PushUserStatusDto[]> {
  const [users, prefs, subs] = await Promise.all([
    env.DB.prepare(
      "SELECT email, name FROM users WHERE status = 'active' ORDER BY name, email",
    ).all<{
      email: string;
      name: string;
    }>(),
    env.DB.prepare('SELECT recipient, push_enabled, permission FROM notification_prefs').all<{
      recipient: string;
      push_enabled: number | string;
      permission: string;
    }>(),
    env.DB.prepare(
      'SELECT recipient, COUNT(*) AS n, SUM(CASE WHEN fail_count >= ? THEN 1 ELSE 0 END) AS failing FROM push_subscriptions GROUP BY recipient',
    )
      .bind(PUSH_FAILING_THRESHOLD)
      .all<{ recipient: string; n: number | string; failing: number | string | null }>(),
  ]);
  const prefsOf = new Map(prefs.results.map((row) => [row.recipient, row] as const));
  const subsOf = new Map(subs.results.map((row) => [row.recipient, row] as const));
  return users.results.map((user) => {
    const email = normalizeEmail(user.email);
    const pref = prefsOf.get(email);
    const sub = subsOf.get(email);
    let state: PushUserState;
    if (pref?.permission === 'denied') state = 'denied';
    else if (pref !== undefined && Number(pref.push_enabled) === 0) state = 'disabled';
    else if (sub === undefined || Number(sub.n) === 0) state = 'none';
    else if (Number(sub.failing ?? 0) >= Number(sub.n)) state = 'failing';
    else state = 'active';
    return { email, name: user.name, state };
  });
}
