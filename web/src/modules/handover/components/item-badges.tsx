import {
  type DetectableItem,
  detectItemsInNote,
  type ItemDetection,
  itemDisplayName,
} from '@shared/item-detect';
import { useDeferredValue, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';

export interface DetectedItem extends ItemDetection {
  item: DetectableItem;
  label: string;
}

/** Item yang disebut pada catatan (dihitung dari katalog nama Item; tidak disimpan). */
export function useDetectedItems(note: string, items: readonly DetectableItem[]): DetectedItem[] {
  const deferred = useDeferredValue(note);
  return useMemo(() => {
    if (items.length === 0 || deferred.trim() === '') return [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const detected: DetectedItem[] = [];
    for (const detection of detectItemsInNote(deferred, items)) {
      const item = byId.get(detection.itemId);
      if (item) detected.push({ ...detection, item, label: itemDisplayName(item) });
    }
    return detected;
  }, [deferred, items]);
}

/** Nama Item per butir checklist (hanya dari Item yang terdeteksi di catatan). */
export function lineItemLabels(text: string, detected: readonly DetectedItem[]): string[] {
  if (detected.length === 0) return [];
  return detectItemsInNote(
    text,
    detected.map((d) => d.item),
  ).map((hit) => {
    const found = detected.find((d) => d.item.id === hit.itemId);
    return found ? found.label : '';
  });
}

/** Ringkasan di bawah editor/tampilan catatan: "Item terdeteksi". */
export function ItemSummaryBadges({ detected }: { detected: readonly DetectedItem[] }) {
  if (detected.length === 0) return null;
  return (
    <div data-note-meta="" className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Item terdeteksi:</span>
      {detected.map((d) => (
        <Badge
          key={d.item.id}
          variant="soft"
          color="info"
          title={d.ambiguous ? 'Nama ini juga cocok dengan Item lain' : undefined}
        >
          {d.label}
          {d.lines > 1 ? ` · ${d.lines} baris` : ''}
          {d.ambiguous ? ' ?' : ''}
        </Badge>
      ))}
    </div>
  );
}

/** Lencana nama Item di ujung satu baris checklist. */
export function LineItemBadges({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return (
    <span data-note-meta="" className="ml-7 touch:ml-8 mt-0.5 flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="soft" color="info">
          {label}
        </Badge>
      ))}
    </span>
  );
}
