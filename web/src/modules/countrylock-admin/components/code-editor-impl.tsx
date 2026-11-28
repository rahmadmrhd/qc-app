import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { baseExtensions, editingExtensions, followAppTheme, isDarkTheme } from '../lib/cm-setup';
import type { CodeLanguage } from '../lib/language';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language: CodeLanguage;
  readOnly?: boolean;
  /** Nama aksesibel area teks. */
  label: string;
}

/**
 * Editor kode berbasis CodeMirror 6 (dimuat malas lewat `CodeEditor`). Terkendali: perubahan `value` dari luar
 * (muat ulang berkas) menggantikan isi tanpa memanggil `onChange`.
 */
export default function CodeEditorImpl({
  value,
  onChange,
  language,
  readOnly = false,
  label,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Isi terkini untuk membangun ulang editor (ganti bahasa/readOnly) tanpa kehilangan teks.
  const valueRef = useRef(value);
  valueRef.current = value;
  // Penggantian isi dari luar tidak boleh dilaporkan balik sebagai suntingan pengguna.
  const applyingExternal = useRef(false);

  // Ganti bahasa/readOnly = bangun ulang editor dengan isi terkini; teks sendiri disinkronkan efek di bawah.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `label` sengaja tidak memicu pembangunan ulang
  useEffect(() => {
    if (!host.current) return;
    const theme = new Compartment();
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          ...baseExtensions(language, readOnly),
          ...(readOnly ? [] : editingExtensions()),
          theme.of(EditorView.darkTheme.of(isDarkTheme())),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternal.current) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    const stopFollowing = followAppTheme(theme, [view]);
    return () => {
      stopFollowing();
      view.destroy();
      viewRef.current = null;
    };
  }, [language, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      applyingExternal.current = true;
      try {
        view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
      } finally {
        applyingExternal.current = false;
      }
    }
  }, [value]);

  return (
    <div
      ref={host}
      data-slot="code-editor"
      className="max-h-[70vh] min-h-48 overflow-auto rounded-lg border [&_.cm-editor]:min-h-48"
    />
  );
}
