import { whatsappToNoteMarkdown } from '@shared/handover-paste';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const PASTE_KEY = new PluginKey('qcWhatsappPaste');

export interface WhatsappPasteOptions {
  /** Tempelan lebih panjang dari ini tidak dikonversi dan tidak dimasukkan (tab tidak dibekukan); draf utuh. */
  maxLength?: number;
  /** Dipanggil dengan panjang tempelan bila melewati `maxLength`. */
  onTooLong?: (length: number) => void;
}

/**
 * Tempelan teks (mis. dari WhatsApp) diubah lewat `whatsappToNoteMarkdown` menjadi butir checklist dan
 * paragraf. Hanya jalur teks biasa: HTML/rich pada papan klip diabaikan, KECUALI salinan dari editor ini sendiri
 * (`data-pm-slice`): itu dibiarkan ke penanganan bawaan agar struktur, format, dan butir tanpa "=" tetap utuh
 * (potong-tempel untuk mengurutkan ulang butir). Satu transaksi, jadi undo mengembalikan keadaan sebelum tempel.
 */
export function whatsappPasteExtension(options: WhatsappPasteOptions = {}) {
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
              if (clipboard.getData('text/html').includes('data-pm-slice')) return false;
              const text = clipboard.getData('text/plain');
              if (text.trim() === '') return false;
              if (options.maxLength !== undefined && text.length > options.maxLength) {
                event.preventDefault();
                options.onTooLong?.(text.length);
                return true;
              }
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
