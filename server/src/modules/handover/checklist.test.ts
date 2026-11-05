import { describe, expect, test } from 'bun:test';
import { extractChecklist, matchChecks } from '@shared/handover-checklist';
import { checklistOf, matchedChecks } from './checklist';

describe('memo butir checklist', () => {
  test('hasil sama dengan extractChecklist dan instans dipakai ulang untuk catatan yang sama', () => {
    const note = '- [ ] A\n- [ ] B\n- [ ] A';
    const first = checklistOf(note);
    expect(first).toEqual(extractChecklist(note));
    expect(checklistOf(note)).toBe(first);
    // isi berbeda = kunci berbeda: tidak pernah basi
    expect(checklistOf(`${note}\n- [ ] C`)).toHaveLength(4);
  });

  test('dibatasi (memori isolate kecil): ratusan catatan berbeda tetap benar', () => {
    for (let n = 0; n < 200; n++) {
      const note = `- [ ] butir ${n}`;
      expect(checklistOf(note)).toEqual([{ index: 0, text: `butir ${n}` }]);
    }
    // catatan awal sudah terusir tetapi dihitung ulang dengan benar
    expect(checklistOf('- [ ] butir 0')).toEqual([{ index: 0, text: 'butir 0' }]);
  });

  test('matchedChecks setara matchChecks', () => {
    const note = '- [ ] A\n- [ ] A\n- [ ] B';
    const checks = [
      { text: 'A', by: 'u', at: 't', occurrence: 1 },
      { text: 'B', by: 'u', at: 't', occurrence: 0 },
    ];
    expect(matchedChecks(note, checks)).toEqual(matchChecks(note, checks));
  });
});
