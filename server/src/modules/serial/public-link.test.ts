// Token tautan laporan rusak (rancangan 2026-11-14 §4.8). Murni, tanpa basis data.
import { describe, expect, test } from 'bun:test';
import { reportLinkExpiresAt } from '@shared/serials';
import { reportTokenExpiresAt, signReportToken, verifyReportToken } from './public-link';

const SECRET = 'rahasia-sesi-uji-0123456789';
const CASE_ID = '3f2c8b1e-aaaa-4bbb-8ccc-0123456789ab';
const EXP = Date.parse('2026-12-10T16:59:59.999Z');

describe('signReportToken / verifyReportToken', () => {
  test('round trip: token sah mengembalikan caseId; format v1.<id>.<detik>.<tanda tangan>', async () => {
    const token = await signReportToken(SECRET, CASE_ID, EXP);
    const parts = token.split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(parts[1]).toBe(CASE_ID);
    expect(parts[2]).toBe(String(Math.floor(EXP / 1000)));
    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(await verifyReportToken(SECRET, token, EXP - 5_000)).toEqual({ caseId: CASE_ID });
  });

  test('deterministik: token yang sama untuk masukan yang sama (kirim ulang aman)', async () => {
    expect(await signReportToken(SECRET, CASE_ID, EXP)).toBe(
      await signReportToken(SECRET, CASE_ID, EXP),
    );
  });

  test('kedaluwarsa pada detik bulat: sah sampai akhir detik itu (+999 ms), +1000 ms tidak', async () => {
    const exact = 1_800_000_000_000;
    const token = await signReportToken(SECRET, CASE_ID, exact);
    expect(await verifyReportToken(SECRET, token, exact)).toEqual({ caseId: CASE_ID });
    expect(await verifyReportToken(SECRET, token, exact + 999)).toEqual({ caseId: CASE_ID });
    expect(await verifyReportToken(SECRET, token, exact + 1000)).toBeNull();
    expect(await verifyReportToken(SECRET, token, exact - 1)).toEqual({ caseId: CASE_ID });
  });

  test('reportTokenExpiresAt membaca kedaluwarsa dari token (akhir detik terakhir yang sah)', async () => {
    const token = await signReportToken(SECRET, CASE_ID, EXP);
    expect(reportTokenExpiresAt(token)).toBe(EXP);
    expect(await verifyReportToken(SECRET, token, reportTokenExpiresAt(token))).not.toBeNull();
    expect(await verifyReportToken(SECRET, token, reportTokenExpiresAt(token) + 1)).toBeNull();
  });

  test('kedaluwarsa dengan reportLinkExpiresAt nyata: sah sampai 23:59:59.999 WIB, +1 ms sudah tidak', async () => {
    const expiresAt = reportLinkExpiresAt('2026-11-12'); // 2027-01-11 23:59:59.999 WIB (60 hari)
    expect(expiresAt).toBe(Date.UTC(2027, 0, 11, 16, 59, 59, 999));
    const token = await signReportToken(SECRET, CASE_ID, expiresAt);
    expect(await verifyReportToken(SECRET, token, expiresAt - 1)).toEqual({ caseId: CASE_ID });
    expect(await verifyReportToken(SECRET, token, expiresAt)).toEqual({ caseId: CASE_ID });
    expect(await verifyReportToken(SECRET, token, expiresAt + 1)).toBeNull(); // 00:00:00.000 WIB hari ke-61
  });

  test('tanda tangan diubah satu karakter: null', async () => {
    const token = await signReportToken(SECRET, CASE_ID, EXP);
    const last = token.slice(-1);
    const tampered = `${token.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    expect(await verifyReportToken(SECRET, tampered, EXP - 1000)).toBeNull();
  });

  test('caseId atau waktu kedaluwarsa ditukar: null', async () => {
    const token = await signReportToken(SECRET, CASE_ID, EXP);
    const [version, , exp, sig] = token.split('.');
    expect(
      await verifyReportToken(SECRET, `${version}.lain-lain.${exp}.${sig}`, EXP - 1000),
    ).toBeNull();
    const later = String(Number(exp) + 86_400);
    expect(
      await verifyReportToken(SECRET, `${version}.${CASE_ID}.${later}.${sig}`, EXP - 1000),
    ).toBeNull();
  });

  test('token laporan lain tidak menjadi token laporan ini', async () => {
    const other = await signReportToken(SECRET, 'case-lain', EXP);
    expect(await verifyReportToken(SECRET, other, EXP - 1000)).toEqual({ caseId: 'case-lain' });
    const [version, , exp, sig] = other.split('.');
    expect(
      await verifyReportToken(SECRET, `${version}.${CASE_ID}.${exp}.${sig}`, EXP - 1000),
    ).toBeNull();
  });

  test('rahasia berbeda atau kosong: null', async () => {
    const token = await signReportToken(SECRET, CASE_ID, EXP);
    expect(await verifyReportToken('rahasia-lain-0123456789', token, EXP - 1000)).toBeNull();
    expect(await verifyReportToken('', token, EXP - 1000)).toBeNull();
  });

  test('kunci tidak dipakai bersama kunci sesi: tanda tangan memakai rahasia mentah ditolak', async () => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const exp = Math.floor(EXP / 1000);
    const raw = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, encoder.encode(`v1.${CASE_ID}.${exp}`)),
    );
    const sig = btoa(String.fromCharCode(...raw))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    expect(await verifyReportToken(SECRET, `v1.${CASE_ID}.${exp}.${sig}`, EXP - 1000)).toBeNull();
  });

  test('format salah, terlalu panjang, atau versi lain: null tanpa melempar', async () => {
    const token = await signReportToken(SECRET, CASE_ID, EXP);
    const cases = [
      '',
      'abc',
      'v1.a.b',
      `${token}.ekstra`,
      token.replace(/^v1/, 'v2'),
      `v1.${CASE_ID}.abc.${token.split('.')[3]}`,
      `v1.${CASE_ID}.${Math.floor(EXP / 1000)}.pendek`,
      `v1.${'a'.repeat(100)}.${Math.floor(EXP / 1000)}.${token.split('.')[3]}`,
      `${'x'.repeat(400)}`,
      'v1..1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'v1.a b.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ];
    for (const bad of cases) {
      expect([bad.slice(0, 20), await verifyReportToken(SECRET, bad, EXP - 1000)]).toEqual([
        bad.slice(0, 20),
        null,
      ]);
    }
  });
  test('tanda tangan non-kanonis (hanya bit sisa karakter terakhir diubah) ditolak, bukan dibaca sebagai byte yang sama', async () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let index = 0; index < 20; index++) {
      const caseId = crypto.randomUUID();
      const token = await signReportToken(SECRET, caseId, EXP);
      // Karakter terakhir base64url 43 karakter membawa 4 bit berguna + 2 bit sisa: membalik bit terendah hanya
      // mengubah bit sisa, sehingga decoder yang longgar menghasilkan byte yang sama persis.
      const variant = `${token.slice(0, -1)}${alphabet[alphabet.indexOf(token.slice(-1)) ^ 1]}`;
      expect(variant).not.toBe(token);
      expect(await verifyReportToken(SECRET, variant, EXP - 1000)).toBeNull();
      expect(await verifyReportToken(SECRET, token, EXP - 1000)).toEqual({ caseId });
    }
  });
});
