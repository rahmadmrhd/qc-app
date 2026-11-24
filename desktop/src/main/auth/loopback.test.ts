import { request } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { AUTH_ERROR_MESSAGES, LOGIN_SUCCESS_TITLE, type Loopback, startLoopback } from './loopback';

const CODE = 'eyJ0eXAiOiJkY29kZSJ9.abc-DEF_123';
const STATE = 'state-uji-1234';

let active: Loopback | null = null;
afterEach(() => {
  active?.close();
  active = null;
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** `http.request` (bukan fetch) agar header Host dapat diatur. */
function get(port: number, path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<Reply>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function open(onCallback: (code: string, state: string) => Promise<boolean>) {
  const calls: { code: string; state: string }[] = [];
  const lb = await startLoopback({
    timeoutMs: 60_000,
    onCallback: async (code, state) => {
      calls.push({ code, state });
      return onCallback(code, state);
    },
  });
  active = lb;
  return { lb, calls };
}

describe('startLoopback: galat login dari server', () => {
  async function openWithError(handled: boolean) {
    const errors: { error: string; state: string }[] = [];
    const shown: boolean[] = [];
    let called = 0;
    const lb = await startLoopback({
      timeoutMs: 60_000,
      onCallback: async () => {
        called++;
        return true;
      },
      onError: async (error, state) => {
        errors.push({ error, state });
        return handled;
      },
      onShown: (ok) => shown.push(ok),
    });
    active = lb;
    return { lb, errors, shown, called: () => called };
  }

  test('error dari daftar tetap + state cocok: halaman pesan khusus, tanpa mengulang state dari URL', async () => {
    const { lb, errors, shown, called } = await openWithError(true);
    const reply = await get(lb.port, `/callback?error=NOT_WHITELISTED&state=${STATE}`);
    expect(errors).toEqual([{ error: 'NOT_WHITELISTED', state: STATE }]);
    expect(called()).toBe(0);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('Login gagal');
    expect(reply.body).toContain(AUTH_ERROR_MESSAGES.NOT_WHITELISTED);
    expect(reply.body).not.toContain(STATE);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['referrer-policy']).toBe('no-referrer');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shown).toEqual([false]);
  });

  test('LOGIN_FAILED memakai pesannya sendiri', async () => {
    const { lb } = await openWithError(true);
    const reply = await get(lb.port, `/callback?error=LOGIN_FAILED&state=${STATE}`);
    expect(reply.body).toContain(AUTH_ERROR_MESSAGES.LOGIN_FAILED);
    expect(reply.body).not.toContain(AUTH_ERROR_MESSAGES.NOT_WHITELISTED);
  });

  test('state asing (tak ditangani): 404, tanpa halaman pesan', async () => {
    const { lb, errors } = await openWithError(false);
    const reply = await get(lb.port, `/callback?error=NOT_WHITELISTED&state=${STATE}`);
    expect(errors).toHaveLength(1);
    expect(reply.status).toBe(404);
    expect(reply.body).toBe('Not Found');
  });

  test('kode di luar daftar atau bentuk lain: 404 tanpa memanggil penangan', async () => {
    const { lb, errors } = await openWithError(true);
    for (const path of [
      `/callback?error=APA_SAJA&state=${STATE}`,
      `/callback?error=%3Cb%3Ex&state=${STATE}`,
      '/callback?error=LOGIN_FAILED',
      `/callback?error=LOGIN_FAILED&state=${STATE}&extra=1`,
      `/callback?error=LOGIN_FAILED&code=${CODE}&state=${STATE}`,
    ]) {
      const reply = await get(lb.port, path);
      expect(reply.status, path).toBe(404);
    }
    expect(errors).toEqual([]);
  });
});

describe('startLoopback', () => {
  test('callback sah: meneruskan code/state, menampilkan halaman berhasil dengan header ketat', async () => {
    const { lb, calls } = await open(async () => true);
    const reply = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`);
    expect(calls).toEqual([{ code: CODE, state: STATE }]);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('Login berhasil');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['referrer-policy']).toBe('no-referrer');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(String(reply.headers['content-security-policy'])).toMatch(/default-src 'none'.*nonce-/);
    expect(reply.body).not.toContain(CODE);
  });

  test('penukaran gagal: halaman gagal (kode tak dicetak)', async () => {
    const { lb } = await open(async () => false);
    const reply = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('Login gagal');
    expect(reply.body).not.toContain(CODE);
  });

  test('bentuk lain ditolak 404 tanpa memanggil penangan: jalur, metode, kunci tambahan/ganda, nilai tak sah', async () => {
    const { lb, calls } = await open(async () => true);
    const paths = [
      '/',
      '/callback/x',
      '/Callback',
      `/auth/callback?code=${CODE}&state=${STATE}`,
      `/callback?code=${CODE}`,
      `/callback?state=${STATE}`,
      `/callback?code=${CODE}&state=${STATE}&extra=1`,
      `/callback?code=${CODE}&code=${CODE}&state=${STATE}`,
      `/callback?code=${CODE}&state=pendek`,
      '/callback?code=%00&state=state-uji-1234',
      `/callback?code=${'a'.repeat(1025)}&state=${STATE}`,
    ];
    for (const path of paths) {
      const reply = await get(lb.port, path);
      expect(reply.status, path).toBe(404);
    }
    const post = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`, {}, 'POST');
    expect(post.status).toBe(404);
    expect(calls).toEqual([]);
  });

  test('Host selain 127.0.0.1:<port> ditolak (DNS rebinding)', async () => {
    const { lb, calls } = await open(async () => true);
    for (const host of [
      'evil.example',
      `localhost:${lb.port}`,
      `127.0.0.1:${lb.port + 1}`,
      '127.0.0.1',
    ]) {
      const reply = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`, { Host: host });
      expect(reply.status, host).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  test('close() menutup port; timeout menutup sendiri', async () => {
    const { lb } = await open(async () => true);
    lb.close();
    await expect(get(lb.port, '/')).rejects.toThrow();

    const short = await startLoopback({ timeoutMs: 50, onCallback: async () => true });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(get(short.port, '/')).rejects.toThrow();
  });

  test('penangan melempar: 500 tanpa membocorkan isi', async () => {
    const { lb } = await open(async () => {
      throw new Error('rahasia internal');
    });
    const reply = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`);
    expect(reply.status).toBe(500);
    expect(reply.body).not.toContain('rahasia');
  });
});

describe('onShown dan judul halaman', () => {
  test('onShown(true) dipanggil SETELAH respons terkirim, dengan judul yang dikenali penutup jendela', async () => {
    const shown: boolean[] = [];
    const lb = await startLoopback({
      timeoutMs: 60_000,
      onCallback: async () => true,
      onShown: (ok) => shown.push(ok),
    });
    active = lb;
    const reply = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`);
    expect(reply.body).toContain(`<title>${LOGIN_SUCCESS_TITLE}</title>`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown).toEqual([true]);
  });

  test('gagal: onShown(false); permintaan 404 tidak memicu onShown', async () => {
    const shown: boolean[] = [];
    const lb = await startLoopback({
      timeoutMs: 60_000,
      onCallback: async () => false,
      onShown: (ok) => shown.push(ok),
    });
    active = lb;
    await get(lb.port, '/tidak-ada');
    await get(lb.port, `/callback?code=${CODE}&state=${STATE}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown).toEqual([false]);
  });
});
