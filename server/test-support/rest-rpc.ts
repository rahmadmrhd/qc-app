import { app } from '@server/app';
import type { Env } from '@server/core/env';
import { callRoute } from '@server/core/router';
import { signSessionToken } from '@server/core/session';
import { getRoutes } from '@server/routes';
import {
  API_ROUTES,
  downloadOutput,
  formatEtag,
  REST_MIGRATED_IDS,
  toRequestParts,
} from '@shared/api';
import type { RpcResult, WorkerRpcMethod } from '@shared/rpc';

/**
 * Memanggil satu id sebagai user lewat KABEL REST nyata (`app.request` -> `/api/v1/...` dari tabel `API_ROUTES`)
 * dan mengembalikan bentuk `RpcResult` yang dipakai tes lama, sehingga semua asersi tes RPC tetap berlaku di atas
 * kabel baru, termasuk rute biner (badan mentah/multipart dan unduhan: keluaran `bytes`). Id yang belum ada di `REST_MIGRATED_IDS`, atau input yang bukan objek/null (payload rusak yang
 * sengaja diuji pada validator), tetap lewat `callRoute`.
 */
export async function restRpc(
  env: Env,
  email: string,
  id: string,
  input: unknown,
): Promise<RpcResult<unknown>> {
  const token = await signSessionToken(env, email, (env.NOW ?? Date.now)());
  const plain =
    input === null || input === undefined || (typeof input === 'object' && !Array.isArray(input));
  if (!REST_MIGRATED_IDS.has(id as WorkerRpcMethod) || !plain) {
    return callRoute(env, token, id, input, getRoutes());
  }
  let parts: ReturnType<typeof toRequestParts>;
  try {
    parts = toRequestParts(id as WorkerRpcMethod, (input ?? null) as never);
  } catch {
    // jalur tak dapat dibentuk (mis. id sengaja dikosongkan): validator RPC yang menilai
    return callRoute(env, token, id, input, getRoutes());
  }
  const query = Object.entries(parts.query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const headers: Record<string, string> = { cookie: `qc_session=${token}` };
  if (parts.verb !== 'GET') headers['x-requested-with'] = 'qc';
  if (parts.body !== undefined) headers['content-type'] = 'application/json';
  let body: string | Uint8Array | FormData | undefined =
    parts.body === undefined ? undefined : JSON.stringify(parts.body);
  if (parts.raw !== undefined) {
    headers['content-type'] = parts.raw.contentType;
    body = parts.raw.data;
  }
  if (parts.multipart !== undefined) {
    const form = new FormData();
    for (const [name, data] of Object.entries(parts.multipart)) {
      form.append(name, new Blob([data]), `${name}.bin`);
    }
    body = form;
  }
  if (parts.ifMatch !== undefined) headers['if-match'] = formatEtag(parts.ifMatch);
  const response = await app.request(
    `https://qc.test/api/v1${parts.path}${query === '' ? '' : `?${query}`}`,
    {
      method: parts.verb,
      headers,
      body,
    },
    env,
  );
  if (response.ok && API_ROUTES[id as WorkerRpcMethod].download !== undefined) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { ok: true, data: downloadOutput(id as never, input as never, response.headers, bytes) };
  }
  const text = await response.text();
  const json = text === '' ? undefined : (JSON.parse(text) as Record<string, unknown>);
  if (response.ok) return { ok: true, data: json };
  return {
    ok: false,
    error: {
      code: (json?.code ?? 'INTERNAL') as never,
      message: String(json?.detail ?? ''),
      requestId: String(json?.requestId ?? '-'),
      ...(json?.fields ? { fields: json.fields as Record<string, string> } : {}),
    },
  };
}
