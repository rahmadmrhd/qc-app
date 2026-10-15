import { normalizeKey } from '@shared/items';
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
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const key = normalizeKey(value);
  const exact = customers.find((customer) => normalizeKey(customer.name) === key);
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
  return (
    <div className="relative space-y-1.5">
      <Label htmlFor={id}>Customer</Label>
      <Input
        id={id}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
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
        }}
      />
      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Saran customer"
          className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((customer) => (
            <li key={customer.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(customer.name);
                  setOpen(false);
                }}
              >
                {customer.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {key !== '' && exact && exact.name !== value.trim() ? (
        <p className="text-xs text-muted-foreground">
          Memakai customer yang sudah ada: "{exact.name}".
        </p>
      ) : null}
      {key !== '' && !exact ? (
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
