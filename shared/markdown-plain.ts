import { stripControlChars } from './text';

/**
 * Markdown pesan kejadian menjadi teks polos yang terbaca (bahan surel teks): heading, penekanan, kode, daftar, kutipan
 * dan garis dihaluskan, tautan `[a](b)` menjadi `a (b)`, gambar dibuang dan dihitung (`imageCount`; surel hanya
 * menyebut jumlahnya). Murni dan sengaja sederhana: bukan parser Markdown penuh, tujuannya teks yang aman dan terbaca.
 * Karakter kontrol dan pengatur arah dibuang dari setiap baris (baris baru dipertahankan).
 */
export function markdownToPlain(markdown: string): { text: string; imageCount: number } {
  const source = markdown.replace(/\r\n|\r/g, '\n');
  let imageCount = 0;

  // Definisi tautan gaya rujukan (`[id]: url`) dikumpulkan lalu dibuang dari badan.
  const definitions = new Map<string, string>();
  const body = source
    .split('\n')
    .filter((line) => {
      const match = /^ {0,3}\[([^\]]+)\]:\s*(\S+).*$/.exec(line);
      if (!match) return true;
      definitions.set((match[1] ?? '').toLowerCase(), match[2] ?? '');
      return false;
    })
    .join('\n');

  let text = body
    // Gambar (inline dan gaya rujukan) dibuang dan dihitung.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, () => {
      imageCount++;
      return '';
    })
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, () => {
      imageCount++;
      return '';
    })
    // Tautan inline `[a](b)` -> `a (b)`; `[a](<b>)` memakai kurung sudut.
    .replace(/\[([^\]]+)\]\(\s*<?([^)>\s]*)>?[^)]*\)/g, (_all, label: string, url: string) =>
      url === '' ? label : `${label} (${url})`,
    )
    // Tautan gaya rujukan `[a][id]` atau `[a][]`.
    .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (_all, label: string, id: string) => {
      const url = definitions.get((id === '' ? label : id).toLowerCase());
      return url === undefined ? label : `${label} (${url})`;
    });

  const lines = text.split('\n').map((raw) => {
    let line = raw;
    // Pagar kode ``` dibuang; isinya dipertahankan sebagai teks biasa.
    if (/^\s*(```|~~~)/.test(line)) return null;
    // Garis pemisah.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return '';
    line = line.replace(/^(\s*)#{1,6}\s+(.*?)\s*#*\s*$/, '$1$2');
    line = line.replace(/^(\s*)(?:>\s?)+/, '$1');
    line = line.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1- ');
    line = line.replace(/^(\s*)[-*+]\s+/, '$1- ');
    // Penekanan, coret, dan kode sebaris.
    line = line
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1$2')
      .replace(/(^|[^\w_])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1$2')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/<\/?[A-Za-z][^>]*>/g, '');
    // Buang karakter kontrol/pengatur arah tanpa merusak indentasi daftar.
    const indent = /^[ \t]*/.exec(line)?.[0].replaceAll('\t', '  ') ?? '';
    return indent + stripControlChars(line.slice(/^[ \t]*/.exec(line)?.[0].length ?? 0));
  });

  text = lines
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, imageCount };
}
