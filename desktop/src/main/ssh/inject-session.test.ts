import { randomBytes } from 'node:crypto';
import { renderScript, secretForms } from '@countrylock/script-template';
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

/** Potongan sandi (4 karakter) dari bentuk mana pun yang masih tampak di keluaran. */
function fragmentsLeaked(output: string, forms: readonly string[]): string[] {
  const leaked = new Set<string>();
  for (const form of forms) {
    for (let at = 0; at + 4 <= form.length; at += 1) {
      const fragment = form.slice(at, at + 4);
      if (output.includes(fragment)) leaked.add(fragment);
    }
  }
  return [...leaked];
}

describe('penyamaran sandi bentuk terescape (B1)', () => {
  /** Tidak satu pun bentuk sisipan yang boleh muncul di progres; `****` harus ada. */
  function expectMasked(progress: InjectProgress[], forms: readonly string[]): void {
    const all = progress.map((p) => p.message).join('\n');
    for (const form of forms) expect(all).not.toContain(form);
    expect(all).toContain('****');
  }

  test('Mikrotik: sandi a"b$c (escape a\\"b\\$c di echo pty) tidak muncul dalam bentuk apa pun', async () => {
    const value = 'a"b$c';
    const script = renderScript(
      'echo user=admin password="{passwordTarget}"',
      { passwordTarget: value },
      'mikrotik',
    );
    const received: string[] = [];
    const server = await fake('busybox', { onLine: (l) => received.push(l) });
    const { result, progress } = run(server, script, 'echo', { secrets: secretForms(value) });
    expect(await result).toBe(true);
    // Bukti tes menggigit: perangkat memang menerima/meng-echo bentuk terescape.
    expect(received.some((l) => l.includes('a\\"b\\$c'))).toBe(true);
    expectMasked(progress, secretForms(value));
  });

  test("Ubiquiti: sandi a b'c (dibungkus 'a b'\\''c') tidak muncul dalam bentuk apa pun", async () => {
    const value = "a b'c";
    const script = renderScript(
      'echo scp x@{passwordTarget}',
      { passwordTarget: value },
      'ubiquiti',
    );
    const received: string[] = [];
    const server = await fake('busybox', { onLine: (l) => received.push(l) });
    const { result, progress } = run(server, script, 'echo', { secrets: secretForms(value) });
    expect(await result).toBe(true);
    expect(received.some((l) => l.includes("'a b'\\''c'"))).toBe(true);
    expectMasked(progress, secretForms(value));
  });

  test('sandi yang terbelah \\r\\n pembungkus baris perangkat tetap tersamarkan', async () => {
    const value = 'Sup3r"Secr$tPass';
    const script = renderScript(
      'echo user=admin password="{passwordTarget}"',
      { passwordTarget: value },
      'mikrotik',
    );
    const server = await fake('busybox', { wrapEchoAt: 9 });
    const { result, progress } = run(server, script, 'echo', { secrets: secretForms(value) });
    expect(await result).toBe(true);
    const all = progress.map((p) => p.message).join('\n');
    for (const form of secretForms(value)) expect(all).not.toContain(form);
    // Tak ada potongan sandi yang tertinggal di sekitar pembungkus baris.
    expect(all).not.toMatch(/Sup3r|Secr|tPass/);
    expect(all).toContain('****');
  });

  test('sandi terbelah di batas potongan data (potongan ke-2, ke-3, dst.) tetap tersamarkan (N1)', async () => {
    const value = 'Sup3r"Secr$tPass';
    const script = renderScript(
      'echo user=admin password="{passwordTarget}"',
      { passwordTarget: value },
      'mikrotik',
    );
    // Ukuran potongan berbeda menggeser batas ke tempat berbeda di dalam sandi.
    for (const size of [3, 4, 7]) {
      const server = await fake('busybox', { echoChunkSize: size });
      const { result, progress } = run(server, script, 'echo', { secrets: secretForms(value) });
      expect(await result).toBe(true);
      const all = progress.map((p) => p.message).join('\n');
      for (const form of secretForms(value)) expect(all).not.toContain(form);
      expect(fragmentsLeaked(all, secretForms(value))).toEqual([]);
      expect(all).toContain('****');
    }
  });

  test('sandi terbelah \\r\\n DAN potongan data sekaligus tetap tersamarkan', async () => {
    const value = 'Sup3r"Secr$tPass';
    const script = renderScript(
      'echo user=admin password="{passwordTarget}"',
      { passwordTarget: value },
      'mikrotik',
    );
    const server = await fake('busybox', { wrapEchoAt: 6, echoChunkSize: 8 });
    const { result, progress } = run(server, script, 'echo', { secrets: secretForms(value) });
    expect(await result).toBe(true);
    const all = progress.map((p) => p.message).join('\n');
    expect(fragmentsLeaked(all, secretForms(value))).toEqual([]);
  });

  test('sandi berisi * tidak menggelembungkan progres (N2)', async () => {
    const server = await fake('busybox');
    const { result, progress } = run(server, 'echo a*b*c', 'echo', { secrets: ['*'] });
    expect(await result).toBe(true);
    for (const p of progress) expect(p.message.length).toBeLessThan(200);
    const all = progress.map((p) => p.message).join('\n');
    expect(all).toContain('a****b****c');
  });

  test('sandi pendek tidak merusak token penanda: baris penanda tidak bocor ke progres (N3)', async () => {
    // Token acak berisi huruf/angka heksadesimal; sandi `a`, `1`, `AB12` akan memotongnya bila
    // penyamaran mendahului saringan penanda.
    const server = await fake('busybox');
    for (let i = 0; i < 5; i += 1) {
      const { result, progress } = run(server, 'one\ntwo', 'echo', {
        secrets: ['a', '1', 'b', 'c', 'd', 'e', 'f', 'AB12'],
      });
      expect(await result).toBe(true);
      expect(progress.some((p) => p.message.includes('QC_INJECT'))).toBe(false);
      expect(progress.some((p) => p.message.includes('INJECT'))).toBe(false);
    }
  });
});

