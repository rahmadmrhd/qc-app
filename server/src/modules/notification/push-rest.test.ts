import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createFakePush } from '@server-test/fake-push';
import { seedHandoverEnv } from '@server-test/handover-env';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { endpointHash } from './push-service';
import { PUSH_LIMITS, pushEndpointError } from './push-validate';
import { base64UrlEncode } from './web-push';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const WH = 'wh@gmail.com';
const QC = 'qc@gmail.com';
const ADMIN = 'admin@gmail.com';
const EP = 'https://fcm.googleapis.com/fcm/send/abc123';

async function keys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const p256dh = base64UrlEncode(
    new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
  );
  const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  return { p256dh, auth };
}

beforeEach(async () => {
  env = await createTestEnv();
  rest = restClient(env);
  await seedHandoverEnv(env);
});

async function subscribe(email: string, endpoint = EP, extra: Record<string, unknown> = {}) {
  const k = await keys();
  return rest.post('/push/subscriptions', { email, body: { endpoint, ...k, ...extra } });
}

async function subCount(recipient?: string): Promise<number> {
  const row =
    recipient === undefined
      ? await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>()
      : await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE recipient = ?')
          .bind(recipient)
          .first<{ n: number }>();
  return Number(row?.n);
}

describe('push.config', () => {
  test('tanpa pengirim: enabled false; dengan pengirim dan kunci: enabled true + kunci publik', async () => {
    const off = await rest.get('/push/config', { email: WH });
    expect(await jsonOf(off)).toEqual({ enabled: false, publicKey: '', userEnabled: true });
    const withPush = await createTestEnv({ PUSH: createFakePush(), VAPID_PUBLIC_KEY: 'KUNCI' });
    await seedHandoverEnv(withPush);
    const on = await restClient(withPush).get('/push/config', { email: WH });
    expect(await jsonOf(on)).toEqual({ enabled: true, publicKey: 'KUNCI', userEnabled: true });
  });

  test('tanpa sesi -> 401', async () => {
    expect((await rest.get('/push/config', { email: null })).status).toBe(401);
  });

  test('userEnabled mengikuti preferensi pemanggil (bawaan aktif) dan tak memengaruhi pengguna lain', async () => {
    const withPush = await createTestEnv({ PUSH: createFakePush(), VAPID_PUBLIC_KEY: 'KUNCI' });
    await seedHandoverEnv(withPush);
    const client = restClient(withPush);
    const read = async (email: string) =>
      (await jsonOf(await client.get('/push/config', { email }))) as { userEnabled: boolean };
    expect((await read(WH)).userEnabled).toBe(true);
    await client.put('/push/preference', { email: WH, body: { enabled: false } });
    expect((await read(WH)).userEnabled).toBe(false);
    expect((await read(QC)).userEnabled).toBe(true);
    await client.put('/push/preference', { email: WH, body: { enabled: true } });
    expect((await read(WH)).userEnabled).toBe(true);
  });

  test('push nonaktif di server: userEnabled tetap mengikuti preferensi tersimpan', async () => {
    await rest.put('/push/preference', { email: WH, body: { enabled: false } });
    const off = (await jsonOf(await rest.get('/push/config', { email: WH }))) as {
      enabled: boolean;
      publicKey: string;
      userEnabled: boolean;
    };
    expect(off).toEqual({ enabled: false, publicKey: '', userEnabled: false });
  });
});

