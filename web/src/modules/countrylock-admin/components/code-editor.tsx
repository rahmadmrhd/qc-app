import { lazy, Suspense } from 'react';
import type { CodeEditorProps } from './code-editor-impl';

// Editor dimuat malas: potongan JS sendiri, hanya terunduh saat halaman berkas dibuka.
const CodeEditorImpl = lazy(() => import('./code-editor-impl'));

function EditorFallback() {
  return (
    <div
      role="status"
      className="flex min-h-48 items-center justify-center rounded-lg border text-sm text-muted-foreground"
    >
      Memuat editor…
    </div>
  );
}

/** Editor kode (CodeMirror 6, dimuat malas). Di tes diganti tiruan lewat `vi.mock('./code-editor')`. */
export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<EditorFallback />}>
      <CodeEditorImpl {...props} />
    </Suspense>
  );
}
