import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AttachmentItem } from './attachment-view';

/** Pratinjau gambar besar (dialog lapis kedua); gambarnya dari `item.renderImage('large')`. */
export function PreviewDialog({ item, onClose }: { item: AttachmentItem | null; onClose(): void }) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-[calc(100%-1rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{item?.name}</DialogTitle>
          <DialogDescription className="sr-only">Pratinjau gambar ukuran besar</DialogDescription>
        </DialogHeader>
        {item?.renderImage ? (
          <div className="flex max-h-[70dvh] items-center justify-center overflow-auto rounded-md bg-muted">
            {item.renderImage('large')}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
