import { createContext, type ReactNode, useContext } from 'react';
import { type ProofReplace, useProofReplaceController } from './use-proof-replace';

const ProofReplaceContext = createContext<ProofReplace | null>(null);

/**
 * Satu pemilik unggah ulang foto bukti untuk seluruh halaman: banner masalah dan kartu galeri memakai keadaan yang
 * sama, jadi penggantian yang dimulai di salah satunya tampil (progres, kunci) di yang lain untuk foto yang sama.
 * Unggahan berjalan dibatalkan bila provider dilepas (berpindah halaman), tanpa memanggil `replace`.
 */
export function ProofReplaceProvider({ children }: { children: ReactNode }) {
  const value = useProofReplaceController();
  return <ProofReplaceContext.Provider value={value}>{children}</ProofReplaceContext.Provider>;
}

/** Memasang pemilik sendiri hanya bila belum ada di atasnya (komponen yang dipakai berdiri sendiri). */
export function EnsureProofReplace({ children }: { children: ReactNode }) {
  const shared = useContext(ProofReplaceContext);
  if (shared) return <>{children}</>;
  return <ProofReplaceProvider>{children}</ProofReplaceProvider>;
}

/** Keadaan unggah ulang bersama; wajib di bawah `ProofReplaceProvider` atau `EnsureProofReplace`. */
export function useProofReplace(): ProofReplace {
  const shared = useContext(ProofReplaceContext);
  if (!shared) throw new Error('useProofReplace harus di dalam ProofReplaceProvider');
  return shared;
}
