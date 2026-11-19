import { resolve } from 'node:path';
import { hasControlChars } from '@countrylock/bridge-contract';
import { secretForms } from '@countrylock/script-template';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { createInjectRunner, type InjectRunnerDeps } from './inject-runner';
import { type LoadedPackage, loadLocalPackage } from './package/local-folder';
import { HostKeyError } from './ssh/host-key';
import type { InjectOptions, InjectOutcome } from './ssh/inject-session';
import { SENTINEL_BY_BRAND } from './ssh/strategy';

const FIXTURE = resolve(__dirname, '../../../countrylock/fixtures/country-lock2');
const SERVER_PASSWORD = 'Srv#Pw!9';
const DEVICE_PASSWORD = 'Pa$$w"rd?';

let pkg: LoadedPackage;
beforeAll(async () => {
  const real = await loadLocalPackage(FIXTURE);
  pkg = {
    ...real,
    config: { ...real.config, server: { ...real.config.server, password: SERVER_PASSWORD } },
  };
});

function setup(patch: Partial<InjectRunnerDeps> = {}, withPackage = true) {
  const deps: InjectRunnerDeps = {
    ensurePackage: vi.fn(async () => (withPackage ? pkg : null)),
    fetchHostKey: vi.fn(async () => ({ type: 'ssh-rsa', base64: 'QUFBQUhPU1RLRVk=' })),
    runInject: vi.fn(async (): Promise<InjectOutcome> => ({ ok: true, reason: 'completed' })),
    ...patch,
  };
  return { deps, runner: createInjectRunner(deps) };
}

const input = (patch: Record<string, unknown> = {}) => ({
  id: 'run-1',
  mode: 'single' as const,
  brand: 'ubiquiti' as const,
  firmwareCode: 'WA',
  target: { ip: '192.168.1.20', username: 'ubnt', password: DEVICE_PASSWORD },
  ...patch,
});

