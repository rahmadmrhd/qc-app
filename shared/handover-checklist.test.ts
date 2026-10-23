import { describe, expect, test } from 'bun:test';
import {
  extractChecklist,
  matchChecks,
  normalizeNoteChecks,
  reconcileChecks,
} from './handover-checklist';

const chk = (text: string, occurrence = 0) => ({
  text,
  by: 'u1',
  at: '2026-10-23T00:00:00Z',
  occurrence,
});

describe('handover-checklist', () => {
  test('extractChecklist mengambil butir tingkat atas dan mengabaikan yang bersarang', () => {
    expect(extractChecklist('- [ ] A\n- [x] B\nteks\n  - [ ] bersarang')).toEqual([
      { index: 0, text: 'A' },
      { index: 1, text: 'B' },
    ]);
    expect(normalizeNoteChecks('- [x] B')).toBe('- [ ] B');
    expect(normalizeNoteChecks('- [X] B\n  - [x] C\nteks')).toBe('- [ ] B\n  - [x] C\nteks');
  });

  test('reconcileChecks mempertahankan centang saat diurutkan ulang', () => {
    const r = reconcileChecks('- [ ] A\n- [ ] B', [chk('B')], '- [ ] B\n- [ ] A');
    expect(r.checks).toEqual([chk('B')]);
    expect(r.removed).toEqual([]);
    expect(r.resets).toEqual([]);
  });

  test('reconcileChecks: duplikat bertulisan sama', () => {
    const r = reconcileChecks('- [ ] X\n- [ ] X', [chk('X')], '- [ ] X\n- [ ] Y');
    expect(r.checks).toEqual([chk('X')]);
    expect(r.resets).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  test('reconcileChecks: edit mereset, hapus ditolak', () => {
    const edit = reconcileChecks('- [ ] RD = 8', [chk('RD = 8')], '- [ ] RD = 9');
    expect(edit.resets).toEqual([{ from: 'RD = 8', to: 'RD = 9' }]);
    expect(edit.checks).toEqual([]);
    expect(edit.removed).toEqual([]);

    const hapus = reconcileChecks('- [ ] A\n- [ ] RD = 8', [chk('RD = 8')], '- [ ] A');
    expect(hapus.removed).toEqual(['RD = 8']);
    expect(hapus.resets).toEqual([]);
    expect(hapus.checks).toEqual([]);

    const paragraf = reconcileChecks('- [ ] RD = 8', [chk('RD = 8')], 'RD = 8');
    expect(paragraf.removed).toEqual(['RD = 8']);
  });

  test('reconcileChecks: butir lama lain yang naik posisi bukan hasil sunting', () => {
    const r = reconcileChecks('- [ ] RD = 8\n- [ ] A', [chk('RD = 8')], '- [ ] A');
    expect(r.removed).toEqual(['RD = 8']);
    expect(r.resets).toEqual([]);
  });

  test('matchChecks: hanya butir kembar kedua yang tercentang', () => {
    const note = '- [ ] X\n- [ ] X';
    expect(matchChecks(note, [chk('X', 1)])).toEqual([null, chk('X', 1)]);
  });

  test('reconcileChecks: centang butir kembar kedua tetap menempel setelah ditukar', () => {
    const baru = '- [ ] Y\n- [ ] X\n- [ ] X';
    const r = reconcileChecks('- [ ] X\n- [ ] Y\n- [ ] X', [chk('X', 1)], baru);
    expect(r.checks).toEqual([chk('X', 1)]);
    expect(r.removed).toEqual([]);
    expect(r.resets).toEqual([]);
    expect(matchChecks(baru, r.checks)).toEqual([null, null, chk('X', 1)]);
  });

  test('matchChecks sejajar dengan extractChecklist', () => {
    const note = '- [ ] A\n- [ ] B\n- [ ] A';
    expect(matchChecks(note, [chk('B')])).toEqual([null, chk('B'), null]);
    expect(matchChecks(note, [chk('A')])).toEqual([chk('A'), null, null]);
    expect(matchChecks(note, [chk('A'), chk('A', 1)])).toEqual([chk('A'), null, chk('A', 1)]);
  });
});

describe('handover-checklist: bentuk kanonis (mentah vs hasil serializer)', () => {
  test('extractChecklist memberi teks kanonis', () => {
    expect(
      extractChecklist('- [ ] RB\\_5009\\_X = 1 unit\n- [ ] Kabel UTP &amp; konektor = 2 pcs'),
    ).toEqual([
      { index: 0, text: 'RB_5009_X = 1 unit' },
      { index: 1, text: 'Kabel UTP & konektor = 2 pcs' },
    ]);
  });

  test('centang tetap saat catatan mentah disimpan ulang versi ter-escape dengan suntingan lain', () => {
    const mentah = '- [ ] RB_5009_X = 1 unit\n- [ ] Kabel UTP & konektor = 2 pcs';
    const diserialkan =
      'kirim sore\n\n- [ ] RB\\_5009\\_X = 1 unit\n- [ ] Kabel UTP &amp; konektor = 2 pcs';
    const centang = [chk('RB_5009_X = 1 unit'), chk('Kabel UTP & konektor = 2 pcs')];
    const r = reconcileChecks(mentah, centang, diserialkan);
    expect(r.checks).toEqual(centang);
    expect(r.resets).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(matchChecks(diserialkan, centang)).toEqual(centang);
  });

  test('urut ulang butir ter-escape tidak menghasilkan removed palsu', () => {
    const mentah = '- [ ] RB_5009_X = 1 unit\n- [ ] B = 2 unit';
    const diserialkan = '- [ ] B = 2 unit\n- [ ] RB\\_5009\\_X = 1 unit';
    const r = reconcileChecks(mentah, [chk('RB_5009_X = 1 unit')], diserialkan);
    expect(r.removed).toEqual([]);
    expect(r.resets).toEqual([]);
    expect(r.checks).toEqual([chk('RB_5009_X = 1 unit')]);
  });
});
