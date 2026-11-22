import type { ItemDto } from '@shared/contract';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { ItemFormDialog } from './item-form-dialog';

export interface ItemCreateRequest {
  /** Membatasi BU dialog (mis. irisan hak modul lain); kosong = semua BU yang boleh diedit pengguna. */
  allowedBuIds?: readonly string[] | undefined;
  /** Dipanggil dengan item yang tersimpan; dialog menutup sendiri. */
  onCreated: (item: ItemDto) => void;
}

const ItemCreateContext = createContext<((request: ItemCreateRequest) => void) | null>(null);

/**
 * Tuan rumah tunggal dialog "Tambah item" untuk pemilih item di dalam `<form>` (Postel, Serial Number). Aturan proyek:
 * dialog Tambah dirender DI LUAR `<form>` induk, sebab React meneruskan event (submit, change, keydown) lewat portal
 * ke leluhur di pohon React, bukan di DOM. Pemilih hanya memanggil `useItemCreate().open(...)`; dialognya sendiri
 * dirender di sini, sebagai saudara dari seluruh halaman (dipasang di `AppShell`). Tanpa tuan rumah (mis. tes yang
 * merender pemilih sendirian) `available` false dan baris "Tambah item" tidak muncul.
 */
export function ItemCreateHost({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ItemCreateRequest | null>(null);
  const open = useCallback((next: ItemCreateRequest) => setRequest(next), []);
  return (
    <ItemCreateContext.Provider value={open}>
      {children}
      {request ? (
        <ItemFormDialog
          open
          onOpenChange={(next) => {
            if (!next) setRequest(null);
          }}
          allowedBuIds={request.allowedBuIds}
          onCreated={request.onCreated}
        />
      ) : null}
    </ItemCreateContext.Provider>
  );
}

/** Akses ke tuan rumah dialog Tambah item; `available` false bila tak ada `ItemCreateHost` di atasnya. */
export function useItemCreate(): {
  available: boolean;
  open: (request: ItemCreateRequest) => void;
} {
  const open = useContext(ItemCreateContext);
  return useMemo(() => ({ available: open !== null, open: open ?? (() => {}) }), [open]);
}
