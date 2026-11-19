import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { type FakeSshServer, startFakeSshServer } from '../../../test-support/fake-ssh-server';
import { fetchHostKey, HostKeyError } from './host-key';

const USER = 'admin';
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;

const servers: FakeSshServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function fake(hostKeyType?: 'rsa' | 'ed25519'): Promise<FakeSshServer> {
  const server = await startFakeSshServer({
    username: USER,
    password: PASSWORD,
    shell: 'routeros',
    ...(hostKeyType ? { hostKeyType } : {}),
  });
  servers.push(server);
  return server;
}

/** Bagian blob kunci publik SSH: urutan string berawalan panjang uint32. */
function blobFields(base64: string): string[] {
  const blob = Buffer.from(base64, 'base64');
  const fields: string[] = [];
  let offset = 0;
  while (offset < blob.length) {
    const length = blob.readUInt32BE(offset);
    fields.push(blob.subarray(offset + 4, offset + 4 + length).toString('hex'));
    offset += 4 + length;
  }
  return fields;
}

describe('fetchHostKey', () => {
  test('mengembalikan ssh-rsa dan base64 yang sama dengan kunci server palsu', async () => {
    const server = await fake();
    const key = await fetchHostKey({
      host: '127.0.0.1',
      port: server.port,
      username: USER,
      password: PASSWORD,
    });
    expect(key.type).toBe('ssh-rsa');
    expect(key.base64).toBe(server.hostKeyBase64);

    // Blob RSA: [nama "ssh-rsa", eksponen e, modulus n]; n 2048 bit = 256 byte (+1 byte nol di depan).
    const [name, e, n] = blobFields(key.base64);
    expect(Buffer.from(name ?? '', 'hex').toString('ascii')).toBe('ssh-rsa');
    expect(e).toBe('010001');
    expect((n ?? '').length / 2).toBe(257);
  });

  test('kunci non-RSA melempar NOT_RSA', async () => {
    const server = await fake('ed25519');
    const error = await fetchHostKey({
      host: '127.0.0.1',
      port: server.port,
      username: USER,
      password: PASSWORD,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostKeyError);
    expect((error as HostKeyError).code).toBe('NOT_RSA');
    expect((error as HostKeyError).hostKeyType).toBe('ssh-ed25519');
  });

  test('host tak terjangkau melempar UNREACHABLE dalam timeout', async () => {
    const server = await fake();
    const port = server.port;
    await server.close();
    servers.length = 0;
    const refused = await fetchHostKey({
      host: '127.0.0.1',
      port,
      username: USER,
      password: PASSWORD,
      timeoutMs: 1500,
    }).catch((e: unknown) => e);
    expect((refused as HostKeyError).code).toBe('UNREACHABLE');

    // Alamat dokumentasi (TEST-NET-1) tak pernah menjawab: timeout harus memutus tepat waktu.
    const started = Date.now();
    const silent = await fetchHostKey({
      host: '192.0.2.1',
      username: USER,
      password: PASSWORD,
      timeoutMs: 600,
    }).catch((e: unknown) => e);
    expect((silent as HostKeyError).code).toBe('UNREACHABLE');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('signal yang dibatalkan memutus pengambilan seketika (sebelum maupun sesudah mulai)', async () => {
    const server = await fake();
    const pre = new AbortController();
    pre.abort();
    const preError = await fetchHostKey({
      host: '127.0.0.1',
      port: server.port,
      username: USER,
      password: PASSWORD,
      signal: pre.signal,
    }).catch((e: unknown) => e);
    expect(preError).toBeInstanceOf(HostKeyError);
    expect((preError as HostKeyError).message).toBe('Dibatalkan');

    const live = new AbortController();
    const pending = fetchHostKey({
      host: '192.0.2.1',
      username: USER,
      password: PASSWORD,
      timeoutMs: 30_000,
      signal: live.signal,
    }).catch((e: unknown) => e);
    const started = Date.now();
    live.abort();
    const error = await pending;
    expect((error as HostKeyError).message).toBe('Dibatalkan');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('kredensial salah melempar AUTH', async () => {
    const server = await fake();
    const error = await fetchHostKey({
      host: '127.0.0.1',
      port: server.port,
      username: USER,
      password: 'bukan-sandi-yang-benar',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostKeyError);
    expect((error as HostKeyError).code).toBe('AUTH');
    expect((error as HostKeyError).message).not.toContain('bukan-sandi-yang-benar');
  });
});
