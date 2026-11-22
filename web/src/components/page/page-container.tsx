import { cn } from 'cn';
import { createContext, type ReactNode, useContext } from 'react';
import { PAGE_WIDTH_CLASS, type PageWidth } from '@/app/route-meta';

const PageWidthContext = createContext<PageWidth>('default');

/** Lebar konten halaman aktif (`staticData.pageWidth`); `default` di luar `PageContainer` (mis. tes komponen). */
export function usePageWidth(): PageWidth {
  return useContext(PageWidthContext);
}

/**
 * Pembungkus isi halaman: SELALU selebar `<main>` (halaman daftar, grid, dan kanban memakai seluruh lebarnya). `width`
 * (`staticData.pageWidth`) tidak membatasi pembungkus ini, tetapi diteruskan lewat konteks ke `PageContent`: batas
 * lebar konten View dan form yang dipusatkan di tengah.
 */
export function PageContainer({
  width = 'default',
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <PageWidthContext.Provider value={width}>
      <div className={cn('w-full min-w-0', className)}>{children}</div>
    </PageWidthContext.Provider>
  );
}

/**
 * Konten yang dipusatkan dengan batas lebar menurut jenis halaman (`staticData.pageWidth`): isi View dan form, serta
 * halaman informasi non-kit (Beranda, `/desktop`, `/forbidden`, Country Lock). Bar judul dan panel samping tidak
 * memakainya, keduanya melebar sampai tepi `<main>`.
 */
export function PageContent({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('mx-auto w-full min-w-0', PAGE_WIDTH_CLASS[usePageWidth()], className)}>
      {children}
    </div>
  );
}
