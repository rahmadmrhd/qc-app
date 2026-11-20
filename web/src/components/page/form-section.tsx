import { cn } from 'cn';
import type { ReactNode } from 'react';

/** Bagian form: judul (+ keterangan) dan kisi isian (dua kolom di lebar >= 768 px, atau satu). */
export function FormSection({
  title,
  description,
  children,
  columns = 2,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  columns?: 1 | 2;
}) {
  return (
    <section className="space-y-3">
      {title || description ? (
        <header className="space-y-0.5">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </header>
      ) : null}
      <div className={cn('grid gap-4', columns === 2 && 'md:grid-cols-2')}>{children}</div>
    </section>
  );
}
