import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Menjelaskan mengapa sebuah tombol nonaktif. Tombol `disabled` tak menerima hover maupun fokus, jadi alasan dipasang
 * pada pembungkus yang dapat difokus (keyboard) lewat tooltip shadcn, dan dibacakan pembaca layar lewat teks `sr-only`.
 * Tanpa `reason` anak dirender apa adanya.
 */
export function DisabledReason({
  reason,
  children,
}: {
  reason?: string | undefined;
  children: ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: pembungkus tombol nonaktif agar alasan terjangkau keyboard */}
        <span tabIndex={0} className="inline-flex rounded-md">
          {children}
          <span className="sr-only">{reason}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