describe('push.subscribe / unsubscribe', () => {
  test('subscribe idempoten: dua kali = satu baris, kunci diperbarui', async () => {
    expect((await subscribe(WH)).status).toBe(200);
    expect((await subscribe(WH)).status).toBe(200);
    expect(await subCount(WH)).toBe(1);
    const row = await env.DB.prepare('SELECT endpoint, fail_count FROM push_subscriptions').first<{
      endpoint: string;
      fail_count: number;
    }>();
    expect(row?.endpoint).toBe(EP);
  });

  test('pengguna lain pada endpoint yang sama menambah barisnya; tak mengambil alih milik orang lain', async () => {
    await subscribe(WH);
    await subscribe(QC);
    expect(await subCount()).toBe(2);
    // Unsubscribe hanya menghapus baris milik pemanggil.
    const out = await rest.post('/push/unsubscribe', { email: QC, body: { endpoint: EP } });
    expect(out.status).toBe(200);
    expect(await subCount(QC)).toBe(0);
    expect(await subCount(WH)).toBe(1);
    // Unsubscribe oleh pengguna yang tak punya baris tidak mengubah milik orang lain.
    await rest.post('/push/unsubscribe', { email: QC, body: { endpoint: EP } });
    expect(await subCount(WH)).toBe(1);
  });

  test('endpoint tidak aman ditolak VALIDATION (422)', async () => {
    const bad = [
      'http://fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'https://10.0.0.5/x',
      'https://[::1]/x',
      'https://192.168.1.1/x',
      'https://intranet/x',
      'https://host.internal/x',
      'https://svc.local/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'ftp://fcm.googleapis.com/x',
      'bukan-url',
      `https://fcm.googleapis.com/${'a'.repeat(PUSH_LIMITS.endpoint)}`,
    ];
    for (const endpoint of bad) {
      const response = await subscribe(WH, endpoint);
      expect(response.status, endpoint).toBe(422);
    }
    expect(await subCount()).toBe(0);
  });

  test('allowlist host layanan push: host publik lain atau penyamaran nama ditolak (422), tanpa menyimpan', async () => {
    const notAllowed = [
      'https://push.example.test/x',
      'https://evil.example.com/hook',
      // Penyamaran: domain layanan hanya sebagai awalan/bagian tengah nama host milik pihak lain.
      'https://fcm.googleapis.com.evil.com/x',
      'https://evil.com/fcm.googleapis.com',
      'https://evilfcm.googleapis.com/x',
      'https://notify.windows.com.evil.test/x',
      'https://xnotify.windows.com/x',
      'https://pushxapple.com/x',
      'https://mozilla.org/x',
    ];
    for (const endpoint of notAllowed) {
      const response = await subscribe(WH, endpoint);
      expect(response.status, endpoint).toBe(422);
      expect(pushEndpointError(endpoint), endpoint).not.toBeNull();
    }
    expect(await subCount()).toBe(0);
    expect(pushEndpointError('https://push.example.test/x')).toBe(
      'Layanan push endpoint ini tidak didukung',
    );
  });

  test('allowlist: huruf besar dan titik di ujung nama host tetap dikenali', () => {
    expect(pushEndpointError('https://FCM.GoogleAPIs.com/x')).toBeNull();
    expect(pushEndpointError('https://fcm.googleapis.com./x')).toBeNull();
    expect(pushEndpointError('https://a.b.push.services.mozilla.com/x')).toBeNull();
    expect(pushEndpointError('https://android.googleapis.com/gcm/send/x')).toBeNull();
  });

  test('kunci p256dh/auth tidak valid ditolak', async () => {
    expect((await subscribe(WH, EP, { p256dh: 'bukan-kunci' })).status).toBe(422);
    expect((await subscribe(WH, EP, { auth: 'pendek' })).status).toBe(422);
    expect((await subscribe(WH, EP, { auth: '***' })).status).toBe(422);
    expect(await subCount()).toBe(0);
  });

  test('pushEndpointError menerima layanan push umum', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://fcm.googleapis.com:443/x',
    ]) {
      expect(pushEndpointError(endpoint), endpoint).toBeNull();
    }
  });

  test('batas langganan per pengguna: yang paling lama diganti', async () => {
    for (let i = 0; i < PUSH_LIMITS.perUser + 2; i++) {
      env.clock.advance(1000);
      expect((await subscribe(WH, `https://fcm.googleapis.com/ep${i}`)).status).toBe(200);
    }
    expect(await subCount(WH)).toBe(PUSH_LIMITS.perUser);
    const oldest = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint_hash = ?',
    )
      .bind(endpointHash('https://fcm.googleapis.com/ep0'))
      .first<{ n: number }>();
    expect(Number(oldest?.n)).toBe(0);
  });

  test('batas langganan per pengguna tahan subscribe serentak (tak pernah melewati batas)', async () => {
    for (let i = 0; i < PUSH_LIMITS.perUser - 2; i++) {
      env.clock.advance(1000);
      expect((await subscribe(WH, `https://fcm.googleapis.com/awal${i}`)).status).toBe(200);
    }
    // Sisa ruang 2; 8 permintaan serentak dengan endpoint berbeda.
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => subscribe(WH, `https://fcm.googleapis.com/serentak${i}`)),
    );
    for (const response of responses) expect(response.status).toBe(200);
    expect(await subCount(WH)).toBe(PUSH_LIMITS.perUser);
    // Preferensi bawaan tak berubah oleh baris kunci yang dibuat `subscribe`.
    const pref = await env.DB.prepare(
      'SELECT push_enabled, permission FROM notification_prefs WHERE recipient = ?',
    )
      .bind(WH)
      .first<{ push_enabled: number | string; permission: string }>();
    expect(Number(pref?.push_enabled)).toBe(1);
    expect(pref?.permission).toBe('default');
  });

  test('tanpa sesi -> 401', async () => {
    const response = await rest.post('/push/subscriptions', {
      email: null,
      body: { endpoint: EP, p256dh: 'x', auth: 'y' },
    });
    expect(response.status).toBe(401);
  });
});

