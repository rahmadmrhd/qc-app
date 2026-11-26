import { describe, expect, test } from 'bun:test';
import {
  badge,
  capRows,
  cleanText,
  ctaButton,
  dataTable,
  EMAIL_HTML_MAX_BYTES,
  esc,
  fitEmail,
  kvTable,
  paragraph,
  renderEmailDocument,
  safeHref,
} from './email-layout';

export const FORBIDDEN_TAGS = /<(script|img|link|iframe|object|embed|form)\b|javascript:/i;

describe('email-layout', () => {
  test('esc membuang kontrol/bidi dan meng-escape HTML', () => {
    const out = esc('<script>"x"\u202E\u0007\nBcc: a\'&');
    expect(out).not.toContain('<');
    expect(out).not.toContain('\u202E');
    expect(out).not.toContain('\u0007');
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toContain('&lt;script&gt;&quot;x&quot;');
    expect(out).toContain('&#39;&amp;');
  });

  test('cleanText memotong dengan elipsis', () => {
    expect(cleanText('a'.repeat(300), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  test('safeHref hanya http(s) dan di-escape untuk atribut', () => {
    expect(safeHref('javascript:alert(1)')).toBe('');
    expect(safeHref('https://qc.test/a?x="1"&y=2')).toBe(
      'https://qc.test/a?x=&quot;1&quot;&amp;y=2',
    );
    expect(ctaButton('javascript:alert(1)', 'x')).toBe('');
  });

  test('dokumen: lang, preheader, color-scheme, satu style berisi @media saja, tanpa tag terlarang', () => {
    const html = renderEmailDocument({
      title: 'Judul <b>',
      preheader: 'Ringkas',
      headerBadge: { text: 'Rusak', tone: 'bad' },
      body: [
        paragraph('a\nb'),
        kvTable([{ label: 'K', value: 'V' }]),
        dataTable(
          [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
          [['1', { text: '2', href: 'https://qc.test/x' }, { badge: '3', tone: 'warn' }]],
        ),
        badge('x', 'ok'),
        ctaButton('https://qc.test/', 'Buka'),
      ],
    });
    expect(html).toContain('<html lang="id">');
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('Surel otomatis dari QC App');
    expect(html).not.toMatch(FORBIDDEN_TAGS);
    expect(html).not.toContain('Judul <b>');
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    expect(styles).toHaveLength(1);
    expect(styles[0]?.[1]).toStartWith('@media only screen and (max-width:480px){');
    expect(styles[0]?.[1]).not.toContain('}@media');
    expect(html).toContain('a<br>b');
  });

  test('capRows dan fitEmail', () => {
    expect(capRows([1, 2, 3], 2)).toEqual({ shown: [1, 2], more: 1 });
    const limits: number[] = [];
    const result = fitEmail((limit) => {
      limits.push(limit);
      return { html: 'x'.repeat(limit > 10 ? EMAIL_HTML_MAX_BYTES + 1 : 10) };
    });
    expect(limits).toEqual([50, 25, 10]);
    expect(result.html).toHaveLength(10);
  });
});
