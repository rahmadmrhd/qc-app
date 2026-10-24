import { beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { handleBridge_ } from '@bridge/dispatch';
import { setBridgePlatform_ } from '@bridge/platform';
import {
  createMemoryBridgePlatform,
  type MemoryBridgePlatform,
  TEST_BRIDGE_SECRET,
} from '@bridge-test/memory-platform';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import { createBridgeClient } from './bridge-client';
import { isAppError } from './errors';

let env: TestEnv;
let platform: MemoryBridgePlatform;
let requests: Array<{ url: string; init: RequestInit; body: string }>;

/** fetch yang meneruskan ke jembatan sungguhan (handleBridge_) dengan platform memori. */
function bridgeFetch(): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body);
    requests.push({ url: String(url), init: init ?? {}, body });
    platform.setNow(env.clock.now());
    return new Response(handleBridge_(body), { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  env = await createTestEnv({ BRIDGE_SECRET: TEST_BRIDGE_SECRET });
  platform = createMemoryBridgePlatform({
    now: env.clock.now(),
    properties: { ALLOWED_FOLDER_IDS: 'F1', SPREADSHEET_ID: 'SS' },
  });
  platform.addFolder('F1');
  setBridgePlatform_(platform);
  requests = [];
});

function client(fetchImpl: typeof fetch = bridgeFetch(), options = {}) {
  return createBridgeClient(env, fetchImpl, options);
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('diharapkan galat');
}

describe('uji silang dengan verifier jembatan', () => {
  test('unggah, baca, info, folderExists, trash lewat jembatan sungguhan', async () => {
    const c = client();
    const id = await c.createFile('F1', 'a.txt', 'text/plain', 'SGFsbyBkdW5pYQ==');
    expect(platform.files.get(id)).toMatchObject({ parents: ['F1'], base64: 'SGFsbyBkdW5pYQ==' });
    expect(await c.readFile(id, 'F1')).toEqual({ mime: 'text/plain', base64: 'SGFsbyBkdW5pYQ==' });
    expect(await c.fileInfo(id, 'F1')).toEqual({ mime: 'text/plain', size: 10 });
    expect(await c.folderExists('F1')).toBe(true);
    expect(await c.readFile('tidak-ada', 'F1')).toBeNull();
    await c.trashFile(id);
    expect(await c.fileInfo(id, 'F1')).toBeNull();
    await c.trashFile('hilang');
  });

  test('semua aksi lain: rename, share, revoke, replace, copy, external', async () => {
    const c = client();
    const id = await c.createFile('F1', 'a', 'a/b', 'QUJD');
    await c.renameFile(id, 'baru');
    await c.shareAnyoneWithLink(id);
    expect(platform.files.get(id)).toMatchObject({ name: 'baru', shared: true });
    await c.revokeSharing(id);
    await c.replaceFileContent(id, 'x/y', 'WFla');
    expect(platform.files.get(id)).toMatchObject({ shared: false, mime: 'x/y', base64: 'WFla' });
    platform.external.set('ext', { name: 'sumber.pdf', mime: 'application/pdf', base64: 'UERG' });
    expect(await c.externalFileInfo('ext')).toEqual({
      name: 'sumber.pdf',
      mime: 'application/pdf',
      size: 3,
    });
    expect(await c.readExternalFile('ext')).toEqual({ mime: 'application/pdf', base64: 'UERG' });
    expect(await c.externalFileInfo('nope')).toBeNull();
    const copy = await c.copyFile('ext', 'F1', 'salinan.pdf');
    expect(platform.files.get(copy)?.parents).toEqual(['F1']);
    expect(typeof (await c.createFolder('Baru'))).toBe('string');
  });

  test('sheets: export replace+append lalu dump', async () => {
    const book = new Map<string, string[][]>([['brands', [['id'], ['b1']]]]);
    platform.sheets.set('SS', book);
    const c = client();
    await c.sheetsExport({ sheet: 'export_x', columns: ['a'], rows: [['1']], mode: 'replace' });
    await c.sheetsExport({ sheet: 'export_x', columns: ['a'], rows: [['2']], mode: 'append' });
    expect(book.get('export_x')).toEqual([['a'], ['1'], ['2']]);
    expect(await c.sheetsDump()).toEqual({ brands: [['id'], ['b1']] });
  });

  test('tanda tangan = HMAC-SHA256 hex WebCrypto = node:crypto; ts dari jam terkendali', async () => {
    env.clock.set(Date.parse('2026-10-25T10:00:00.000Z'));
    await client().folderExists('F1');
    const request = requests[0] as (typeof requests)[number];
    const parsed = JSON.parse(request.body) as {
      action: string;
      ts: number;
      sig: string;
      payload: unknown;
    };
    expect(parsed.ts).toBeGreaterThanOrEqual(env.clock.now());
    const expected = createHmac('sha256', TEST_BRIDGE_SECRET)
      .update(`${parsed.action}.${parsed.ts}.${JSON.stringify(parsed.payload)}`)
      .digest('hex');
    expect(parsed.sig).toBe(expected);
    expect(request.url).toBe('https://bridge.test/exec');
    expect(request.init.redirect).toBe('follow');
    expect(request.init.method).toBe('POST');
  });

  test('rahasia berbeda ditolak jembatan -> galat akses UNAVAILABLE, bukan "tidak ada"', async () => {
    const wrong = createBridgeClient({ ...env, BRIDGE_SECRET: 'salah'.repeat(10) }, bridgeFetch());
    const error = await failure(wrong.readFile('x', 'F1'));
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toContain('ditolak');
  });

  test('berkas bukan anak folder (penolakan seragam jembatan) -> galat akses, bukan null', async () => {
    platform.addFolder('F2');
    platform.addFile('orphan', { parents: ['F2'], base64: 'QUJD' });
    const error = await failure(client().readFile('orphan', 'F1'));
    expect(error.code).toBe('UNAVAILABLE');
  });

  test('NOT_FOUND jembatan menjadi NOT_FOUND; VALIDATION menjadi VALIDATION', async () => {
    expect((await failure(client().renameFile('hilang', 'n'))).code).toBe('NOT_FOUND');
    expect((await failure(client().createFolder(''))).code).toBe('VALIDATION');
  });

  test('galat Drive tak terduga di jembatan -> UNAVAILABLE', async () => {
    platform.driveCopyFile = () => {
      throw new Error('kuota');
    };
    expect((await failure(client().copyFile('x', 'F1', 'n'))).code).toBe('UNAVAILABLE');
  });
});

