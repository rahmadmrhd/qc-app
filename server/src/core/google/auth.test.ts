import { afterEach, describe, expect, test } from 'bun:test';
import { decodeText } from '@server/core/base64url';
import { isAppError } from '@server/core/errors';
import { FAKE_TOKEN_URL, type JwtClaims } from '@server-test/fake-google';
import { createGoogleRig, type GoogleRig, KEY_PATH } from '@server-test/google-rig';
import { createTokenProvider, GOOGLE_SCOPES } from './auth';

let rig: GoogleRig | undefined;
afterEach(() => rig?.restoreConsole());

async function setup() {
  rig = await createGoogleRig();
  const tokens = createTokenProvider({
    keyFile: KEY_PATH,
    scopes: GOOGLE_SCOPES,
    fetch: rig.fake.fetch,
    readKeyFile: async () => (rig as GoogleRig).keyJson,
    now: rig.clock.now,
    sleep: async () => {},
  });
  return { rig, tokens };
}

describe('JWT service account', () => {
  test('klaim iss/scope/aud/exp benar dan tanda tangan RS256 terverifikasi dengan kunci publik', async () => {
    const { rig, tokens } = await setup();
    const token = await tokens.getAccessToken();
    expect(token).toStartWith('ya29.');
    // Penukaran hanya terjadi bila tanda tangan lolos verifikasi di server palsu (crypto.subtle.verify).
    expect(rig.fake.tokenExchanges).toHaveLength(1);
    const claims = rig.fake.tokenExchanges[0] as JwtClaims;
    expect(claims.iss).toBe('qc-test@qc-test.iam.gserviceaccount.com');
    expect(claims.aud).toBe(FAKE_TOKEN_URL);
    expect(claims.scope.split(' ').sort()).toEqual([
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ]);
    expect(claims.iat).toBe(Math.floor(rig.clock.now() / 1000));
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
    expect(claims.exp).toBeGreaterThan(claims.iat);
    const request = rig.fake.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('content-type')).toContain('application/x-www-form-urlencoded');
    const assertion = new URLSearchParams(request?.text ?? '').get('assertion') ?? '';
    const header = JSON.parse(decodeText(assertion.split('.')[0] as string) as string);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
  });

  test('tanda tangan rusak ditolak server (verifikasi nyata), jadi kunci yang salah = UNAVAILABLE', async () => {
    const { rig } = await setup();
    const other = await createGoogleRig();
    const wrong = createTokenProvider({
      keyFile: KEY_PATH,
      scopes: GOOGLE_SCOPES,
      fetch: rig.fake.fetch,
      readKeyFile: async () => other.keyJson, // kunci privat lain
      now: rig.clock.now,
      sleep: async () => {},
    });
    const error = await wrong.getAccessToken().catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe('UNAVAILABLE');
  });
});

describe('cache token', () => {
  test('dua panggilan beruntun = satu penukaran token', async () => {
    const { rig, tokens } = await setup();
    const a = await tokens.getAccessToken();
    const b = await tokens.getAccessToken();
    expect(a).toBe(b);
    expect(rig.fake.tokenExchanges).toHaveLength(1);
  });

  test('panggilan serentak berbagi satu penukaran', async () => {
    const { rig, tokens } = await setup();
    const all = await Promise.all([1, 2, 3, 4].map(() => tokens.getAccessToken()));
    expect(new Set(all).size).toBe(1);
    expect(rig.fake.tokenExchanges).toHaveLength(1);
  });

  test('diperbarui SEBELUM kedaluwarsa (bukan setelahnya)', async () => {
    const { rig, tokens } = await setup();
    const first = await tokens.getAccessToken();
    rig.clock.advance(3000_000); // 50 menit: masih ada > 5 menit tersisa
    expect(await tokens.getAccessToken()).toBe(first);
    rig.clock.advance(400_000); // sisa < 5 menit
    const second = await tokens.getAccessToken();
    expect(second).not.toBe(first);
    expect(rig.fake.tokenExchanges).toHaveLength(2);
  });

  test('invalidate() memaksa penukaran baru', async () => {
    const { rig, tokens } = await setup();
    await tokens.getAccessToken();
    tokens.invalidate();
    await tokens.getAccessToken();
    expect(rig.fake.tokenExchanges).toHaveLength(2);
  });
});

