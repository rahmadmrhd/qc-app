import type { WarehouseSerialDto } from '@shared/contract';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type TypeDialogState =
  /** Item masih kosong/belum ada pilihan: tawarkan ganti Item (Ganti/Batal). */
  | { kind: 'switch'; serial: WarehouseSerialDto }
  /** Item terkunci: hanya pesan (Mengerti). */
  | { kind: 'error'; serial: WarehouseSerialDto; itemLabel: string };

export interface TypeMismatchDialogProps {
  state: TypeDialogState | null;
  onSwitch: (serial: WarehouseSerialDto) => void;
  onClose: () => void;
  /** Mengosongkan pilihan agar Item dapat diganti (hanya pada dialog error). */
  onClearSelection?: () => void;
}

/** Dialog untuk scan serial beda Tipe: "Ganti Item ke X?" bila belum ada pilihan, selain itu dialog error. */
export function TypeMismatchDialog({
  state,
  onSwitch,
  onClose,
  onClearSelection,
}: TypeMismatchDialogProps) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        {state?.kind === 'switch' ? (
          <>
            <DialogHeader>
              <DialogTitle>Ganti Item ke {state.serial.itemLabel}?</DialogTitle>
              <DialogDescription>
                {state.serial.serial} bertipe {state.serial.itemLabel}, beda dari Item di form. Satu
                pengeluaran hanya satu Tipe.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" color="secondary" onClick={onClose}>
                Batal
              </Button>
              <Button type="button" onClick={() => onSwitch(state.serial)}>
                Ganti
              </Button>
            </DialogFooter>
          </>
        ) : state?.kind === 'error' ? (
          <>
            <DialogHeader>
              <DialogTitle>Beda Tipe</DialogTitle>
              <DialogDescription>
                {state.serial.serial} bertipe {state.serial.itemLabel}, sedangkan pengeluaran ini
                untuk {state.itemLabel}. Selesaikan pengeluaran Tipe ini atau batalkan pilihan.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {onClearSelection ? (
                <Button
                  type="button"
                  variant="ghost"
                  color="primary"
                  onClick={() => {
                    onClearSelection();
                    onClose();
                  }}
                >
                  Batalkan pilihan
                </Button>
              ) : null}
              <Button type="button" onClick={onClose}>
                Mengerti
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