describe('badan besar tanpa parse/decode', () => {
  function spyJson() {
    const parse = JSON.parse;
    const stringify = JSON.stringify;
    const seen = { parse: [] as number[], stringify: [] as number[] };
    JSON.parse = ((text: string, reviver?: never) => {
      seen.parse.push(String(text).length);
      return parse(text, reviver);
    }) as typeof JSON.parse;
    JSON.stringify = ((value: unknown, ...rest: never[]) => {
      const out = (stringify as (v: unknown, ...r: unknown[]) => string)(value, ...rest);
      seen.stringify.push(out?.length ?? 0);
      return out;
    }) as typeof JSON.stringify;
    return {
      seen,
      restore: () => {
        JSON.parse = parse;
        JSON.stringify = stringify;
      },
    };
  }

  test('unggah 540 KB: badan disambung sebagai string; tidak ada JSON.parse/stringify atas base64', async () => {
    const base64 = 'QUJD'.repeat(138_240); // 552.960 karakter
    const bodies: string[] = [];
    const stub = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response('{"ok":true,"data":{"id":"f-1"}}');
    }) as unknown as typeof fetch;
    const spy = spyJson();
    let id: string;
    try {
      id = await client(stub).createFile('F1', 'besar.bin', 'a/b', base64);
    } finally {
      spy.restore();
    }
    expect(id).toBe('f-1');
    expect(Math.max(0, ...spy.seen.stringify)).toBeLessThan(1000);
    expect(Math.max(0, ...spy.seen.parse)).toBeLessThan(1000);
    expect(bodies[0]?.length).toBeGreaterThan(base64.length);
    const body = JSON.parse(bodies[0] as string) as {
      payload: { base64: string; folderId: string };
    };
    expect(body.payload.base64).toBe(base64);
    expect(body.payload.folderId).toBe('F1');
  });

  test('baca 1 MB: balasan diiris tanpa JSON.parse atas base64', async () => {
    const base64 = 'QUJD'.repeat(262_144); // 1.048.576
    const stub = (async () =>
      new Response(
        `{"ok":true,"data":{"mime":"image/png","base64":"${base64}"}}`,
      )) as unknown as typeof fetch;
    const spy = spyJson();
    let file: Awaited<ReturnType<ReturnType<typeof client>['readFile']>>;
    try {
      file = await client(stub).readFile('f', 'F1');
    } finally {
      spy.restore();
    }
    expect(file?.mime).toBe('image/png');
    expect(file?.base64.length).toBe(base64.length);
    expect(Math.max(0, ...spy.seen.parse)).toBeLessThan(1000);
  });

  test('base64 melebihi batas jembatan ditolak dengan pesan jelas sebelum dikirim', async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const error = await failure(client(stub).createFile('F1', 'a', 'a/b', 'QUJD'.repeat(260_000)));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('terlalu besar');
    expect(calls).toBe(0);
  });

  test('base64 mengandung kutip ditolak sebelum dikirim', async () => {
    const stub = (async () => new Response('{}')) as unknown as typeof fetch;
    expect((await failure(client(stub).createFile('F1', 'a', 'a/b', 'AB"CD'))).code).toBe(
      'VALIDATION',
    );
  });

  test('1 MB round-trip lewat jembatan sungguhan', async () => {
    const base64 = 'QUJD'.repeat(240_000);
    const c = client();
    const id = await c.createFile('F1', 'besar.bin', 'a/b', base64);
    expect((await c.readFile(id, 'F1'))?.base64.length).toBe(base64.length);
  });
});