describe('push.deviceState / setDeviceMuted', () => {
  const state = async (email: string, endpoint = EP) =>
    (await jsonOf(await rest.post('/push/device/state', { email, body: { endpoint } }))) as {
      registered: boolean;
      muted: boolean;
    };
  const setMuted = (email: string, muted: boolean, endpoint = EP) =>
    rest.put('/push/device', { email, body: { endpoint, muted } });

  test('perangkat belum terdaftar: registered false; dimatikan -> 404', async () => {
    expect(await state(WH)).toEqual({ registered: false, muted: false });
    expect((await setMuted(WH, true)).status).toBe(404);
  });

  test('mematikan dan menyalakan per perangkat; tak memengaruhi perangkat lain atau akun lain di endpoint sama', async () => {
    const other = 'https://fcm.googleapis.com/fcm/send/lain';
    await subscribe(WH);
    await subscribe(WH, other);
    await subscribe(QC);
    expect(await state(WH)).toEqual({ registered: true, muted: false });
    expect(await jsonOf(await setMuted(WH, true))).toEqual({ registered: true, muted: true });
    expect(await state(WH)).toEqual({ registered: true, muted: true });
    expect(await state(WH, other)).toEqual({ registered: true, muted: false });
    expect(await state(QC)).toEqual({ registered: true, muted: false });
    expect(await jsonOf(await setMuted(WH, false))).toEqual({ registered: true, muted: false });
  });

  test('subscribe ulang (sinkron senyap tiap sesi) tidak menyalakan kembali perangkat yang dimatikan', async () => {
    await subscribe(WH);
    await setMuted(WH, true);
    expect((await subscribe(WH)).status).toBe(200);
    expect(await state(WH)).toEqual({ registered: true, muted: true });
  });

  test('masukan tidak valid -> 422; tanpa sesi -> 401', async () => {
    await subscribe(WH);
    expect(
      (await rest.put('/push/device', { email: WH, body: { endpoint: EP, muted: 'ya' } })).status,
    ).toBe(422);
    expect((await rest.put('/push/device', { email: WH, body: { muted: true } })).status).toBe(422);
    expect((await rest.post('/push/device/state', { email: WH, body: {} })).status).toBe(422);
    expect((await setMuted(null as unknown as string, true)).status).toBe(401);
  });
});

describe('preferensi dan izin', () => {
  test('setPreference dan reportPermission tersimpan per pengguna', async () => {
    const pref = await rest.put('/push/preference', { email: WH, body: { enabled: false } });
    expect(pref.status).toBe(200);
    expect(await jsonOf(pref)).toEqual({ enabled: false });
    const perm = await rest.put('/push/permission', { email: WH, body: { state: 'denied' } });
    expect(perm.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT push_enabled, permission FROM notification_prefs WHERE recipient = ?',
    )
      .bind(WH)
      .first<{ push_enabled: number; permission: string }>();
    expect(Number(row?.push_enabled)).toBe(0);
    expect(row?.permission).toBe('denied');
    // Mengubah izin tidak menimpa preferensi, dan sebaliknya.
    await rest.put('/push/preference', { email: WH, body: { enabled: true } });
    const after = await env.DB.prepare(
      'SELECT push_enabled, permission FROM notification_prefs WHERE recipient = ?',
    )
      .bind(WH)
      .first<{ push_enabled: number; permission: string }>();
    expect(Number(after?.push_enabled)).toBe(1);
    expect(after?.permission).toBe('denied');
  });

  test('masukan tidak valid -> 422', async () => {
    expect(
      (await rest.put('/push/preference', { email: WH, body: { enabled: 'ya' } })).status,
    ).toBe(422);
    expect((await rest.put('/push/permission', { email: WH, body: { state: 'x' } })).status).toBe(
      422,
    );
  });
});

