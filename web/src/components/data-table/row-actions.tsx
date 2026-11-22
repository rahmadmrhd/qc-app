import { ChevronDown, Ellipsis } from 'lucide-react';
import { Fragment } from 'react';
import { ACTIONS, ActionButton, type ActionKind } from '@/components/action-button';
import { DisabledReason } from '@/components/disabled-reason';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { separatorBefore } from '@/lib/menu-separators';

export interface RowAction {
  id: string;
  action: ActionKind;
  /** Nama aksesibel lengkap, mis. "Ubah Asus RT-AX55". Dipakai desktop (aria-label/tooltip). */
  label: string;
  /**
   * Label singkat di menu ponsel (menu ⋯ per kartu sudah jelas milik kartu mana), mis. "Ubah", "Hapus", "Unduh PDF".
   * Bawaan: label bawaan jenis aksi (`ACTIONS[action].label`).
   */
  shortLabel?: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Alasan aksi nonaktif: tooltip + teks pembaca layar (desktop) dan baris keterangan di menu ponsel. */
  disabledReason?: string;
  busy?: boolean;
  hidden?: boolean;
  /**
   * Desktop: tombol baris dirender ikon + teks (`shortLabel ?? ACTIONS[action].label`) alih-alih ikon saja dengan
   * tooltip; `label` tetap menjadi nama aksesibel. Aksi pembeda utama (mis. Ekspor). Menu ⋯ ponsel tak berubah.
   */
  showLabel?: boolean;
  /**
   * Kelompok aksi di bawah satu entri (mis. "Stok": Catat masuk, Catat keluar, …). Desktop: satu tombol yang membuka
   * satu dropdown. Ponsel TANPA submenu bersarang: butir-butirnya jadi GRUP datar di menu ⋯ yang sama (label grup =
   * `shortLabel ?? label` entri induk, lalu butir berlabel singkat, dipisah garis). `onSelect` induk tak dipakai.
   */
  submenu?: readonly RowAction[];
}

function mobileLabel(entry: RowAction): string {
  return entry.shortLabel ?? ACTIONS[entry.action].label;
}

/**
 * Butir menu (ponsel dan dropdown grup desktop): ikon + label, varian merah untuk Hapus, alasan nonaktif sebagai baris
 * keterangan. `parent` = entri induk grup: bila induk nonaktif/sibuk, semua butirnya ikut nonaktif (dan alasan induk
 * dipakai bila butir tak punya alasan sendiri).
 */
function MenuEntryItem({
  entry,
  parent,
  full,
}: {
  entry: RowAction;
  parent?: RowAction;
  /** Label lengkap (dropdown desktop); bawaan label singkat (menu ponsel). */
  full?: boolean;
}) {
  const Icon = ACTIONS[entry.action].icon;
  const text = full ? entry.label : mobileLabel(entry);
  const disabled = Boolean(entry.disabled || entry.busy || parent?.disabled || parent?.busy);
  const reason = entry.disabled
    ? entry.disabledReason
    : parent?.disabled
      ? (entry.disabledReason ?? parent.disabledReason)
      : undefined;
  return (
    <DropdownMenuItem
      variant={entry.action === 'delete' ? 'destructive' : 'default'}
      disabled={disabled}
      onSelect={entry.onSelect}
    >
      <Icon aria-hidden />
      {disabled && reason ? (
        <span className="flex min-w-0 flex-col">
          {text}
          <span className="text-xs font-normal text-muted-foreground">{reason}</span>
        </span>
      ) : (
        text
      )}
    </DropdownMenuItem>
  );
}

function DesktopGroup({ entry }: { entry: RowAction }) {
  const group = (entry.submenu ?? []).filter((sub) => !sub.hidden);
  if (group.length === 0) return null;
  const Icon = ACTIONS[entry.action].icon;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              color={ACTIONS[entry.action].color}
              size="icon-sm"
              aria-label={entry.label}
              disabled={entry.disabled}
            >
              <Icon aria-hidden />
              <ChevronDown aria-hidden className="size-3 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{entry.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {group.map((sub) => (
          <MenuEntryItem key={sub.id} entry={sub} parent={entry} full />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Aksi per baris: >= 768 px tombol ikon per aksi (dengan tooltip; entri bersubmenu = satu tombol dengan dropdown);
 * < 768 px satu tombol "⋯" yang membuka satu menu datar berikon + label singkat (keputusan pemilik 22; submenu =
 * grup datar, tanpa menu bersarang).
 */
export function RowActions({ name, actions }: { name: string; actions: readonly RowAction[] }) {
  const desktop = useIsDesktop();
  const visible = actions.filter((entry) => !entry.hidden);
  if (visible.length === 0) return null;

  if (desktop) {
    return (
      <div className="flex items-center gap-0.5">
        {visible.map((entry) =>
          entry.submenu ? (
            <DesktopGroup key={entry.id} entry={entry} />
          ) : (
            <DisabledReason
              key={entry.id}
              reason={entry.disabled ? entry.disabledReason : undefined}
            >
              {entry.showLabel ? (
                <ActionButton
                  action={entry.action}
                  label={mobileLabel(entry)}
                  aria-label={entry.label}
                  size="sm"
                  busy={entry.busy}
                  disabled={entry.disabled}
                  onClick={entry.onSelect}
                />
              ) : (
                <ActionButton
                  action={entry.action}
                  label={entry.label}
                  compact
                  busy={entry.busy}
                  disabled={entry.disabled}
                  onClick={entry.onSelect}
                />
              )}
            </DisabledReason>
          ),
        )}
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
        {visible.map((entry, index) => {
          const separator = separatorBefore(visible, index) ? <DropdownMenuSeparator /> : null;
          if (!entry.submenu) {
            return (
              <Fragment key={entry.id}>
                {separator}
                <MenuEntryItem entry={entry} />
              </Fragment>
            );
          }
          const group = entry.submenu.filter((sub) => !sub.hidden);
          if (group.length === 0) return null;
          return (
            <Fragment key={entry.id}>
              {separator}
              <DropdownMenuLabel>{mobileLabel(entry)}</DropdownMenuLabel>
              {group.map((sub) => (
                <MenuEntryItem key={sub.id} entry={sub} parent={entry} />
              ))}
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
