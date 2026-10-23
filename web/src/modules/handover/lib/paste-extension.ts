import { whatsappToNoteMarkdown } from '@shared/handover-paste';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const PASTE_KEY = new PluginKey('qcWhatsappPaste');

/**
 * Tempelan teks (mis. dari WhatsApp) diubah lewat `whatsappToNoteMarkdown` menjadi butir checklist dan
 * paragraf. Hanya jalur teks biasa: HTML/rich pada papan klip diabaikan. Satu transaksi, jadi undo
 * mengembalikan keadaan sebelum tempel.
 */
export function whatsappPasteExtension() {
  return Extension.create({
    name: 'qcWhatsappPaste',
    priority: 1000,
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: PASTE_KEY,
          props: {
            handlePaste(_view, event) {
              const clipboard = event.clipboardData;
              if (!clipboard || (clipboard.files?.length ?? 0) > 0) return false;
              const text = clipboard.getData('text/plain');
              if (text.trim() === '') return false;
              const markdown = whatsappToNoteMarkdown(text);
              if (markdown === '') return false;
              event.preventDefault();
              return editor
                .chain()
                .focus()
                .insertContent(markdown, { contentType: 'markdown' })
                .run();
            },
          },
        }),
      ];
    },
  });
}
