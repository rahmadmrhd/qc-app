import { describe, expect, test } from 'bun:test';
import { handoverCanonicalText, handoverUnescapeText } from './handover-text';

describe('handover-text', () => {
  test('membuang escape backslash dan mendekode entitas', () => {
    expect(handoverCanonicalText('RB\\_5009\\_X = 1 unit')).toBe('RB_5009_X = 1 unit');
    expect(handoverCanonicalText('Kabel UTP &amp; konektor = 2 pcs')).toBe(
      'Kabel UTP & konektor = 2 pcs',
    );
    expect(handoverCanonicalText('a &lt; b &gt; c &quot;d&quot; &#39;e&#39; &#x41;')).toBe(
      'a < b > c "d" \'e\' A',
    );
    expect(handoverCanonicalText('2\\*3 = 6 \\[promo\\]')).toBe('2*3 = 6 [promo]');
  });

  test('nbsp dan spasi ganda dirapikan; entitas tak dikenal dibiarkan', () => {
    expect(handoverCanonicalText('  A&nbsp;&nbsp;B   C ')).toBe('A B C');
    expect(handoverCanonicalText('&bukanentitas; &#0;')).toBe('&bukanentitas; &#0;');
  });

  test('bentuk mentah dan hasil serializer menghasilkan teks kanonis sama', () => {
    expect(handoverCanonicalText('J&T Merah')).toBe(handoverCanonicalText('J&amp;T Merah'));
  });

  test('handoverUnescapeText tidak merapikan spasi', () => {
    expect(handoverUnescapeText('a  b')).toBe('a  b');
  });
});
