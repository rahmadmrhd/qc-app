import { app as defaultApp } from '@server/app';
import { SYNC_API_ROUTES, type SyncRouteId } from '@shared/api';
import type { TestEnv } from './test-env';

/** Token sinkron bawaan tes (`SYNC_API_TOKEN`), >= panjang minimum. */
export const SYNC_TEST_TOKEN = 't0k3n'.repeat(8);

export interface SyncSendOptions {
  /** Token Bearer; `null` = tanpa header Authorization. Bawaan `SYNC_TEST_TOKEN`. */
  token?: string | null;
  /** Header tambahan (mis. `cookie`, `cf-connecting-ip`); menimpa yang dihasilkan helper. */
  headers?: Record<string, string>;
  /** Badan mentah (menimpa `payload`), mis. teks bukan JSON atau badan besar. */
  raw?: string | Uint8Array;
  /** IP klien yang dilihat pembatas (`c.env.clientIp`, hasil `clientIp()` di server nyata). Bawaan: tak dikenal. */
  clientIp?: string;
}

/** Query dari payload pull: angka/teks apa adanya, daftar digabung koma; `null`/`undefined` dilewati. */
function queryOf(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const params: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    const text = Array.isArray(value) ? value.join(',') : String(value);
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
  }
  return params.length === 0 ? '' : `?${params.join('&')}`;
}

/**
 * Memanggil rute sinkron lewat `app` NYATA (`/api/v1/sync/*`): `payload` = badan JSON (push), query (pull), atau
 * `{ driveId }` (file.get, jadi segmen jalur). Mengembalikan `Response` mentah.
 */
export async function syncSend(
  env: TestEnv,
  id: SyncRouteId,
  payload: unknown,
  options: SyncSendOptions = {},
  app: typeof defaultApp = defaultApp,
): Promise<Response> {
  const def = SYNC_API_ROUTES[id];
  const token = options.token === undefined ? SYNC_TEST_TOKEN : options.token;
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  let path = def.path;
  let body: string | Uint8Array | undefined;
  if (id === 'sync.file.get') {
    path = path.replace('{id}', encodeURIComponent((payload as { driveId: string }).driveId));
  } else if (def.verb === 'GET') {
    path += queryOf(payload);
  } else if (options.raw !== undefined) {
    body = options.raw;
    headers['content-type'] = 'application/json';
  } else if (payload !== null && payload !== undefined) {
    body = JSON.stringify(payload);
    headers['content-type'] = 'application/json';
  }
  const bindings = options.clientIp === undefined ? env : { ...env, clientIp: options.clientIp };
  return app.request(
    `https://qc.test/api/v1${path}`,
    { method: def.verb, headers: { ...headers, ...options.headers }, body },
    bindings,
  );
}

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
export type SyncOut = { ok: boolean; data?: any; error?: any };

/**
 * Seperti `syncSend`, dibungkus ke bentuk `{ ok, data | error }` yang dipakai asersi tes sinkron: 200 -> `data`
 * (JSON; untuk file.get `{ driveId, mime, base64 }`), selain itu problem+json -> `error` (`message` = `detail`).
 */
export async function syncCall(
  env: TestEnv,
  id: SyncRouteId,
  payload: unknown,
  options: SyncSendOptions = {},
  app: typeof defaultApp = defaultApp,
): Promise<SyncOut> {
  const response = await syncSend(env, id, payload, options, app);
  if (response.status === 200) {
    if (id === 'sync.file.get') {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        ok: true,
        data: {
          driveId: (payload as { driveId: string }).driveId,
          mime: response.headers.get('content-type'),
          base64: Buffer.from(bytes).toString('base64'),
        },
      };
    }
    return { ok: true, data: await response.json() };
  }
  const problem = (await response.json()) as {
    code: string;
    detail: string;
    requestId: string;
    fields?: Record<string, string>;
  };
  return {
    ok: false,
    error: {
      code: problem.code,
      message: problem.detail,
      requestId: problem.requestId,
      ...(problem.fields ? { fields: problem.fields } : {}),
      status: response.status,
    },
  };
}
