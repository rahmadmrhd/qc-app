import { Ellipsis } from 'lucide-react';
import { ACTIONS, ActionButton, type ActionKind } from '@/components/action-button';
import { DisabledReason } from '@/components/disabled-reason';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIsDesktop } from '@/hooks/use-is-desktop';

export interface RowAction {
  id: string;
  action: ActionKind;
  /** Nama aksesibel lengkap, mis. "Ubah Asus RT-AX55". */
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Alasan aksi nonaktif: tooltip + teks pembaca layar (desktop) dan baris keterangan di menu ponsel. */
  disabledReason?: string;
  busy?: boolean;
  hidden?: boolean;
}

/**
 * Aksi per baris: >= 768 px tombol ikon per aksi (dengan tooltip); < 768 px satu tombol "⋯" yang membuka menu
 * berikon + label (keputusan pemilik 22).
 */
export function RowActions({ name, actions }: { name: string; actions: readonly RowAction[] }) {
  const desktop = useIsDesktop();
  const visible = actions.filter((entry) => !entry.hidden);
  if (visible.length === 0) return null;

  if (desktop) {
    return (
      <div className="flex items-center gap-0.5">
        {visible.map((entry) => (
          <DisabledReason key={entry.id} reason={entry.disabled ? entry.disabledReason : undefined}>
            <ActionButton
              action={entry.action}
              label={entry.label}
              compact
              busy={entry.busy}
              disabled={entry.disabled}
              onClick={entry.onSelect}
            />
          </DisabledReason>
        ))}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          color="primary"
          size="icon-sm"
          aria-label={`Aksi ${name}`}
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {visible.map((entry) => {
          const Icon = ACTIONS[entry.action].icon;
          return (
            <DropdownMenuItem
              key={entry.id}
              variant={entry.action === 'delete' ? 'destructive' : 'default'}
              disabled={entry.disabled || entry.busy}
              onSelect={entry.onSelect}
            >
              <Icon aria-hidden />
              {entry.disabled && entry.disabledReason ? (
                <span className="flex min-w-0 flex-col">
                  {entry.label}
                  <span className="text-xs font-normal text-muted-foreground">
                    {entry.disabledReason}
                  </span>
                </span>
              ) : (
                entry.label
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
