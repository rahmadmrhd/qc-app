import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsDesktop } from '@/hooks/use-is-desktop';

/**
 * Menjelaskan mengapa sebuah tombol nonaktif. Tombol `disabled` tak menerima hover maupun fokus, jadi di tampilan lebar
 * alasan dipasang pada pembungkus yang dapat difokus (keyboard) lewat tooltip shadcn, dan dibacakan pembaca layar lewat
 * teks `sr-only`. Di ponsel (tanpa hover; tooltip Radix tak terbuka oleh sentuhan) alasan tampil sebagai teks kecil di
 * bawah tombol (spek redesain §6.12: alasan tombol nonaktif terlihat). Tanpa `reason` anak dirender apa adanya.
 * `className` dipasang pada pembungkus (mis. `flex-1` agar tombol tetap mengisi bar bawah).
 */
export function DisabledReason({
  reason,
  className,
  children,
}: {
  reason?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  const desktop = useIsDesktop();
  if (!reason) return <>{children}</>;
  if (!desktop) {
    return (
      <span className={cn('inline-flex min-w-0 flex-col items-stretch gap-0.5', className)}>
        {children}
        <span className="text-xs leading-tight text-muted-foreground">{reason}</span>
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: pembungkus tombol nonaktif agar alasan terjangkau keyboard */}
        <span tabIndex={0} className={cn('inline-flex rounded-md', className)}>
          {children}
          <span className="sr-only">{reason}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