describe('kebijakan putus: banner dan baris pertama (A7)', () => {
  test('last-line-only: putus tepat setelah baris pertama (skrip 3 baris) → false', async () => {
    const server = await fake('busybox', { dropAfterLine: 1 });
    const { result, progress } = run(server, 'one\ntwo\nthree', 'echo', {
      dropPolicy: 'last-line-only',
    });
    expect(await result).toBe(false);
    expect(progress.at(-1)?.stage).toBe('failed');
  });

  test('banner: legacy menganggap putus segera setelah shell dibuka SUKSES (sukses palsu), last-line-only gagal', async () => {
    // Perangkat nyata (RouterOS/BusyBox) selalu mengirim banner/prompt begitu shell terbuka, jadi
    // `receivedAnyOutput` hampir selalu true: kebijakan `legacy` praktis berarti "putus kapan pun
    // = sukses" (perilaku aplikasi lama, spek §6.3). Tes ini menjaga risiko itu tetap terlihat.
    const script = 'one\ntwo\nthree';
    const withBanner = await fake('busybox', { dropAfterLine: 0, banner: '[admin@router] > ' });
    const legacy = run(withBanner, script, 'echo');
    expect(await legacy.result).toBe(true);

    const strict = run(withBanner, script, 'echo', { dropPolicy: 'last-line-only' });
    expect(await strict.result).toBe(false);

    // Tanpa banner dan tanpa keluaran: legacy pun gagal.
    const silent = await fake('busybox', { dropAfterLine: 0 });
    const bad = run(silent, script, 'echo', { timeouts: { perLineMs: 2000 } });
    expect(await bad.result).toBe(false);
  });
});

describe('kata sandi kosong dan onLineSent', () => {
  test('kata sandi sambungan kosong dapat dipakai (router bersandi kosong)', async () => {
    const server = await startFakeSshServer({ username: USER, password: '', shell: 'busybox' });
    servers.push(server);
    const { result } = run(server, 'one', 'echo', { password: '' });
    expect(await result).toBe(true);
  });

  test('onLineSent dipanggil sekali per baris skrip, sebelum baris itu ditulis', async () => {
    const order: string[] = [];
    const server = await fake('busybox', { onLine: (l) => order.push(`srv:${l}`) });
    const { result } = run(server, 'one\ntwo', 'echo', {
      onLineSent: (i) => order.push(`sent:${i}`),
    });
    expect(await result).toBe(true);
    expect(order.filter((o) => o.startsWith('sent:'))).toEqual(['sent:0', 'sent:1']);
    expect(order.indexOf('sent:0')).toBeLessThan(order.indexOf('srv:one'));
    expect(order.indexOf('sent:1')).toBeLessThan(order.indexOf('srv:two'));
  });
});
