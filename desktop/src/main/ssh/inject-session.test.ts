import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { type FakeSshServer, startFakeSshServer } from '../../../test-support/fake-ssh-server';
import {
  type InjectOptions,
  type InjectProgress,
  maskSecrets,
  runInject,
  sentinelCommand,
} from './inject-session';

// Kredensial acak per proses tes; tidak ada kata sandi nyata di repo.
const USER = 'admin';
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;

const servers: FakeSshServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function fake(
  shell: 'busybox' | 'routeros',
  extra: Partial<Parameters<typeof startFakeSshServer>[0]> = {},
): Promise<FakeSshServer> {
  const server = await startFakeSshServer({
    username: USER,
    password: PASSWORD,
    shell,
    ...extra,
  });
  servers.push(server);
  return server;
}

function run(
  server: FakeSshServer,
  script: string,
  sentinel: InjectOptions['sentinel'],
  extra: Partial<InjectOptions> = {},
) {
  const progress: InjectProgress[] = [];
  const result = runInject({
    host: '127.0.0.1',
    port: server.port,
    username: USER,
    password: PASSWORD,
    script,
    sentinel,
    onProgress: (p) => progress.push(p),
    ...extra,
  });
  return { result, progress };
}

const SENTINEL_LINE = /^(echo|:put) __QC_INJECT_[0-9a-f]{8}__$/;

describe('sentinelCommand dan maskSecrets', () => {
  test('sentinelCommand: echo atau :put', () => {
    expect(sentinelCommand('echo', '__T__')).toBe('echo __T__');
    expect(sentinelCommand('put', '__T__')).toBe(':put __T__');
  });

  test('maskSecrets mengganti semua kemunculan, mendahulukan rahasia terpanjang, abaikan kosong', () => {
    expect(maskSecrets('pw abc abcdef abc', ['abc', 'abcdef', ''])).toBe('pw **** **** ****');
    expect(maskSecrets('tanpa rahasia', [])).toBe('tanpa rahasia');
  });
});

