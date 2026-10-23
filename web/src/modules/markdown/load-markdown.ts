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
  if (parsed) editor.commands.setContent(wrapTopLevelInline(parsed), { emitUpdate: false });
  else editor.commands.setContent(markdown, { emitUpdate: false, contentType: 'markdown' });
}
