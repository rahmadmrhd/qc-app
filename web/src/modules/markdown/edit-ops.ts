export interface TextSelection {
  start: number;
  end: number;
}

export interface EditResult {
  text: string;
  selection: TextSelection;
}

/** Bungkus pilihan dengan `before`/`after`; tanpa pilihan, sisipkan `placeholder` dan pilih isinya. */
export function wrapSelection(
  text: string,
  selection: TextSelection,
  before: string,
  after: string = before,
  placeholder = 'teks',
): EditResult {
  const selected = text.slice(selection.start, selection.end) || placeholder;
  const next =
    text.slice(0, selection.start) + before + selected + after + text.slice(selection.end);
  const start = selection.start + before.length;
  return { text: next, selection: { start, end: start + selected.length } };
}

/** Beri awalan pada setiap baris yang tersentuh pilihan (judul, daftar, kutipan). */
export function prefixLines(
  text: string,
  selection: TextSelection,
  prefix: (index: number) => string,
): EditResult {
  const lineStart = selection.start === 0 ? 0 : text.lastIndexOf('\n', selection.start - 1) + 1;
  const searchFrom =
    selection.end > selection.start && text[selection.end - 1] === '\n'
      ? selection.end - 1
      : selection.end;
  const newline = text.indexOf('\n', searchFrom);
  const lineEnd = newline === -1 ? text.length : newline;
  const replaced = text
    .slice(lineStart, lineEnd)
    .split('\n')
    .map((line, index) => prefix(index) + line)
    .join('\n');
  return {
    text: text.slice(0, lineStart) + replaced + text.slice(lineEnd),
    selection: { start: lineStart, end: lineStart + replaced.length },
  };
}

export function insertAtCursor(
  text: string,
  selection: TextSelection,
  insertion: string,
): EditResult {
  const caret = selection.start + insertion.length;
  return {
    text: text.slice(0, selection.start) + insertion + text.slice(selection.end),
    selection: { start: caret, end: caret },
  };
}
