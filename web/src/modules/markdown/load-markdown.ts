import type { Editor, JSONContent } from '@tiptap/core';

/**
 * Parser Markdown Tiptap menaruh gambar yang berdiri sendiri langsung di tingkat dokumen (gambar bersifat
 * inline sehingga dokumen tidak sah dan penyuntingan bisa gagal). Bungkus ke dalam paragraf.
 */
export function wrapTopLevelInline(doc: JSONContent): JSONContent {
  return {
    ...doc,
    content: (doc.content ?? []).map((node) =>
      node.type === 'image' ? { type: 'paragraph', content: [node] } : node,
    ),
  };
}

/** Memuat Markdown ke editor sebagai dokumen sah, tanpa memicu `update`. */
export function loadMarkdown(editor: Editor, markdown: string): void {
  const parsed = editor.markdown?.parse(markdown);
  // Muat awal tidak boleh masuk riwayat undo (Ctrl+Z tidak boleh mengosongkan editor).
  const chain = editor.chain().setMeta('addToHistory', false);
  if (parsed) chain.setContent(wrapTopLevelInline(parsed), { emitUpdate: false }).run();
  else chain.setContent(markdown, { emitUpdate: false, contentType: 'markdown' }).run();
}
