import { createContext } from 'react';

/** `ListPage` menyediakan ini; `BulkBar` memanggilnya saat tampil agar tombol Tambah mengambang (FAB) disembunyikan. */
export const BulkActiveContext = createContext<((active: boolean) => void) | null>(null);
