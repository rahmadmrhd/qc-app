// Token tautan dashboard publik: terpisah dari token laporan rusak Serial Number (Review Focus 4).
import { describe, expect, test } from 'bun:test';
import { signReportToken, verifyReportToken } from '../serial/public-link';
import { signShareToken, verifyShareToken } from './share-link';

const SECRET = 'rahasia-sesi-uji-0123456789';
const SHARE_ID = '01hzx3k9m2n4p5q6r7s8t9v0wa';
const EXP = 1_800_000_000_000;

describe('token tautan dashboard', () => {
  test('round trip mengembalikan shareId', async () => {
    const token = await signShareToken(SECRET, SHARE_ID, EXP);
    expect(token.startsWith(`v1.${SHARE_ID}.`)).toBe(true);
    expect(await verifyShareToken(SECRET, token, EXP - 1000)).toEqual({ shareId: SHARE_ID });
    expect(await verifyShareToken(SECRET, token, EXP + 1000)).toBeNull();
  });

  test('token laporan Serial ditolak verifyShareToken dan sebaliknya', async () => {
    const report = await signReportToken(SECRET, SHARE_ID, EXP);
    const share = await signShareToken(SECRET, SHARE_ID, EXP);
    expect(report).not.toBe(share);
    expect(await verifyShareToken(SECRET, report, EXP - 1000)).toBeNull();
    expect(await verifyReportToken(SECRET, share, EXP - 1000)).toBeNull();
  });
});
