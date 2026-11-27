import type { WarehouseOrderDto } from '@shared/contract';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { describeSaveError } from '@/modules/access/lib/stale';
import { useSetWarehouseOrderLinks } from '../queries';
import { HandoverLinkPicker } from './handover-link-picker';

const FORM_ID = 'warehouse-link-handovers';

export interface LinkHandoversDialogProps {
  order: WarehouseOrderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Id task yang boleh diubah pemanggil: hanya yang terbaca (yang tak terbaca tidak pernah ikut terkirim). */
function readableIds(order: WarehouseOrderDto): string[] {
  return order.handovers.filter((handover) => handover.readable).map((handover) => handover.id);
}

/**
 * Dialog "Tautkan task": `HandoverLinkPicker` berisi task yang sudah tertaut (tercentang) dan kandidat customer SO.
 * Simpan mengirim daftar akhir lewat `serialWarehouse.setLinks` dengan `expectedUpdatedAt` dari saat dialog dibuka
 * (SO diubah orang lain di antaranya = pesan "buka lagi", bukan menimpa diam-diam).
 */
export function LinkHandoversDialog({ order, open, onOpenChange }: LinkHandoversDialogProps) {
  const setLinks = useSetWarehouseOrderLinks();
  const [value, setValue] = useState<string[]>(() => readableIds(order));
  const expected = useRef(order.updatedAt);
  const wasOpen = useRef(open);
  // Versi dan pilihan dibekukan saat dialog dibuka; data SO yang dimuat ulang di latar tidak mengubahnya.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setValue(readableIds(order));
      expected.current = order.updatedAt;
    }
    wasOpen.current = open;
  }, [open, order]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setLinks.mutate(
      { id: order.id, expectedUpdatedAt: expected.current, handoverIds: value },
      {
        onSuccess: () => {
          toast.success('Tautan task disimpan');
          onOpenChange(false);
        },
        onError: (error) => toast.error(describeSaveError(error)),
      },
    );
  }

  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={FORM_ID}
      title="Tautkan task Serah Terima"
      description={`SO ${order.number}${order.customerName ? ` · ${order.customerName}` : ''}`}
      submitting={setLinks.isPending}
      size="lg"
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-3">
        <HandoverLinkPicker
          orderId={order.id}
          {...(order.customerId ? { customerId: order.customerId } : {})}
          {...(order.customerName ? { customerName: order.customerName } : {})}
          value={value}
          onChange={setValue}
        />
      </form>
    </FormDialogShell>
  );
}
