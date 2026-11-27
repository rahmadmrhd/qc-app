import type { WarehouseOrderOptionDto } from '@shared/contract';
import { normalizeOrderNumber, orderKey } from '@shared/serial-warehouse';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface OrderNumberComboboxProps {
  id: string;
  value: string;
  onChange: (text: string) => void;
  /** Saran SO yang sudah ada (cocok awalan dengan teks; BU form lebih dulu, lalu terbaru). */
  orders: readonly WarehouseOrderOptionDto[];
  /** SO yang cocok persis dengan teks (tanpa beda huruf besar/kecil), bila ada. */
  matched: WarehouseOrderOptionDto | null;
  error?: string | undefined;
  onBlur?: () => void;
}

/** Cocok persis menurut `orderKey` (setelah normalisasi). */
export function findMatchingOrder(
  value: string,
  orders: readonly WarehouseOrderOptionDto[],
): WarehouseOrderOptionDto | null {
  const key = orderKey(normalizeOrderNumber(value));
  if (key === '') return null;
  return orders.find((order) => orderKey(order.number) === key) ?? null;
}

/**
 * Isian No SO dengan saran (pola `CustomerCombobox`): daftar saran langsung di bawah field, juga di ponsel. Teks yang
 * cocok persis dengan SO yang ada = memilih SO itu; teks lain = SO baru ("Dibuat saat disimpan"). Pengecualian aturan
 * "field relasi wajib LinkField": teks bebas yang membuat record otomatis, seperti customer di Serah Terima.
 */
export function OrderNumberCombobox({
  id,
  value,
  onChange,
  orders,
  matched,
  error,
  onBlur,
}: OrderNumberComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const typed = normalizeOrderNumber(value);
  // Saran hanya yang belum persis sama (yang persis sudah menjadi pilihan).
  const suggestions = matched ? [] : orders.slice(0, 6);
  const visible = open && suggestions.length > 0 && typed !== '';
  const listId = `${id}-suggestions`;
  const choose = (order: WarehouseOrderOptionDto) => {
    onChange(order.number);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="relative space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} required>
          No SO
        </Label>
        {typed !== '' ? (
          matched ? (
            <Badge color="info" variant="soft">
              SO yang ada
            </Badge>
          ) : (
            <Badge color="success" variant="soft">
              SO baru
            </Badge>
          )
        ) : null}
      </div>
      <Input
        id={id}
        autoComplete="off"
        role="combobox"
        aria-required="true"
        aria-expanded={visible}
        aria-controls={listId}
        aria-invalid={error ? true : undefined}
        aria-activedescendant={visible && active >= 0 ? `${id}-option-${active}` : undefined}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          closeTimer.current = setTimeout(() => setOpen(false), 150);
          onBlur?.();
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActive((current) => (current + 1) % suggestions.length);
          } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActive((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
          } else if (event.key === 'Enter') {
            // Enter tidak pernah mengirim form dari isian ini: memilih saran yang disorot, bila ada.
            event.preventDefault();
            const picked = visible && active >= 0 ? suggestions[active] : undefined;
            if (picked) choose(picked);
          } else if (event.key === 'Escape') {
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      {visible ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Saran SO"
          className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((order, index) => (
            <div key={order.id} role="presentation">
              <button
                type="button"
                role="option"
                id={`${id}-option-${index}`}
                tabIndex={-1}
                aria-selected={index === active}
                className={`w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent touch:min-h-11 ${index === active ? 'bg-accent' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(order)}
              >
                <span className="font-medium">{order.number}</span>
                <span className="block text-xs text-muted-foreground">
                  {order.buCode} · {order.customerName}
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {matched ? (
        <p className="text-xs text-muted-foreground">
          BU dan customer mengikuti SO ini ({matched.buCode} · {matched.customerName}).
        </p>
      ) : typed !== '' ? (
        <p className="text-xs text-muted-foreground">Dibuat saat disimpan.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