describe('berkas kunci dan kerahasiaan', () => {
  test('berkas kunci tidak terbaca atau bukan service account = UNAVAILABLE tanpa memuat isinya', async () => {
    rig = await createGoogleRig();
    for (const content of [
      'bukan json {{{',
      JSON.stringify({ type: 'service_account', SENTINEL_FIELD: 'RAHASIA-XYZ' }),
    ]) {
      const tokens = createTokenProvider({
        keyFile: KEY_PATH,
        scopes: GOOGLE_SCOPES,
        fetch: rig.fake.fetch,
        readKeyFile: async () => content,
        now: rig.clock.now,
        sleep: async () => {},
      });
      const error = await tokens.getAccessToken().catch((e: unknown) => e);
      expect(isAppError(error) && error.code).toBe('UNAVAILABLE');
      expect(String((error as Error).message)).not.toContain('RAHASIA-XYZ');
      expect(String((error as Error).message)).not.toContain('bukan json');
    }
    const missing = createTokenProvider({
      keyFile: '/tidak/ada.json',
      scopes: GOOGLE_SCOPES,
      fetch: rig.fake.fetch,
      readKeyFile: async () => {
        throw new Error('ENOENT: /tidak/ada.json');
      },
      now: rig.clock.now,
      sleep: async () => {},
    });
    const error = await missing.getAccessToken().catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe('UNAVAILABLE');
  });

  test('kunci privat dan token TIDAK muncul di pesan galat maupun keluaran console (sentinel)', async () => {
    rig = await createGoogleRig();
    const pemBody = rig.privateKeyPem.split('\n')[1] as string;
    // Server token yang membalas galat sambil memantulkan badan permintaan (berisi JWT) dan kata sandi sentinel.
    rig.fake.intercept = (request) =>
      request.url.href.startsWith(FAKE_TOKEN_URL)
        ? new Response(
            `{"error":"server_error","echo":${JSON.stringify(request.text)},"secret":"TOKEN-SENTINEL-123"}`,
            {
              status: 500,
            },
          )
        : undefined;
    const tokens = createTokenProvider({
      keyFile: KEY_PATH,
      scopes: GOOGLE_SCOPES,
      fetch: rig.fake.fetch,
      readKeyFile: async () => (rig as GoogleRig).keyJson,
      now: rig.clock.now,
      sleep: async () => {},
    });
    const error = (await tokens.getAccessToken().catch((e: unknown) => e)) as Error;
    expect(isAppError(error) && error.code).toBe('UNAVAILABLE');
    const assertion = new URLSearchParams(rig.fake.requests[0]?.text ?? '').get('assertion') ?? '';
    const everything = [error.message, error.stack ?? '', ...rig.logs].join('\n');
    expect(everything).not.toContain(pemBody);
    expect(everything).not.toContain('PRIVATE KEY');
    expect(everything).not.toContain('TOKEN-SENTINEL-123');
    expect(everything).not.toContain(assertion);
  });

  test('galat 5xx pada titik token dicoba ulang (idempoten) lalu berhasil', async () => {
    rig = await createGoogleRig();
    let calls = 0;
    rig.fake.intercept = (request) => {
      if (!request.url.href.startsWith(FAKE_TOKEN_URL)) return undefined;
      calls += 1;
      return calls === 1 ? new Response('boom', { status: 503 }) : undefined;
    };
    const tokens = createTokenProvider({
      keyFile: KEY_PATH,
      scopes: GOOGLE_SCOPES,
      fetch: rig.fake.fetch,
      readKeyFile: async () => (rig as GoogleRig).keyJson,
      now: rig.clock.now,
      sleep: async () => {},
    });
    expect(await tokens.getAccessToken()).toStartWith('ya29.');
    expect(calls).toBe(2);
  });
});
