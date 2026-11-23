// Penanda tautan bertanda tangan generik. Murni, tanpa basis data.
import { describe, expect, test } from 'bun:test';
import { createLinkSigner } from './signed-link';

const SECRET = 'rahasia-sesi-uji-0123456789';
const ID = '01hzx3k9m2n4p5q6r7s8t9v0wa';
const EXP = 1_800_000_000_000;
const signer = createLinkSigner('qc:uji-penanda:v1');

describe('createLinkSigner', () => {
  test('round trip: token sah mengembalikan id; format v1.<id>.<detik>.<tanda tangan>', async () => {
    const token = await signer.sign(SECRET, ID, EXP);
    const parts = token.split('.');
    expect(parts).toHaveLength(4);
    expect(parts.slice(0, 3)).toEqual(['v1', ID, String(EXP / 1000)]);
    expect(await signer.verify(SECRET, token, EXP - 5_000)).toEqual({ id: ID });
  });

  test('tanda tangan diubah satu karakter: null', async () => {
    const token = await signer.sign(SECRET, ID, EXP);
    const last = token.slice(-1);
    const tampered = `${token.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    expect(await signer.verify(SECRET, tampered, EXP - 1000)).toBeNull();
  });

  test('sah sampai exp*1000+999 ms, tidak sah pada +1000 ms', async () => {
    const token = await signer.sign(SECRET, ID, EXP);
    expect(await signer.verify(SECRET, token, EXP + 999)).toEqual({ id: ID });
    expect(await signer.verify(SECRET, token, EXP + 1000)).toBeNull();
  });

  test('tanda tangan non-kanonis (hanya bit sisa karakter terakhir) ditolak', async () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let index = 0; index < 20; index++) {
      const token = await signer.sign(SECRET, `id-${index}`, EXP);
      const variant = `${token.slice(0, -1)}${alphabet[alphabet.indexOf(token.slice(-1)) ^ 1]}`;
      expect(variant).not.toBe(token);
      expect(await signer.verify(SECRET, variant, EXP - 1000)).toBeNull();
    }
  });

  test('panjang lebih dari 300 karakter: null', async () => {
    const token = await signer.sign(SECRET, ID, EXP);
    expect(await signer.verify(SECRET, `${token}${'x'.repeat(300)}`, EXP - 1000)).toBeNull();
  });

  test('rahasia kosong atau berbeda: null', async () => {
    const token = await signer.sign(SECRET, ID, EXP);
    expect(await signer.verify('', token, EXP - 1000)).toBeNull();
    expect(await signer.verify('rahasia-lain-0123456789', token, EXP - 1000)).toBeNull();
  });

  test('label berbeda = kunci berbeda: token satu penanda ditolak penanda lain', async () => {
    const other = createLinkSigner('qc:uji-penanda-lain:v1');
    const token = await signer.sign(SECRET, ID, EXP);
    expect(await other.verify(SECRET, token, EXP - 1000)).toBeNull();
    expect(await signer.verify(SECRET, await other.sign(SECRET, ID, EXP), EXP - 1000)).toBeNull();
  });
});