describe('jaringan', () => {
  test('percobaan ulang idempoten menandatangani ulang dengan ts baru dan sig berbeda', async () => {
    const stub = (async (_url: unknown, init?: RequestInit) => {
      requests.push({ url: '', init: init ?? {}, body: String(init?.body) });
      if (requests.length === 1) throw new TypeError('network down');
      return new Response('{"ok":true,"data":{"exists":true}}');
    }) as unknown as typeof fetch;
    expect(await client(stub).folderExists('F1')).toBe(true);
    expect(requests).toHaveLength(2);
    const [a, b] = requests.map((r) => JSON.parse(r.body) as { ts: number; sig: string });
    expect(b?.ts).toBeGreaterThan(a?.ts as number);
    expect(b?.sig).not.toBe(a?.sig);
  });

  test('ts menaik walau jam terkendali tidak bergerak', async () => {
    const c = client();
    await c.folderExists('F1');
    await c.folderExists('F1');
    const ts = requests.map((r) => (JSON.parse(r.body) as { ts: number }).ts);
    expect(ts[1]).toBeGreaterThan(ts[0] as number);
  });

  test('aksi tidak idempoten (createFile, append) tidak diulang', async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const error = await failure(client(stub).createFile('F1', 'a', 'a/b', 'QUJD'));
    expect(error.code).toBe('UNAVAILABLE');
    expect(calls).toBe(1);
    await failure(
      client(stub).sheetsExport({ sheet: 'export_a', columns: ['a'], rows: [], mode: 'append' }),
    );
    expect(calls).toBe(2);
  });

  test('habis percobaan ulang -> UNAVAILABLE dengan pesan jelas', async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const error = await failure(client(stub).fileInfo('x', 'F1'));
    expect(calls).toBe(2);
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toContain('tidak dapat dihubungi');
  });

  test('timeout -> UNAVAILABLE yang menyebut batas waktu', async () => {
    const stub = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const error = await failure(client(stub, { timeoutMs: 20, retries: 0 }).folderExists('F1'));
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toContain('batas waktu');
  });

  test('HTTP 500, HTML, dan JSON tak dikenal -> UNAVAILABLE', async () => {
    for (const make of [
      () => new Response('boom', { status: 500 }),
      () => new Response('<html>Error 411</html>'),
      () => new Response('{"foo":1}'),
    ]) {
      const stub = (async () => make()) as unknown as typeof fetch;
      const error = await failure(client(stub, { retries: 0 }).folderExists('F1'));
      expect(error.code).toBe('UNAVAILABLE');
    }
  });
});
