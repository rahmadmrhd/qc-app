import { itemDisplayName } from '@shared/item-detect';
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type { ItemSuggestState } from '../lib/item-suggest-extension';

const DESKTOP_WIDTH = 288;

/**
 * Daftar saran nama Item (maks. 6) untuk editor catatan: di desktop melayang di bawah kursor (portal), di ponsel
 * berupa baris saran di atas papan ketik (`--kb`). Tidak mengambil fokus dari editor.
 */
export function ItemSuggestList({ state }: { state: ItemSuggestState | null }) {
  const phone = useIsMobile();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!state || phone) {
      setPos(null);
      return;
    }
    const rect = state.clientRect?.();
    if (!rect) {
      setPos(null);
      return;
    }
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - DESKTOP_WIDTH - 8));
    setPos({ top: rect.bottom + 4, left });
  }, [state, phone]);

  if (!state || state.items.length === 0) return null;
  const list = (
    <div
      role="listbox"
      aria-label="Saran Item"
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        'z-50 overflow-auto border border-border bg-popover text-popover-foreground shadow-md',
        phone
          ? 'fixed inset-x-0 bottom-[var(--kb,0px)] flex gap-1 whitespace-nowrap rounded-none p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]'
          : 'fixed w-72 rounded-md p-1',
      )}
      style={phone ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      {state.items.map((item, index) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: papan ketik ditangani editor (Tab/panah/Enter)
        <div
          key={item.id}
          role="option"
          tabIndex={-1}
          aria-selected={state.highlight === index}
          onClick={() => state.select(item)}
          className={cn(
            // Hover hanya gaya: sorotan papan ketik tidak berubah karena kursor mouse melintas (Enter tak boleh terbajak).
            'cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-accent/60',
            phone && 'shrink-0 border border-border touch:min-h-11 touch:content-center',
            state.highlight === index && 'bg-accent text-accent-foreground',
          )}
        >
          {itemDisplayName(item)}
        </div>
      ))}
    </div>
  );
  return createPortal(list, document.body);
}
