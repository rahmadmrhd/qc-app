import type { Env } from '@server/core/env';
import { type ErrorBody, type RouteTable, runRoute, toErrorBody } from '@server/core/router';

/** Hasil pemanggilan satu id lewat `runRoute`/REST, dalam bentuk `{ ok, data | error }` yang dipakai asersi tes. */
export type CallResult<T = unknown> = { ok: true; data: T } | { ok: false; error: ErrorBody };

/**
 * Menjalankan satu id rute (sesi, izin, validasi, handler) TANPA lapisan HTTP dan membungkus hasilnya sebagai
 * `CallResult`. Dipakai tes inti router dan tes yang memasukkan payload sengaja rusak ke validator; jalur kabel REST
 * diuji lewat `restClient`/`restRpc`.
 */
export async function callRoute(
  env: Env,
  token: unknown,
  id: unknown,
  payload: unknown,
  routes: RouteTable,
): Promise<CallResult> {
  const requestId = 'test0001';
  try {
    return { ok: true, data: await runRoute(env, token, id, payload, routes, { requestId }) };
  } catch (error) {
    return { ok: false, error: toErrorBody(error, requestId) };
  }
}
