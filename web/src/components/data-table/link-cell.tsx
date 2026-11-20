import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/** Sel tautan ke View record (nilai kolom unik; `data-tour` untuk panduan). */
export function LinkCell({
  to,
  params,
  search,
  tour,
  children,
}: {
  to: LinkProps['to'];
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  tour?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      params={params as never}
      search={search as never}
      data-tour={tour}
      className="font-medium text-info-text underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}
