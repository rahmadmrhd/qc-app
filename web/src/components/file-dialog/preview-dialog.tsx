import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { LibraryItem } from './types';

/** Pratinjau gambar besar (dialog lapis kedua). */
export function PreviewDialog({ item, onClose }: { item: LibraryItem | null; onClose(): void }) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-[calc(100%-1rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{item?.name}</DialogTitle>
          <DialogDescription className="sr-only">Pratinjau gambar ukuran besar</DialogDescription>
        </DialogHeader>
        {item ? (
          <div className="flex max-h-[70dvh] items-center justify-center overflow-auto rounded-md bg-muted">
            <img
              src={item.previewUrl}
              alt={item.name}
              className="max-h-[70dvh] max-w-full object-contain"
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
