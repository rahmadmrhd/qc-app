import { describe, expect, test } from 'bun:test';
import { locateAnchor, makeAnchor, noteToPlainText } from './handover-comments';

describe('handover-comments', () => {
  test('noteToPlainText membuang penanda Markdown', () => {
    expect(noteToPlainText('**tebal** dan *miring*\n\n- [ ] Router A = 2')).toBe(
      'tebal dan miring\nRouter A = 2',
    );
    expect(noteToPlainText('Kirim 😀 ~~batal~~')).toBe('Kirim 😀 batal');
  });

  test('anchor: kutipan berulang memilih kemunculan yang dipilih', () => {
    const plain = 'kirim sore. kirim sore.';
    const start = plain.lastIndexOf('kirim sore');
    const anchor = makeAnchor(plain, start, start + 'kirim sore'.length);
    expect(locateAnchor(plain, anchor)).toEqual({ start, end: start + 10 });
  });

  test('anchor usang dan kutipan unik dengan konteks berubah', () => {
    const plain = 'halo dunia, kirim sore ya';
    const s = plain.indexOf('kirim sore');
    const anchor = makeAnchor(plain, s, s + 10);
    expect(anchor.before.length).toBeLessThanOrEqual(20);
    expect(anchor.after.length).toBeLessThanOrEqual(20);
    expect(locateAnchor('halo dunia, kirim pagi ya', anchor)).toBeNull();
    const geser = 'sama sekali beda. kirim sore tapi lain';
    const t = geser.indexOf('kirim sore');
    expect(locateAnchor(geser, anchor)).toEqual({ start: t, end: t + 10 });
  });
});

describe('handover-comments: escape dan entitas', () => {
  test('noteToPlainText mendekode entitas HTML dan nbsp', () => {
    expect(noteToPlainText('kirim via J&amp;T Merah')).toBe('kirim via J&T Merah');
    expect(noteToPlainText('Port &lt;24V&gt; a&nbsp;b')).toBe('Port <24V> a b');
    expect(noteToPlainText('- [ ] RB\\_5009\\_X = 1 unit')).toBe('RB_5009_X = 1 unit');
  });

  test('kutipan J&T, < dan > ditemukan pada catatan ter-escape', () => {
    const note = 'kirim via J&amp;T Merah, Port &lt;24V&gt;';
    const plain = noteToPlainText(note);
    for (const quote of ['J&T', '<24V>']) {
      const start = plain.indexOf(quote);
      const anchor = makeAnchor(plain, start, start + quote.length);
      expect(locateAnchor(plain, anchor)).toEqual({ start, end: start + quote.length });
    }
  });
});
