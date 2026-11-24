import { describe, expect, test } from 'vitest';
import { parseQcUrl } from './qc-url';

describe('parseQcUrl', () => {
  test('qc://country-lock → /country-lock', () => {
    expect(parseQcUrl('qc://country-lock')).toEqual({ route: '/country-lock' });
    expect(parseQcUrl('qc://country-lock/')).toEqual({ route: '/country-lock' });
  });

  test('skema atau host lain dan jalur tambahan ditolak', () => {
    for (const bad of [
      'https://country-lock',
      'app://qc/country-lock',
      'qc://lain',
      'qc://country-lock/../x',
      'qc://country-lock/sub',
      'qc://country-lock?x=1',
      'qc://country-lock#frag',
      'qc://user@country-lock',
      'qc://country-lock:99',
      'qc://country-lock.evil.com',
      'qc:country-lock',
      '',
      'bukan url',
    ]) {
      expect(parseQcUrl(bad), bad).toBeNull();
    }
  });
});

describe('parseQcUrl: qc://auth', () => {
  const code = 'eyJ0eXAiOiJkY29kZSJ9.abc-DEF_123';
  const state = 'abcdefgh12345678';

  test('qc://auth?code=&state= sah → { route: null, auth }', () => {
    expect(parseQcUrl(`qc://auth?code=${code}&state=${state}`)).toEqual({
      route: null,
      auth: { code, state },
    });
    expect(parseQcUrl(`qc://auth/?state=${state}&code=${code}`)?.auth).toEqual({ code, state });
  });

  test('qc://auth?error=&state= dengan kode dari daftar tetap → { route: null, authError }', () => {
    expect(parseQcUrl(`qc://auth?error=NOT_WHITELISTED&state=${state}`)).toEqual({
      route: null,
      authError: { error: 'NOT_WHITELISTED', state },
    });
    expect(parseQcUrl(`qc://auth/?state=${state}&error=LOGIN_FAILED`)?.authError).toEqual({
      error: 'LOGIN_FAILED',
      state,
    });
  });

  test('error: kode di luar daftar, kunci tambahan/ganda, state tak sah, jalur, hash ditolak', () => {
    for (const bad of [
      `qc://auth?error=APA_SAJA&state=${state}`,
      `qc://auth?error=login_failed&state=${state}`,
      `qc://auth?error=%3Cscript%3E&state=${state}`,
      'qc://auth?error=LOGIN_FAILED',
      'qc://auth?error=LOGIN_FAILED&state=pendek',
      `qc://auth?error=LOGIN_FAILED&state=${state}&x=1`,
      `qc://auth?error=LOGIN_FAILED&error=NOT_WHITELISTED&state=${state}`,
      `qc://auth?error=LOGIN_FAILED&code=${code}&state=${state}`,
      `qc://auth/x?error=LOGIN_FAILED&state=${state}`,
      `qc://auth?error=LOGIN_FAILED&state=${state}#h`,
    ]) {
      expect(parseQcUrl(bad), bad).toBeNull();
    }
  });

  test('query kelebihan/kurang/ganda, kode atau state di luar pola, jalur, hash ditolak', () => {
    for (const bad of [
      'qc://auth',
      'qc://auth?code=abc',
      `qc://auth?state=${state}`,
      `qc://auth?code=${code}&state=${state}&x=1`,
      `qc://auth?code=${code}&code=${code}&state=${state}`,
      `qc://auth?code=&state=${state}`,
      `qc://auth?code=${code}&state=pendek`,
      `qc://auth?code=${code}&state=${'a'.repeat(129)}`,
      `qc://auth?code=${code}&state=abc def12345`,
      `qc://auth?code=${'a'.repeat(1025)}&state=${state}`,
      'qc://auth?code=a%2Fb&state=abcdefgh12',
      'qc://auth?code=a=b&state=abcdefgh12',
      'qc://auth?code=a%20b&state=abcdefgh12',
      `qc://auth/x?code=${code}&state=${state}`,
      `qc://auth?code=${code}&state=${state}#h`,
      `qc://user@auth?code=${code}&state=${state}`,
      `qc://AUTH?code=${code}&state=${state}`,
      `app://qc/auth?code=${code}&state=${state}`,
    ]) {
      expect(parseQcUrl(bad), bad).toBeNull();
    }
  });
});

describe('parseQcUrl: qc://country-lock?handoff', () => {
  const ticket = `${'a'.repeat(40)}.${'B'.repeat(43)}`;

  test('handoff dengan atau tanpa petunjuk email sah', () => {
    expect(parseQcUrl(`qc://country-lock?handoff=${ticket}`)).toEqual({
      route: '/country-lock',
      handoff: { ticket, hint: null },
    });
    expect(parseQcUrl(`qc://country-lock/?as=rina%40qc.local&handoff=${ticket}`)).toEqual({
      route: '/country-lock',
      handoff: { ticket, hint: 'rina@qc.local' },
    });
  });

  test('kunci lain/ganda, tanpa handoff, tiket atau email di luar pola, hash ditolak', () => {
    for (const bad of [
      'qc://country-lock?as=a%40b.co',
      `qc://country-lock?handoff=${ticket}&x=1`,
      `qc://country-lock?handoff=${ticket}&handoff=${ticket}`,
      `qc://country-lock?handoff=${ticket}&as=a%40b.co&as=c%40d.co`,
      'qc://country-lock?handoff=pendek',
      `qc://country-lock?handoff=${'a'.repeat(40)}`,
      `qc://country-lock?handoff=${ticket}x%20y`,
      `qc://country-lock?handoff=${'a'.repeat(1000)}.${'B'.repeat(43)}`,
      `qc://country-lock?handoff=${ticket}&as=bukan-email`,
      `qc://country-lock?handoff=${ticket}&as=a%20b%40c.co`,
      `qc://country-lock?handoff=${ticket}&as=%3Cscript%3E%40x.co`,
      `qc://country-lock?handoff=${ticket}&as=${'a'.repeat(70)}%40b.co`,
      `qc://country-lock?handoff=${ticket}#h`,
      `qc://country-lock/sub?handoff=${ticket}`,
    ]) {
      expect(parseQcUrl(bad), bad).toBeNull();
    }
  });
});
