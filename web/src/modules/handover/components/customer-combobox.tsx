import { customerKey } from '@shared/handover';
import { similarNames, suggestMatches } from '@shared/suggest';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CustomerComboboxProps {
  id: string;
  value: string;
  onChange: (name: string) => void;
  customers: ReadonlyArray<{ id: string; name: string }>;
  onBlur?: () => void;
  /** Mode ubah: customer task saat ini (mungkin nonaktif, jadi tidak ada di daftar saran). */
  currentName?: string;
}

/**
 * Isian customer dengan saran toleran (typo ringan, urutan kata bebas). Nama yang belum ada tidak memerlukan
 * form tambahan: customer dibuat otomatis saat task disimpan (FC2); petunjuk memberi tahu apa yang akan terjadi.
 */
export function CustomerCombobox({
  id,
  value,
  onChange,
  customers,
  onBlur,
  currentName,
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const key = customerKey(value);
  const exact = customers.find((customer) => customerKey(customer.name) === key);
  const suggestions =
    key === '' || exact ? [] : suggestMatches(customers, value, (c) => [c.name], 6);
  const similar =
    key === '' || exact
      ? []
      : similarNames(
          value,
          customers.map((customer) => customer.name),
        );
  const listId = `${id}-suggestions`;
  const visible = open && suggestions.length > 0;
  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="relative space-y-1.5">
      <Label htmlFor={id}>Customer</Label>
      <Input
        id={id}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible && active >= 0 ? `${id}-option-${active}` : undefined}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Tunda agar klik pada saran sempat diproses sebelum daftar ditutup.
          setTimeout(() => setOpen(false), 150);
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
            // Enter TIDAK pernah mengirim form dari isian ini: memilih saran yang disorot, bila ada.
            event.preventDefault();
            const picked = visible && active >= 0 ? suggestions[active] : undefined;
            if (picked) choose(picked.name);
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
          aria-label="Saran customer"
          className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((customer, index) => (
            <div key={customer.id} role="presentation">
              <button
                type="button"
                role="option"
                id={`${id}-option-${index}`}
                tabIndex={-1}
                aria-selected={index === active}
                className={`w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${index === active ? 'bg-accent' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(customer.name)}
              >
                {customer.name}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {key === '' ? (
        <p className="text-xs text-muted-foreground">
          Opsional; kosongkan bila tidak ada customer.
        </p>
      ) : null}
      {key !== '' && exact && exact.name !== value.trim() ? (
        <p className="text-xs text-muted-foreground">
          Memakai customer yang sudah ada: "{exact.name}".
        </p>
      ) : null}
      {key !== '' && !exact && currentName && customerKey(currentName) === key ? (
        <p className="text-xs text-muted-foreground">Customer saat ini (tidak berubah).</p>
      ) : null}
      {key !== '' && !exact && !(currentName && customerKey(currentName) === key) ? (
        <p className="text-xs text-muted-foreground">
          Customer baru "{value.trim()}" akan dibuat saat task disimpan.
        </p>
      ) : null}
      {similar.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Mirip:
          {similar.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={`Pakai ${name}`}
              className="rounded border px-1.5 py-0.5 text-foreground hover:bg-accent"
              onClick={() => onChange(name)}
            >
              {name}
            </button>
          ))}
          , pakai ini?
        </p>
      ) : null}
    </div>
  );
}
