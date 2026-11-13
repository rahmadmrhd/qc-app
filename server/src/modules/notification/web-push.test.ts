import { describe, expect, test } from 'bun:test';
import {
  base64UrlDecode,
  base64UrlEncode,
  createWebPushSender,
  encryptPayload,
  isValidVapidKeys,
  PUSH_PAYLOAD_MAX_BYTES,
} from './web-push';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const buf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) },
      key,
      bytes * 8,
    ),
  );
}

/** Penerima (peramban) palsu: pasangan kunci + rahasia auth, dan dekripsi RFC 8291 sebagai pembanding independen. */
async function receiver() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: { p256dh: base64UrlEncode(publicRaw), auth: base64UrlEncode(auth) },
    async decrypt(body: Uint8Array): Promise<string> {
      const salt = body.slice(0, 16);
      const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
      const idLen = body[20] as number;
      const asPublic = body.slice(21, 21 + idLen);
      const cipher = body.slice(21 + idLen);
      expect(rs).toBe(4096);
      expect(idLen).toBe(65);
      const asKey = await crypto.subtle.importKey(
        'raw',
        buf(asPublic),
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );
      const ecdh = new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, pair.privateKey, 256),
      );
      const keyInfo = new Uint8Array([
        ...encoder.encode('WebPush: info\0'),
        ...publicRaw,
        ...asPublic,
      ]);
      const ikm = await hkdf(auth, ecdh, keyInfo, 32);
      const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
      const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['decrypt']);
      const plain = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(cipher)),
      );
      expect(plain[plain.length - 1]).toBe(2);
      return decoder.decode(plain.slice(0, -1));
    },
  };
}

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = base64UrlEncode(
    new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey, privateKey: jwk.d as string, verifyKey: pair.publicKey };
}

describe('encryptPayload (RFC 8291)', () => {
  test('muatan terenkripsi dapat didekripsi penerima, termasuk karakter non-ASCII', async () => {
    const r = await receiver();
    const text = JSON.stringify({ title: 'Budi menyelesaikan task ST-1', body: 'PT Maju — ✓' });
    const body = await encryptPayload(r.sub, encoder.encode(text));
    expect(await r.decrypt(body)).toBe(text);
  });

  test('tiap pesan memakai garam dan kunci sementara baru', async () => {
    const r = await receiver();
    const a = await encryptPayload(r.sub, encoder.encode('x'));
    const b = await encryptPayload(r.sub, encoder.encode('x'));
    expect(base64UrlEncode(a.slice(0, 16))).not.toBe(base64UrlEncode(b.slice(0, 16)));
    expect(base64UrlEncode(a.slice(21, 86))).not.toBe(base64UrlEncode(b.slice(21, 86)));
  });

  test('muatan melebihi satu rekaman ditolak', async () => {
    const r = await receiver();
    await expect(
      encryptPayload(r.sub, new Uint8Array(PUSH_PAYLOAD_MAX_BYTES + 1)),
    ).rejects.toThrow();
  });
});

