import { describe, expect, test } from 'bun:test';
import { addCredential, credentialAt, credentialSource, nextCredentialIndex } from './credentials';
import type { Credential } from './types';

const base: Credential = { username: 'ubnt', password: 'ubnt' };
const q1: Credential = { username: 'admin', password: 'a1' };
const q2: Credential = { username: 'admin', password: 'a2' };

describe('credentialAt', () => {
  test('indeks 0 = default, i = antrean[i-1], di luar itu null', () => {
    expect(credentialAt(0, base, [q1, q2])).toEqual(base);
    expect(credentialAt(1, base, [q1, q2])).toEqual(q1);
    expect(credentialAt(2, base, [q1, q2])).toEqual(q2);
    expect(credentialAt(3, base, [q1, q2])).toBeNull();
    expect(credentialAt(1, base, [])).toBeNull();
    expect(credentialAt(-1, base, [q1])).toBeNull();
    expect(credentialAt(0.5, base, [q1])).toBeNull();
  });
});

describe('credentialSource', () => {
  test('Default atau Antrian #N', () => {
    expect(credentialSource(0)).toBe('Default');
    expect(credentialSource(1)).toBe('Antrian #1');
    expect(credentialSource(4)).toBe('Antrian #4');
  });
});

describe('nextCredentialIndex', () => {
  test('maju satu sampai antrean habis (null)', () => {
    expect(nextCredentialIndex(0, 2)).toBe(1);
    expect(nextCredentialIndex(1, 2)).toBe(2);
    expect(nextCredentialIndex(2, 2)).toBeNull();
    expect(nextCredentialIndex(0, 0)).toBeNull();
  });
});

describe('addCredential', () => {
  test('menambah ke ujung dan tidak mengubah antrean masukan', () => {
    const queue: Credential[] = [q1];
    const next = addCredential(queue, q2);
    expect(next).toEqual([q1, q2]);
    expect(queue).toEqual([q1]);
  });

  test('duplikat username+password ditolak (antrean yang sama dikembalikan)', () => {
    const queue = [q1];
    expect(addCredential(queue, { ...q1 })).toBe(queue);
    expect(addCredential(queue, { username: 'admin', password: 'beda' })).toHaveLength(2);
  });

  test('sama dengan kredensial default tidak dianggap duplikat antrean (default dicoba lebih dulu)', () => {
    expect(addCredential([], base)).toEqual([base]);
  });

  test('username atau sandi kosong ditolak', () => {
    const queue = [q1];
    expect(addCredential(queue, { username: '', password: 'x' })).toBe(queue);
    expect(addCredential(queue, { username: '   ', password: 'x' })).toBe(queue);
    expect(addCredential(queue, { username: 'x', password: '' })).toBe(queue);
  });
});
