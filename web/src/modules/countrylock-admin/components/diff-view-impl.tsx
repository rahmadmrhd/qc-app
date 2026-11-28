import { MergeView } from '@codemirror/merge';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { baseExtensions, followAppTheme, isDarkTheme } from '../lib/cm-setup';
import type { CodeLanguage } from '../lib/language';

export interface DiffViewProps {
  original: string;
  modified: string;
  language: CodeLanguage;
  /** Judul kolom kiri dan kanan untuk pembaca layar (mis. "Revisi 2" dan "Revisi 5"). */
  originalLabel: string;
  modifiedLabel: string;
}

/** Perbandingan dua isi berdampingan (CodeMirror merge), keduanya baca-saja. Dimuat malas lewat `DiffView`. */
export default function DiffViewImpl({
  original,
  modified,
  language,
  originalLabel,
  modifiedLabel,
}: DiffViewProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const theme = new Compartment();
    const side = (doc: string, label: string) => ({
      doc,
      extensions: [
        ...baseExtensions(language, true),
        EditorState.readOnly.of(true),
        theme.of(EditorView.darkTheme.of(isDarkTheme())),
        EditorView.contentAttributes.of({ 'aria-label': label }),
      ],
    });
    const view = new MergeView({
      parent: host.current,
      a: side(original, originalLabel),
      b: side(modified, modifiedLabel),
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    const stopFollowing = followAppTheme(theme, [view.a, view.b]);
    return () => {
      stopFollowing();
      view.destroy();
    };
  }, [original, modified, language, originalLabel, modifiedLabel]);

  return (
    <div
      ref={host}
      data-slot="diff-view"
      className="max-h-[70vh] overflow-auto rounded-lg border [&_.cm-editor]:min-h-24"
    />
  );
}
