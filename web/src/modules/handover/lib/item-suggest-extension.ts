import { type DetectableItem, itemDisplayName } from '@shared/item-detect';
import { suggestItemsFor } from '@shared/item-suggest';
import { Extension } from '@tiptap/core';
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state';
import { Suggestion, type SuggestionMatch } from '@tiptap/suggestion';

/** Keadaan daftar saran yang dirender komponen React. */
export interface ItemSuggestState {
  items: DetectableItem[];
  /** `null` = belum ada yang disorot (Enter tidak dibajak). */
  highlight: number | null;
  clientRect: (() => DOMRect | null) | null;
  select: (item: DetectableItem) => void;
  setHighlight: (index: number | null) => void;
}

export interface ItemSuggestOptions {
  getItems: () => readonly DetectableItem[];
  onState: (state: ItemSuggestState | null) => void;
}

const SUGGEST_KEY = new PluginKey('qcItemSuggest');
const PASTE_KEY = new PluginKey<boolean>('qcItemSuggestPaste');

/** Saran ditekan setelah tempel sampai ada perubahan dokumen berikutnya (konversi WhatsApp tak diganggu). */
function suppressedByPaste(state: EditorState): boolean {
  return PASTE_KEY.getState(state) === true;
}

function insideTaskItem(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'taskItem') return true;
  }
  return false;
}

/**
 * Saran nama Item saat mengetik di baris checklist (Keluar Gudang 5.15): tanpa karakter pemicu, mencocokkan sampai
 * 3 kata terakhir sebelum kursor (`suggestItemsFor`). Tab menerima yang teratas (atau yang disorot), panah
 * menyorot, Enter menerima HANYA bila ada sorotan (selain itu membuat baris baru), Esc menutup. Pilihan
 * mengganti potongan yang diketik dengan nama Item sebagai teks polos.
 */
export function itemSuggestExtension(options: ItemSuggestOptions) {
  return Extension.create({
    name: 'qcItemSuggest',
    addProseMirrorPlugins() {
      const editor = this.editor;
      let highlight: number | null = null;
      let current: ItemSuggestState | null = null;
      let latest: { items: DetectableItem[]; command: (item: DetectableItem) => void } | null =
        null;

      const publish = () => options.onState(current);
      const setHighlight = (index: number | null) => {
        highlight = index;
        if (current) current = { ...current, highlight };
        publish();
      };
      const refresh = (props: {
        items: DetectableItem[];
        command: (item: DetectableItem) => void;
        clientRect?: (() => DOMRect | null) | null;
      }) => {
        highlight = null;
        latest = { items: props.items, command: props.command };
        current = {
          items: props.items,
          highlight,
          clientRect: props.clientRect ?? null,
          select: props.command,
          setHighlight,
        };
        publish();
      };
      const accept = (index: number) => {
        const item = latest?.items[index];
        if (!item || !latest) return false;
        latest.command(item);
        return true;
      };

      const pastePlugin = new Plugin<boolean>({
        key: PASTE_KEY,
        state: {
          init: () => false,
          apply: (tr, value) => {
            if (tr.getMeta('uiEvent') === 'paste') return true;
            return tr.docChanged ? false : value;
          },
        },
      });

      const suggestion = Suggestion<DetectableItem, DetectableItem>({
        editor,
        pluginKey: SUGGEST_KEY,
        char: '',
        allowSpaces: true,
        allowedPrefixes: null,
        findSuggestionMatch: ({ $position }): SuggestionMatch => {
          const before = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
          const found = suggestItemsFor(options.getItems(), before, 1);
          if (!found) return null;
          const base = $position.pos - $position.parentOffset;
          return {
            range: { from: base + found.range.start, to: base + found.range.end },
            query: found.range.query,
            text: found.range.query,
          };
        },
        allow: ({ state }) => insideTaskItem(state) && !suppressedByPaste(state),
        items: ({ query }) => suggestItemsFor(options.getItems(), query)?.items ?? [],
        command: ({ editor: ed, range, props }) => {
          ed.chain()
            .focus()
            .insertContentAt(range, { type: 'text', text: itemDisplayName(props) })
            .run();
        },
        render: () => ({
          onStart: refresh,
          onUpdate: refresh,
          onExit: () => {
            highlight = null;
            latest = null;
            current = null;
            publish();
          },
          onKeyDown: ({ event }) => {
            const size = latest?.items.length ?? 0;
            if (size === 0) return false;
            if (event.key === 'ArrowDown') {
              setHighlight(highlight === null ? 0 : (highlight + 1) % size);
              return true;
            }
            if (event.key === 'ArrowUp') {
              setHighlight(highlight === null ? size - 1 : (highlight - 1 + size) % size);
              return true;
            }
            if (event.key === 'Tab' && !event.shiftKey) return accept(highlight ?? 0);
            if (event.key === 'Enter' && highlight !== null) return accept(highlight);
            return false;
          },
        }),
      });
      return [pastePlugin, suggestion];
    },
  });
}
