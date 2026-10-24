import { expect, test } from 'bun:test';
import { matchChecks, reconcileChecks } from './handover-checklist';
import { handoverNormalizeAnchorText } from './handover-comments';
import { splitWhatsappBatch } from './handover-paste';

function elapsed(run: () => void): number {
  const start = Date.now();
  run();
  return Date.now() - start;
}

test('M-B: baris sangat panjang diproses linear (judul bertanda baca akhir)', () => {
  const ms = elapsed(() => splitWhatsappBatch(`${':'.repeat(150000)}x\nA = 1`));
  expect(ms).toBeLessThan(1000);
});

test('M-B: awalan WhatsApp dengan spasi sangat panjang diproses linear', () => {
  const ms = elapsed(() => splitWhatsappBatch(`[1/1, 1.00]${' '.repeat(150000)}x\nA = 1`));
  expect(ms).toBeLessThan(1000);
});

test('M-B: hasil pecah tetap benar untuk judul bertanda baca akhir', () => {
  expect(splitWhatsappBatch('PT Maju -,;: \nA = 1')).toEqual([
    { customerSuggestion: 'PT Maju', note: '- [ ] A = 1' },
  ]);
});

const stored = (text: string) => ({ text, by: 'u', at: 't', occurrence: 0 });

test('M-C: centang tersimpan non-kanonis tetap cocok dan tidak yatim', () => {
  const note = '- [ ] RB\\_5009\\_X = 1 unit\n- [ ] Kabel &amp; konektor';
  const checks = [stored('RB\\_5009\\_X = 1 unit'), stored('Kabel &amp; konektor')];
  const matched = matchChecks(note, checks);
  expect(matched[0]).not.toBeNull();
  expect(matched[1]).not.toBeNull();
  const r = reconcileChecks(note, checks, `${note}\n- [ ] baru`);
  expect(r.removed).toEqual([]);
  expect(r.checks).toHaveLength(2);
});

test('M-G: nbsp dinormalkan', () => {
  expect(handoverNormalizeAnchorText(`a${String.fromCharCode(160)}b`)).toBe('a b');
});