describe('runInject', () => {
  test('baris dikirim satu per satu; baris berikutnya hanya setelah penanda muncul dua kali', async () => {
    const received: { text: string; at: number }[] = [];
    const server = await fake('busybox', {
      onLine: (text) => received.push({ text, at: performance.now() }),
    });
    const { result } = run(server, 'sleep 300\ntouch a\ntouch b', 'echo', {
      timeouts: { perLineMs: 5000 },
    });
    expect(await result).toBe(true);

    // Urutan penerimaan: tiap baris skrip langsung diikuti penandanya sendiri.
    const texts = received.map((r) => r.text);
    expect(texts).toHaveLength(6);
    expect(texts.filter((t) => !SENTINEL_LINE.test(t))).toEqual([
      'sleep 300',
      'touch a',
      'touch b',
    ]);
    texts.forEach((t, i) => {
      expect(SENTINEL_LINE.test(t)).toBe(i % 2 === 1);
    });
    expect(new Set(texts.filter((t) => SENTINEL_LINE.test(t))).size).toBe(3);

    // `sleep 300` menahan shell: baris berikutnya tidak boleh tiba sebelum itu tuntas.
    const sleepAt = received[0]?.at ?? 0;
    const touchAAt = received[2]?.at ?? 0;
    expect(touchAAt - sleepAt).toBeGreaterThanOrEqual(250);
  });

  test('busybox + echo: skrip tiga baris selesai true dan tahap completed', async () => {
    const server = await fake('busybox');
    const { result, progress } = run(server, 'uname\nls /tmp\nsync', 'echo');
    expect(await result).toBe(true);
    const stages = progress.map((p) => p.stage);
    expect(stages[0]).toBe('connecting');
    expect(stages).toContain('sending');
    expect(stages.at(-1)).toBe('completed');
    // Baris penanda tidak bocor ke log.
    expect(progress.some((p) => p.message.includes('__QC_INJECT_'))).toBe(false);
  });

  test('routeros + echo gagal timeout per baris; routeros + put selesai', async () => {
    const server = await fake('routeros');
    const bad = run(server, ':put a', 'echo', { timeouts: { perLineMs: 700 } });
    expect(await bad.result).toBe(false);
    expect(bad.progress.at(-1)?.stage).toBe('failed');

    const good = run(server, ':put a\n:put b', 'put', { timeouts: { perLineMs: 3000 } });
    expect(await good.result).toBe(true);
    expect(good.progress.at(-1)?.stage).toBe('completed');
  });

  test('baris kosong dilewati', async () => {
    const lines: string[] = [];
    const server = await fake('busybox', { onLine: (l) => lines.push(l) });
    const { result } = run(server, 'one\r\n\r\n   \n\ntwo\n', 'echo');
    expect(await result).toBe(true);
    expect(lines.filter((l) => !SENTINEL_LINE.test(l))).toEqual(['one', 'two']);
  });

  test('perLineMs habis → false dan tahap failed', async () => {
    const server = await fake('busybox');
    const started = Date.now();
    const { result, progress } = run(server, 'sleep 3000', 'echo', {
      timeouts: { perLineMs: 300 },
    });
    expect(await result).toBe(false);
    expect(Date.now() - started).toBeLessThan(2500);
    const last = progress.at(-1);
    expect(last?.stage).toBe('failed');
    expect(last?.message).toMatch(/timeout/i);
  });

  test('overallMs membatasi total walau tiap baris di bawah perLineMs', async () => {
    const server = await fake('busybox');
    const { result, progress } = run(server, 'sleep 250\nsleep 250\nsleep 250', 'echo', {
      timeouts: { perLineMs: 5000, overallMs: 400 },
    });
    expect(await result).toBe(false);
    expect(progress.at(-1)?.stage).toBe('failed');
  });

  test('legacy: koneksi putus setelah ada output → true; putus tanpa output → false', async () => {
    const script = 'one\ntwo\nthree';
    const afterOutput = await fake('busybox', { dropAfterLine: 1 });
    const ok = run(afterOutput, script, 'echo');
    expect(await ok.result).toBe(true);
    expect(ok.progress.at(-1)?.stage).toBe('completed');

    const silent = await fake('busybox', { dropAfterLine: 0 });
    const bad = run(silent, script, 'echo', { timeouts: { perLineMs: 2000 } });
    expect(await bad.result).toBe(false);
    expect(bad.progress.at(-1)?.stage).toBe('failed');
  });

  test('last-line-only: putus pada baris sebelum terakhir → false; putus pada baris terakhir → true', async () => {
    const script = 'one\ntwo\nthree';
    const early = await fake('busybox', { dropAfterLine: 2 });
    const bad = run(early, script, 'echo', { dropPolicy: 'last-line-only' });
    expect(await bad.result).toBe(false);
    expect(bad.progress.at(-1)?.stage).toBe('failed');

    const last = await fake('busybox', { dropAfterLine: 3 });
    const ok = run(last, script, 'echo', { dropPolicy: 'last-line-only' });
    expect(await ok.result).toBe(true);
    expect(ok.progress.at(-1)?.stage).toBe('completed');
  });

  test('signal abort → false, tahap cancelled, tanpa pengecualian lolos', async () => {
    const server = await fake('busybox');
    const controller = new AbortController();
    const { result, progress } = run(server, 'sleep 5000', 'echo', { signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    await expect(result).resolves.toBe(false);
    expect(progress.at(-1)?.stage).toBe('cancelled');

    const pre = new AbortController();
    pre.abort();
    const again = run(server, 'one', 'echo', { signal: pre.signal });
    await expect(again.result).resolves.toBe(false);
    expect(again.progress.at(-1)?.stage).toBe('cancelled');
  });

  test('kredensial salah → false dengan pesan Permission denied tanpa kata sandi', async () => {
    const server = await fake('busybox');
    const { result, progress } = run(server, 'one', 'echo', { password: 'salah-sandi' });
    expect(await result).toBe(false);
    const last = progress.at(-1);
    expect(last?.stage).toBe('failed');
    expect(last?.message).toContain('Permission denied');
    expect(last?.message).not.toContain('salah-sandi');
  });

  test('host tak terjangkau → false dan failed, tanpa pengecualian', async () => {
    const server = await fake('busybox');
    const port = server.port;
    await server.close();
    servers.length = 0;
    const progress: InjectProgress[] = [];
    const ok = await runInject({
      host: '127.0.0.1',
      port,
      username: USER,
      password: PASSWORD,
      script: 'one',
      sentinel: 'echo',
      timeouts: { connectMs: 1500 },
      onProgress: (p) => progress.push(p),
    });
    expect(ok).toBe(false);
    expect(progress.at(-1)?.stage).toBe('failed');
  });

  test('kata sandi tidak muncul di pesan progres (maskSecrets)', async () => {
    const extra = `rahasia-tambahan-${randomBytes(4).toString('hex')}`;
    const server = await fake('busybox');
    // Fake meng-echo ketikan dan keluaran `echo`: kata sandi akan kembali sebagai log.
    const { result, progress } = run(server, `echo ${PASSWORD}\necho ${extra}`, 'echo', {
      secrets: [extra],
    });
    expect(await result).toBe(true);
    const all = progress.map((p) => p.message).join('\n');
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain(extra);
    expect(all).toContain('****');
  });
});
