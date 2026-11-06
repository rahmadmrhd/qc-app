import { app as defaultApp } from '@server/app';
import { signSessionToken } from '@server/core/session';
import type { TestEnv } from './test-env';

export interface SendOptions {
  body?: unknown;
  /** Badan mentah (menimpa `body`), mis. biner atau multipart. */
  raw?: string | Uint8Array | ArrayBuffer | Blob | FormData;
  /** Email pemilik sesi; `null` = tanpa sesi. Bawaan admin super. */
  email?: string | null;
  headers?: Record<string, string>;
  /** `false` = tanpa header `X-Requested-With: qc` pada metode tulis. */
  csrf?: boolean;
}

/** Klien REST untuk tes: memanggil `app` nyata (`/api/v1`) dengan sesi cookie dan header CSRF. */
export function restClient(env: TestEnv, app: typeof defaultApp = defaultApp) {
  async function send(method: string, path: string, options: SendOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.email !== null) {
      const token = await signSessionToken(
        env,
        options.email ?? 'admin@gmail.com',
        env.clock.now(),
      );
      headers.cookie = `qc_session=${token}`;
    }
    if (method !== 'GET' && options.csrf !== false) headers['x-requested-with'] = 'qc';
    if (options.raw === undefined && options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const body =
      options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    return app.request(`https://qc.test/api/v1${path}`, { method, headers, body }, env);
  }
  return {
    send,
    get: (path: string, options?: SendOptions) => send('GET', path, options),
    post: (path: string, options?: SendOptions) => send('POST', path, options),
    put: (path: string, options?: SendOptions) => send('PUT', path, options),
    patch: (path: string, options?: SendOptions) => send('PATCH', path, options),
    del: (path: string, options?: SendOptions) => send('DELETE', path, options),
  };
}

export const jsonOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;
