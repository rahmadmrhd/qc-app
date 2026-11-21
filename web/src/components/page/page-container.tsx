import { cn } from 'cn';
import type { ReactNode } from 'react';
import { PAGE_WIDTH_CLASS, type PageWidth } from '@/app/route-meta';

/** Pembungkus isi halaman: rata tengah dengan lebar maksimum menurut jenis halaman (`staticData.pageWidth`). */
export function PageContainer({
  width = 'default',
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('mx-auto w-full', PAGE_WIDTH_CLASS[width], className)}>{children}</div>;
}