describe('createWebPushSender', () => {
  async function setup(
    responder: (url: string, init: RequestInit) => Response | Promise<Response>,
  ) {
    const keys = await vapidKeys();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const sender = createWebPushSender(
      {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        subject: 'mailto:ops@example.test',
      },
      {
        now: () => Date.parse('2026-11-12T00:00:00.000Z'),
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          calls.push({ url: String(url), init: init ?? {} });
          return responder(String(url), init ?? {});
        }) as typeof fetch,
      },
    );
    return { keys, calls, sender, r: await receiver() };
  }

  test('mengirim POST terenkripsi dengan header VAPID yang sah dan tanpa mengikuti pengalihan', async () => {
    const { keys, calls, sender, r } = await setup(() => new Response(null, { status: 201 }));
    const endpoint = 'https://fcm.googleapis.com/wpush/abc';
    const result = await sender.send({ endpoint, ...r.sub }, '{"title":"halo"}');
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] as (typeof calls)[number];
    expect(url).toBe(endpoint);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeDefined();
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.TTL).toBe('86400');
    // Muatan terdekripsi sama dengan yang dikirim.
    expect(await r.decrypt(new Uint8Array(init.body as ArrayBuffer))).toBe('{"title":"halo"}');
    // VAPID: token JWT ES256 yang tanda tangannya sah terhadap kunci publik.
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(
      headers.Authorization as string,
    );
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match as RegExpExecArray;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(decoder.decode(base64UrlDecode(h as string)))).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    const claims = JSON.parse(decoder.decode(base64UrlDecode(c as string))) as Record<
      string,
      unknown
    >;
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:ops@example.test');
    expect(claims.exp).toBe(Math.floor(Date.parse('2026-11-12T00:00:00.000Z') / 1000) + 12 * 3600);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.verifyKey,
      buf(base64UrlDecode(s as string)),
      buf(encoder.encode(`${h}.${c}`)),
    );
    expect(valid).toBe(true);
  });

  test('404 dan 410 = gone; status lain = gagal biasa; galat berupa teks pendek tanpa rahasia', async () => {
    for (const [status, gone] of [
      [404, true],
      [410, true],
      [429, false],
      [500, false],
    ] as const) {
      const { sender, r, keys } = await setup(() => new Response('badan-rahasia', { status }));
      const result = await sender.send(
        { endpoint: 'https://fcm.googleapis.com/x', ...r.sub },
        '{}',
      );
      expect(result).toEqual({ ok: false, gone, error: `http ${status}` });
      expect(JSON.stringify(result)).not.toContain(keys.privateKey);
      expect(JSON.stringify(result)).not.toContain('badan-rahasia');
    }
  });

  test('galat jaringan dan batas waktu dikembalikan sebagai hasil, bukan dilempar', async () => {
    const net = await setup(() => {
      throw new Error('ECONNREFUSED 10.0.0.1 dengan-kunci');
    });
    const r1 = await net.sender.send(
      { endpoint: 'https://fcm.googleapis.com/x', ...net.r.sub },
      '{}',
    );
    expect(r1).toEqual({ ok: false, gone: false, error: 'jaringan' });
    const timeout = await setup(() => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    });
    const r2 = await timeout.sender.send(
      { endpoint: 'https://fcm.googleapis.com/x', ...timeout.r.sub },
      '{}',
    );
    expect(r2).toEqual({ ok: false, gone: false, error: 'timeout' });
  });

  test('endpoint tersimpan yang tak lolos kebijakan (host di luar allowlist, IP, http) tidak pernah dihubungi', async () => {
    let calls = 0;
    const { sender, r } = await setup(() => {
      calls++;
      return new Response(null, { status: 201 });
    });
    for (const endpoint of [
      'https://evil.example.com/x',
      'https://169.254.169.254/latest/meta-data',
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.com/x',
    ]) {
      const result = await sender.send({ endpoint, ...r.sub }, '{}');
      expect(result, endpoint).toEqual({ ok: false, gone: false, error: 'endpoint ditolak' });
    }
    expect(calls).toBe(0);
  });

  test('kunci VAPID rusak menghasilkan kegagalan generik, bukan lemparan', async () => {
    const sender = createWebPushSender(
      { publicKey: 'rusak', privateKey: 'rahasia-rusak', subject: 'mailto:ops@example.test' },
      { fetch: (async () => new Response(null, { status: 201 })) as unknown as typeof fetch },
    );
    const r = await receiver();
    const result = await sender.send({ endpoint: 'https://fcm.googleapis.com/x', ...r.sub }, '{}');
    expect(result).toEqual({ ok: false, gone: false, error: 'internal' });
    expect(JSON.stringify(result)).not.toContain('rahasia-rusak');
  });
});

describe('isValidVapidKeys', () => {
  test('menerima pasangan sah dan menolak kosong, rusak, atau salah panjang', async () => {
    const keys = await vapidKeys();
    expect(isValidVapidKeys(keys.publicKey, keys.privateKey)).toBe(true);
    expect(isValidVapidKeys('', '')).toBe(false);
    expect(isValidVapidKeys('ISI_OLEH_PEMILIK', 'ISI_OLEH_PEMILIK')).toBe(false);
    expect(isValidVapidKeys(keys.publicKey, 'pendek')).toBe(false);
    expect(isValidVapidKeys('pendek', keys.privateKey)).toBe(false);
  });
});
