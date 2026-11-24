import { TableCell, TableHeader } from '@tiptap/extension-table';

/**
 * Batas `colspan`/`rowspan` sel tabel. Markdown tersimpan boleh memuat HTML mentah (`<td colspan="200000">`);
 * tampilan tabel dan peta sel membuat satu elemen/iterasi per satuan span, jadi nilai tak dibatasi
 * membekukan editor bagi siapa pun yang membukanya. Tabel nyata tak pernah butuh sebanyak ini.
 */
export const TABLE_SPAN_MAX = 20;

/** Angka span dari atribut HTML: bukan bilangan positif = 1, selebihnya dijepit ke `TABLE_SPAN_MAX`. */
export function clampSpan(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, TABLE_SPAN_MAX);
}

/** `TableCell` Tiptap dengan `colspan`/`rowspan` yang dijepit saat HTML diurai (muat Markdown dan tempel). */
export const SafeTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: {
        default: 1,
        parseHTML: (el: HTMLElement) => clampSpan(el.getAttribute('colspan')),
      },
      rowspan: {
        default: 1,
        parseHTML: (el: HTMLElement) => clampSpan(el.getAttribute('rowspan')),
      },
    };
  },
});

/** `TableHeader` Tiptap dengan batas span yang sama dengan `SafeTableCell`. */
export const SafeTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: {
        default: 1,
        parseHTML: (el: HTMLElement) => clampSpan(el.getAttribute('colspan')),
      },
      rowspan: {
        default: 1,
        parseHTML: (el: HTMLElement) => clampSpan(el.getAttribute('rowspan')),
      },
    };
  },
});
