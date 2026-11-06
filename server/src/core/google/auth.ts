import { encodeBytes, encodeText } from '@server/core/base64url';
import { base64ToBytes } from '@server/core/bytes';
import { appError } from '@server/core/errors';

/** Cakupan: `drive` penuh (berkas lama dan folder induk dibuat pemilik, `drive.file` tidak cukup) dan `spreadsheets`. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
] as const;
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Token dianggap kedaluwarsa bila sisa umurnya kurang dari ini (diperbarui SEBELUM benar-benar habis). */
const REFRESH_SKEW_MS = 300_000;
const JWT_LIFETIME_SECONDS = 3600;
const TOKEN_TIMEOUT_MS = 30_000;
const TOKEN_RETRY_DELAYS_MS = [500, 1500];

export interface TokenProviderOptions {
  keyFile: string;
  scopes: readonly string[];
  fetch: typeof fetch;
  readKeyFile: (path: string) => Promise<string>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Membuang token yang tersimpan; dengan `failedToken`, hanya bila token tersimpan memang token itu (anti-perlombaan). */
  invalidate(failedToken?: string): void;
}

interface ServiceAccountKey {
  clientEmail: string;
  privateKey: CryptoKey;
}

function unavailable(message: string): never {
  throw appError('UNAVAILABLE', message);
}

/** Pesan galat TIDAK pernah memuat isi berkas kunci, kunci privat, JWT, atau token. */
async function loadKey(options: TokenProviderOptions): Promise<ServiceAccountKey> {
  if (options.keyFile === '') {
    return unavailable('Google belum dikonfigurasi: GOOGLE_SA_KEY_FILE kosong. Hubungi admin.');
  }
  let text: string;
  try {
    text = await options.readKeyFile(options.keyFile);
  } catch {
    console.error(
      'Berkas kunci service account Google tidak terbaca (periksa GOOGLE_SA_KEY_FILE dan izinnya)',
    );
    return unavailable('Kunci service account Google tidak terbaca. Hubungi admin.');
  }
  let parsed: { type?: unknown; client_email?: unknown; private_key?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    parsed = {};
  }
  const { client_email: clientEmail, private_key: pem } = parsed;
  if (
    parsed.type !== 'service_account' ||
    typeof clientEmail !== 'string' ||
    clientEmail === '' ||
    typeof pem !== 'string'
  ) {
    console.error(
      'Berkas kunci Google bukan kunci service account yang valid (type/client_email/private_key)',
    );
    return unavailable('Kunci service account Google tidak valid. Hubungi admin.');
  }
  try {
    const body = pem
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      base64ToBytes(body),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return { clientEmail, privateKey };
  } catch {
    console.error('Kunci privat service account Google tidak dapat diimpor (harus PKCS#8 RSA)');
    return unavailable('Kunci service account Google tidak valid. Hubungi admin.');
  }
}

async function signJwt(
  key: ServiceAccountKey,
  scopes: readonly string[],
  nowMs: number,
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = encodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = encodeText(
    JSON.stringify({
      iss: key.clientEmail,
      scope: scopes.join(' '),
      aud: GOOGLE_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + JWT_LIFETIME_SECONDS,
    }),
  );
  const signed = `${header}.${claims}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(signed)),
  );
  return `${signed}.${encodeBytes(signature)}`;
}

/** Kode galat OAuth singkat (`invalid_grant`, ...) untuk log; apa pun selain pola ini dibuang. */
function oauthErrorCode(text: string): string {
  try {
    const value = (JSON.parse(text) as { error?: unknown }).error;
    return typeof value === 'string' && /^[a-z_]{1,40}$/.test(value) ? value : '?';
  } catch {
    return '?';
  }
}

export function createTokenProvider(options: TokenProviderOptions): TokenProvider {
  let key: Promise<ServiceAccountKey> | null = null;
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  function keyOnce(): Promise<ServiceAccountKey> {
    // Kegagalan tidak disimpan: berkas yang diperbaiki operator terbaca pada percobaan berikutnya tanpa restart.
    key ??= loadKey(options).catch((error: unknown) => {
      key = null;
      throw error;
    });
    return key;
  }

  async function exchange(): Promise<string> {
    const account = await keyOnce();
    const assertion = await signJwt(account, options.scopes, options.now());
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString();
    for (let attempt = 0; ; attempt++) {
      let response: Response | null = null;
      try {
        response = await options.fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        });
      } catch {
        response = null;
      }
      const transient = response === null || response.status === 429 || response.status >= 500;
      if (response?.ok) {
        const data = (await response.json().catch(() => null)) as {
          access_token?: unknown;
          expires_in?: unknown;
        } | null;
        if (typeof data?.access_token !== 'string' || typeof data.expires_in !== 'number') {
          console.error('Penukaran token Google membalas dengan format yang tidak dikenal');
          return unavailable('Gagal memperoleh token Google. Coba lagi sebentar lagi.');
        }
        cached = { token: data.access_token, expiresAt: options.now() + data.expires_in * 1000 };
        return data.access_token;
      }
      const delay = TOKEN_RETRY_DELAYS_MS[attempt];
      if (transient && delay !== undefined) {
        await options.sleep(delay);
        continue;
      }
      const detail =
        response === null
          ? 'jaringan'
          : `HTTP ${response.status} ${oauthErrorCode(await response.text())}`;
      console.error(`Penukaran token Google gagal (${detail})`);
      return unavailable('Gagal memperoleh token Google. Hubungi admin bila berulang.');
    }
  }

  return {
    async getAccessToken() {
      if (cached && options.now() < cached.expiresAt - REFRESH_SKEW_MS) return cached.token;
      // Panggilan serentak berbagi satu penukaran.
      inflight ??= exchange().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    invalidate(failedToken) {
      if (failedToken === undefined || cached?.token === failedToken) cached = null;
    },
  };
}
