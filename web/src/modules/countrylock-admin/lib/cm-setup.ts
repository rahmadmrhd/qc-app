import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import {
  HighlightStyle,
  StreamLanguage,
  type StreamParser,
  syntaxHighlighting,
} from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import type { Compartment, Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { CodeLanguage } from './language';

/** Penyorot skrip RouterOS (`.rsc`): komentar `#`, string, variabel `$x`, `{placeholder}`, jalur menu `/ip ...`, `kunci=`. */
const routerOsParser: StreamParser<unknown> = {
  name: 'routeros',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.eat('"')) {
      let escaped = false;
      for (let next = stream.next(); next != null; next = stream.next()) {
        if (next === '"' && !escaped) break;
        escaped = !escaped && next === '\\';
      }
      return 'string';
    }
    if (stream.match(/^\{[A-Za-z0-9_]+\}/)) return 'atom';
    if (stream.match(/^\$[A-Za-z0-9_]+/)) return 'variableName';
    if (stream.match(/^\/[A-Za-z0-9_\-/]*/)) return 'keyword';
    if (stream.match(/^[A-Za-z][A-Za-z0-9_-]*(?==)/)) return 'propertyName';
    if (stream.match(/^\d+(\.\d+)*/)) return 'number';
    stream.next();
    return null;
  },
};

/** Warna sintaks memakai token tema aplikasi (terang/gelap otomatis), bukan palet tetap. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--success-text)' },
  { tag: [tags.keyword, tags.operatorKeyword], color: 'var(--info-text)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--warning-text)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--foreground)', fontWeight: '600' },
  {
    tag: [tags.variableName, tags.definition(tags.variableName)],
    color: 'var(--destructive-text)',
  },
  { tag: tags.invalid, color: 'var(--destructive-text)' },
]);

const theme = EditorView.theme({
  '&': {
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
    fontSize: '13px',
  },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--muted) 60%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--accent)' },
  '&.cm-focused': { outline: '2px solid var(--ring)' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--info-text) 30%, transparent)',
  },
});

function languageExtension(language: CodeLanguage): Extension {
  if (language === 'json') return json();
  if (language === 'sh') return StreamLanguage.define(shell);
  if (language === 'rsc') return StreamLanguage.define(routerOsParser);
  return [];
}

/** Ekstensi dasar bersama editor dan diff: tema, sorotan, bahasa, dan perilaku baca-saja. */
export function baseExtensions(language: CodeLanguage, readOnly: boolean): Extension[] {
  return [
    theme,
    syntaxHighlighting(highlightStyle),
    languageExtension(language),
    lineNumbers(),
    EditorView.lineWrapping,
    EditorView.editable.of(!readOnly),
    ...(readOnly ? [EditorView.contentAttributes.of({ 'aria-readonly': 'true' })] : []),
  ];
}

/** Ekstensi khusus penyunting (riwayat undo, kursor, pintasan). */
export function editingExtensions(): Extension[] {
  return [
    history(),
    drawSelection(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  ];
}

/** Gelap/terang mengikuti kelas `dark` di `<html>` (ditulis `modules/theme`). */
export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * Menyelaraskan mode gelap bawaan CodeMirror (warna gutter/diff bawaannya) dengan tema aplikasi lewat `compartment`;
 * mengembalikan fungsi pelepas pengamat.
 */
export function followAppTheme(compartment: Compartment, views: readonly EditorView[]): () => void {
  const apply = () => {
    const effect = compartment.reconfigure(EditorView.darkTheme.of(isDarkTheme()));
    for (const view of views) view.dispatch({ effects: effect });
  };
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