describe('createInjectRunner', () => {
  test('sukses: host key diambil (skrip memakai {sshKey}), sentinel merk, semua bentuk sandi diteruskan', async () => {
    let captured: InjectOptions | undefined;
    const { deps, runner } = setup({
      runInject: vi.fn(async (opts: InjectOptions): Promise<InjectOutcome> => {
        captured = opts;
        return { ok: true, reason: 'completed' };
      }),
    });
    const result = await runner.run(input(), new AbortController().signal);
    expect(result).toEqual({ ok: true, stage: 'completed', message: 'Inject selesai' });
    expect(deps.fetchHostKey).toHaveBeenCalledWith({
      host: '192.168.88.2',
      username: 'admin',
      password: SERVER_PASSWORD,
      signal: expect.any(AbortSignal),
    });
    expect(captured?.sentinel).toBe(SENTINEL_BY_BRAND.ubiquiti);
    expect(captured?.host).toBe('192.168.1.20');
    expect(captured?.script).toContain('QUFBQUhPU1RLRVk=');
    for (const form of secretForms(DEVICE_PASSWORD)) expect(captured?.secrets).toContain(form);
    expect(captured?.secrets).toContain(SERVER_PASSWORD);
  });

  test('progres dibersihkan (ANSI dibuang, sandi disamarkan) sebelum emitProgress dan onProgress', async () => {
    const emitted: Array<{ id: string; stage: string; message: string }> = [];
    const progressed: string[] = [];
    const { runner } = setup({
      emitProgress: (e) => emitted.push(e),
      runInject: vi.fn(async (opts: InjectOptions): Promise<InjectOutcome> => {
        const escaped = secretForms(DEVICE_PASSWORD)[1] ?? DEVICE_PASSWORD;
        opts.onProgress({ stage: 'sending', message: `\u001b[31mkirim ${escaped}\u001b[0m` });
        opts.onProgress({ stage: 'running', message: `Pa$$w\u001b[0m"rd? dan ${SERVER_PASSWORD}` });
        return { ok: true, reason: 'completed' };
      }),
    });
    await runner.run(input(), new AbortController().signal, (m) => progressed.push(m));
    expect(emitted).toHaveLength(2);
    for (const event of emitted) {
      expect(event.id).toBe('run-1');
      expect(hasControlChars(event.message)).toBe(false);
      expect(event.message).not.toContain('Pa$$w');
      expect(event.message).not.toContain(SERVER_PASSWORD);
    }
    expect(emitted[1]?.message).toBe('**** dan ****');
    expect(progressed).toEqual(emitted.map((e) => e.message));
  });

  test('Mikrotik: tanpa {sshKey} host key tidak diambil; hasil gagal dipetakan tanpa sandi', async () => {
    const { deps, runner } = setup({
      runInject: vi.fn(async (opts: InjectOptions): Promise<InjectOutcome> => {
        expect(opts.sentinel).toBe('put');
        return { ok: false, reason: 'auth' };
      }),
    });
    const result = await runner.run(
      input({ brand: 'mikrotik', firmwareCode: 'AC' }),
      new AbortController().signal,
    );
    expect(deps.fetchHostKey).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      stage: 'failed',
      message: 'Perangkat menolak kredensial',
    });
  });

  test('dibatalkan dipetakan ke stage cancelled', async () => {
    const { runner } = setup({
      runInject: vi.fn(async (): Promise<InjectOutcome> => ({ ok: false, reason: 'cancelled' })),
    });
    expect(await runner.run(input(), new AbortController().signal)).toEqual({
      ok: false,
      stage: 'cancelled',
      message: 'Inject dibatalkan',
    });
  });

  test('paket belum dipilih, firmware tak dikenal, skrip hilang, dan host key gagal menjadi hasil failed', async () => {
    const none = setup({}, false);
    expect(await none.runner.run(input(), new AbortController().signal)).toEqual({
      ok: false,
      stage: 'failed',
      message: 'Paket skrip belum dipilih',
    });

    const unknown = setup();
    const r1 = await unknown.runner.run(
      input({ firmwareCode: 'TIDAK-ADA' }),
      new AbortController().signal,
    );
    expect(r1.ok).toBe(false);
    expect(r1.message).toContain('TIDAK-ADA');
    expect(unknown.deps.runInject).not.toHaveBeenCalled();

    const missingScript = setup({
      ensurePackage: async () => ({ ...pkg, scripts: {} }),
    });
    const r2 = await missingScript.runner.run(input(), new AbortController().signal);
    expect(r2.ok).toBe(false);
    expect(r2.message).toContain('WA.txt');
    expect(missingScript.deps.runInject).not.toHaveBeenCalled();

    const hk = setup({
      fetchHostKey: vi.fn(async () => {
        throw new HostKeyError('AUTH', 'Kredensial router ditolak');
      }),
    });
    expect(await hk.runner.run(input(), new AbortController().signal)).toEqual({
      ok: false,
      stage: 'failed',
      message: 'Kredensial router ditolak',
    });
    expect(hk.deps.runInject).not.toHaveBeenCalled();
  });

  test('dibatalkan saat mengambil host key = stage cancelled (bukan gagal), tanpa menjalankan skrip', async () => {
    const abort = new AbortController();
    const { deps, runner } = setup({
      fetchHostKey: vi.fn(async (opts: { signal?: AbortSignal }) => {
        abort.abort();
        expect(opts.signal).toBe(abort.signal);
        throw new HostKeyError('UNREACHABLE', 'Dibatalkan');
      }),
    });
    expect(await runner.run(input(), abort.signal)).toEqual({
      ok: false,
      stage: 'cancelled',
      message: 'Inject dibatalkan',
    });
    expect(deps.runInject).not.toHaveBeenCalled();
  });

  test('galat tak terduga tidak membocorkan sandi', async () => {
    const { runner } = setup({
      runInject: vi.fn(async () => {
        throw new Error(`ssh gagal dengan ${DEVICE_PASSWORD}`);
      }),
    });
    const result = await runner.run(input(), new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      stage: 'failed',
      message: 'Terjadi galat saat menyiapkan inject',
    });
  });

  test('signal diteruskan ke eksekutor (pembatalan dari pemanggil)', async () => {
    let seen: AbortSignal | undefined;
    const { runner } = setup({
      runInject: vi.fn(async (opts: InjectOptions): Promise<InjectOutcome> => {
        seen = opts.signal;
        return { ok: true, reason: 'completed' };
      }),
    });
    const controller = new AbortController();
    await runner.run(input(), controller.signal);
    expect(seen).toBe(controller.signal);
  });

  test("mode 'multi' mengabaikan connectVia: menyambung ke IP perangkat walau merk disetel Server", async () => {
    let captured: InjectOptions | undefined;
    const serverVia = {
      ...pkg,
      config: {
        ...pkg.config,
        brands: {
          ...pkg.config.brands,
          ubiquiti: {
            ...(pkg.config.brands.ubiquiti as NonNullable<typeof pkg.config.brands.ubiquiti>),
            single: {
              ...(pkg.config.brands.ubiquiti as NonNullable<typeof pkg.config.brands.ubiquiti>)
                .single,
              connectVia: 'Server' as const,
            },
            multi: {
              ...(pkg.config.brands.ubiquiti as NonNullable<typeof pkg.config.brands.ubiquiti>)
                .multi,
              connectVia: 'Server' as const,
            },
          },
        },
      },
    };
    const { runner } = setup({
      ensurePackage: async () => serverVia,
      runInject: vi.fn(async (opts: InjectOptions): Promise<InjectOutcome> => {
        captured = opts;
        return { ok: true, reason: 'completed' };
      }),
    });
    await runner.run(input({ mode: 'multi' }), new AbortController().signal);
    expect(captured?.host).toBe('192.168.1.20');
    expect(captured?.username).toBe('ubnt');
    // Mode tunggal pada konfigurasi yang sama menyambung lewat server.
    await runner.run(input({ mode: 'single' }), new AbortController().signal);
    expect(captured?.host).toBe('192.168.88.2');
  });
});