describe('push.status', () => {
  async function addSub(recipient: string, name: string, failCount: number) {
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (endpoint_hash, recipient, endpoint, p256dh, auth, created_at, fail_count, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        endpointHash(`https://fcm.googleapis.com/${name}`),
        recipient,
        `https://fcm.googleapis.com/${name}`,
        'RAHASIA-P256',
        'RAHASIA-AUTH',
        '',
        failCount,
        failCount > 0 ? 'http 500' : '',
      )
      .run();
  }

  test('menghitung active/none/failing/disabled/denied; hanya email, nama, status', async () => {
    await addSub(WH, 'wh', 0); // active
    // qc@: tanpa langganan -> none
    await addSub('viewer@gmail.com', 'viewer', 3); // failing
    await addSub('multi@gmail.com', 'multi', 0);
    await env.DB.prepare(
      "INSERT INTO notification_prefs (recipient, push_enabled, updated_at) VALUES ('multi@gmail.com', 0, '')",
    ).run(); // disabled
    await addSub('whedit@gmail.com', 'whedit', 0);
    await env.DB.prepare(
      "INSERT INTO notification_prefs (recipient, permission, updated_at) VALUES ('whedit@gmail.com', 'denied', '')",
    ).run(); // denied
    const response = await rest.get('/push/status', { email: ADMIN });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{ email: string; name: string; state: string }>;
    const byEmail = Object.fromEntries(body.map((u) => [u.email, u.state]));
    expect(byEmail).toMatchObject({
      [WH]: 'active',
      [QC]: 'none',
      'viewer@gmail.com': 'failing',
      'multi@gmail.com': 'disabled',
      'whedit@gmail.com': 'denied',
      'noaccess@gmail.com': 'none',
    });
    for (const user of body) expect(Object.keys(user).sort()).toEqual(['email', 'name', 'state']);
    const text = JSON.stringify(body);
    expect(text).not.toContain('RAHASIA');
    expect(text).not.toContain('fcm.googleapis.com');
    expect(text).not.toContain('http 500');
  });

  test('failing hanya bila SEMUA langganan gagal; satu sehat = active', async () => {
    await addSub(WH, 'a', 5);
    await addSub(WH, 'b', 0);
    const body = (await (await rest.get('/push/status', { email: ADMIN })).json()) as Array<{
      email: string;
      state: string;
    }>;
    expect(body.find((u) => u.email === WH)?.state).toBe('active');
  });

  test('perangkat dimatikan: semua dimatikan = disabled; sisa yang gagal = failing; ada yang menyala sehat = active', async () => {
    await addSub(WH, 'a', 0);
    await addSub(WH, 'b', 5);
    const stateOf = async () =>
      (
        (await (await rest.get('/push/status', { email: ADMIN })).json()) as Array<{
          email: string;
          state: string;
        }>
      ).find((u) => u.email === WH)?.state;
    expect(await stateOf()).toBe('active');
    // Yang sehat dimatikan: tinggal yang gagal menyala -> failing (bukan active).
    await env.DB.prepare('UPDATE push_subscriptions SET muted = 1 WHERE endpoint_hash = ?')
      .bind(endpointHash('https://fcm.googleapis.com/a'))
      .run();
    expect(await stateOf()).toBe('failing');
    await env.DB.prepare('UPDATE push_subscriptions SET muted = 1').run();
    expect(await stateOf()).toBe('disabled');
  });

  test('hanya pengguna access: view; tanpa izin -> 403; tanpa sesi -> 401', async () => {
    expect((await rest.get('/push/status', { email: WH })).status).toBe(403);
    expect((await rest.get('/push/status', { email: null })).status).toBe(401);
  });
});
