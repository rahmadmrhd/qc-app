import { Link, type LinkProps } from '@tanstack/react-router';
import { cn } from 'cn';
import { Ellipsis } from 'lucide-react';
import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { UiColor, UiVariant } from '@/components/ui/variant-style';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { useIsMobile } from '@/hooks/use-mobile';
import { onFormTabRequest } from '@/lib/form-tab-request';
import { formatStamp } from '@/lib/format-stamp';
import { separatorBefore } from '@/lib/menu-separators';
import { useAppBannerHeight } from '@/lib/viewport-fit';
import { HeadroomBar, HeadroomFrame } from './headroom-bar';
import { PageContent } from './page-container';
import { StickyActionBar } from './sticky-action-bar';
import { LINE_TAB_LIST_CLASS, LINE_TAB_TRIGGER_CLASS } from './tab-styles';

export interface ViewTab {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

/**
 * Aksi halaman View: aksi utama (bertanda `primary`, maks. `PRIMARY_ACTIONS_MAX`) jadi tombol (desktop: bar judul;
 * ponsel: bar bawah), sisanya masuk menu "Aksi lainnya" (⋯) di keduanya.
 */
export interface ViewAction {
  id: string;
  action: ActionKind;
  /** Bawaan: label `ACTIONS[action]`. */
  label?: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Alasan aksi nonaktif: tooltip + teks pembaca layar (desktop, bar bawah) dan keterangan di menu overflow. */
  disabledReason?: string;
  busy?: boolean;
  hidden?: boolean;
  /**
   * Aksi utama: tombol di bar judul (desktop) dan bar bawah (ponsel), maksimal `PRIMARY_ACTIONS_MAX` (3) menurut urutan
   * kemunculan; yang lebih dari itu masuk menu. Tanpa penanda sama sekali: aksi pertama yang terlihat dan tidak
   * bersubmenu. Entri bersubmenu yang bertanda `primary` hanya jadi tombol di desktop (ponsel tanpa popover bersarang:
   * ia jadi grup datar di menu).
   */
  primary?: boolean;
  /** Menimpa warna/gaya bawaan aksi (mis. tombol Salin ulang berwarna primary). */
  color?: UiColor;
  variant?: UiVariant;
  /** Label singkat di menu ponsel (bawaan: `label` lalu label bawaan jenis aksi). */
  shortLabel?: string;
  /**
   * Kelompok aksi di bawah satu entri (mis. Unduh: PDF, PNG). Desktop: satu tombol yang membuka satu dropdown.
   * Ponsel TANPA submenu bersarang: butirnya jadi grup datar di menu "Aksi lainnya" (label grup = nama entri).
   */
  submenu?: readonly ViewAction[];
}

function actionText(entry: ViewAction): string {
  return entry.label ?? ACTIONS[entry.action].label;
}

/**
 * Butir menu ponsel (menu "Aksi lainnya") dan dropdown grup desktop: ikon + label; alasan nonaktif sebagai baris
 * keterangan. `parent` = entri induk grup: bila induk nonaktif/sibuk, butirnya ikut nonaktif (alasan induk dipakai
 * bila butir tak punya alasan sendiri).
 */
function PhoneMenuItem({
  entry,
  short,
  parent,
}: {
  entry: ViewAction;
  short?: boolean;
  parent?: ViewAction;
}) {
  const Icon = ACTIONS[entry.action].icon;
  const text = short ? (entry.shortLabel ?? actionText(entry)) : actionText(entry);
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

/** Aksi bersubmenu di bar judul desktop: satu tombol dengan satu dropdown (tanpa menu bersarang). */
function DesktopSubmenu({ entry }: { entry: ViewAction }) {
  const group = (entry.submenu ?? []).filter((sub) => !sub.hidden);
  if (group.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          action={entry.action}
          label={actionText(entry)}
          busy={entry.busy}
          disabled={entry.disabled}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {group.map((sub) => (
          <PhoneMenuItem key={sub.id} entry={sub} parent={entry} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Batas aksi utama yang tampil sebagai tombol (desktop: bar judul; ponsel: bar bawah); sisanya masuk menu "Aksi lainnya". */
export const PRIMARY_ACTIONS_MAX = 3;

/**
 * Aksi utama dari kandidat yang terlihat: yang bertanda `primary` (urut kemunculan, maksimal `PRIMARY_ACTIONS_MAX`);
 * tanpa penanda, aksi pertama yang tidak bersubmenu. Aksi sering pakai dan berhak bagi pengguna itu diberi `primary`
 * oleh halaman; sisanya (hapus, batalkan, kloning, dst.) sengaja di menu (keputusan pemilik 2026-11-22, K7).
 */
export function pickPrimaryActions(candidates: readonly ViewAction[]): ViewAction[] {
  const marked = candidates.filter((entry) => entry.primary).slice(0, PRIMARY_ACTIONS_MAX);
  if (marked.length > 0) return marked;
  const first = candidates.find((entry) => !entry.submenu);
  return first ? [first] : [];
}

/**
 * Menu "Aksi lainnya" (tombol ⋯): aksi di luar yang utama, dipakai desktop (bar judul, menu turun) dan ponsel (bar
 * bawah, menu naik). Tanpa submenu bersarang: entri bersubmenu menjadi grup datar (label grup, butir berlabel singkat).
 */
function MoreActionsMenu({
  entries,
  side,
}: {
  entries: readonly ViewAction[];
  side: 'top' | 'bottom';
}) {
  if (entries.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          color="primary"
          size="icon"
          aria-label="Aksi lainnya"
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={side}>
        {entries.map((entry, index) => {
          const separator = separatorBefore(entries, index) ? <DropdownMenuSeparator /> : null;
          if (!entry.submenu) {
            return (
              <Fragment key={entry.id}>
                {separator}
                <PhoneMenuItem entry={entry} />
              </Fragment>
            );
          }
          const group = entry.submenu.filter((sub) => !sub.hidden);
          if (group.length === 0) return null;
          return (
            <Fragment key={entry.id}>
              {separator}
              <DropdownMenuLabel>{entry.shortLabel ?? actionText(entry)}</DropdownMenuLabel>
              {group.map((sub) => (
                <PhoneMenuItem key={sub.id} entry={sub} parent={entry} short />
              ))}
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Kerangka halaman View (spek redesain 6.6; tata letak ERPNext v16, revisi lanjutan 2 R15): di tampilan lebar kerangka
 * bleed ke tepi `<main>`: bar headroom (judul + badge + aksi) dan bar tab selebar penuh, isi (batas lebar menurut
 * `pageWidth`) terpusat di tengah, dan panel samping `aside` (18 rem; 24 rem di layar > 1920 px, garis kiri, tinggi penuh, menempel) di tepi
 * kanan. Dua kolom aktif bila lebar `<main>` >= 48 rem (kueri wadah); di bawahnya `aside` di bawah isi. `banner`
 * tampil di atas isi.
 */
export function ViewPage({
  title,
  badge,
  actions,
  actionItems,
  tabs,
  aside,
  banner,
  children,
  tab,
  onTabChange,
  actionsTour,
}: {
  title: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  /** Aksi terstruktur (disarankan): desktop = tombol di bar judul, ponsel = bar bawah + menu overflow (spek butir 38d). */
  actionItems?: readonly ViewAction[];
  tabs?: readonly ViewTab[];
  aside?: ReactNode;
  banner?: ReactNode;
  children?: ReactNode;
  /** Tab aktif terkendali (mis. dari search param `tab`); tanpa ini state lokal. */
  tab?: string;
  onTabChange?: (id: string) => void;
  /** `data-tour` pada pembungkus aksi: bar judul (desktop) dan bar bawah (ponsel). */
  actionsTour?: string;
}) {
  const desktop = useIsDesktop();
  // SATU gerbang ponsel (viewport < 768, sama dengan judul navbar): judul tak tampil ganda pada 704-767 px.
  const phone = useIsMobile();
  const bannerHeight = useAppBannerHeight(desktop);
  const visibleActions = (actionItems ?? []).filter((entry) => !entry.hidden);
  // Aksi utama (maks. 3) jadi tombol; sisanya di menu "Aksi lainnya", di desktop maupun ponsel. Entri bersubmenu boleh
  // menjadi aksi utama hanya di desktop (satu dropdown); ponsel tanpa popover bersarang, jadi ia masuk menu sebagai grup.
  const primaryActions = pickPrimaryActions(
    desktop ? visibleActions : visibleActions.filter((entry) => !entry.submenu),
  );
  const menuActions = visibleActions.filter((entry) => !primaryActions.includes(entry));
  // Bar atas memuat aksi bila ada `actions` atau (desktop) aksi terstruktur; selain itu, di ponsel tanpa lencana, kosong.
  const topActions = Boolean(actions) || (desktop && visibleActions.length > 0);
  const emptyTop = phone && !badge && !topActions;
  const [localTab, setLocalTab] = useState(tabs?.[0]?.id);
  const requested = tab ?? localTab;
  // Id tak dikenal (mis. `?tab=` basi) jatuh ke tab pertama agar panel tak kosong.
  const active = tabs?.some((entry) => entry.id === requested) ? requested : tabs?.[0]?.id;
  const select = (id: string) => {
    setLocalTab(id);
    onTabChange?.(id);
  };
  // Permintaan dari luar (panduan interaktif, langkah `buka: { tab }`): tab yang tak ter-mount dibuka lewat jalur pilih
  // yang sama dengan klik pengguna, sehingga halaman yang mengendalikan tab (search param) ikut diberi tahu.
  const latest = useRef({ tabs, select });
  latest.current = { tabs, select };
  useEffect(
    () =>
      onFormTabRequest((tabId) => {
        if (!latest.current.tabs?.some((entry) => entry.id === tabId)) return false;
        latest.current.select(tabId);
        return true;
      }),
    [],
  );

  // Gutter horizontal hanya di tampilan lebar: kerangka bleed ke tepi `<main>` (di sempit `<main>` sendiri berpadding).
  const gutterX = 'wide:px-[var(--main-pad)]';
  // Spasi atas/bawah isi (banner atau bar tab sudah memberi jarak atas bila ada).
  const contentPadding = banner || tabs ? 'wide:pb-[var(--main-pad)]' : 'wide:py-[var(--main-pad)]';

  const tabsBody = tabs ? (
    <Tabs value={active} onValueChange={select}>
      {/* Bar tab selebar kolom kiri (sampai garis panel samping); tab pertama sejajar dengan isi yang terpusat. */}
      <TabsList
        variant="line"
        className={cn(LINE_TAB_LIST_CLASS, 'top-[var(--headroom-offset,3.5rem)]', gutterX)}
      >
        <PageContent className="flex h-full items-stretch justify-start gap-1">
          {tabs.map((entry) => (
            <TabsTrigger key={entry.id} value={entry.id} className={LINE_TAB_TRIGGER_CLASS}>
              {entry.label}
            </TabsTrigger>
          ))}
        </PageContent>
      </TabsList>
      <div className={cn(gutterX, contentPadding)}>
        <PageContent>
          {tabs.map((entry) => (
            <TabsContent key={entry.id} value={entry.id} className="pt-3">
              {entry.content}
            </TabsContent>
          ))}
          {children}
        </PageContent>
      </div>
    </Tabs>
  ) : (
    <div className={cn(gutterX, contentPadding)}>
      <PageContent className="space-y-6">{children}</PageContent>
    </div>
  );

  return (
    // Tampilan lebar: kerangka bleed ke tepi `<main>` (bar judul, tab, dan panel samping selebar penuh; isi terpusat).
    // Hanya `wide:` yang meniadakan padding `<main>`, sehingga ponsel tak berubah (`--action-bar-h` tetap berlaku).
    <HeadroomFrame className="gap-3 [--aside-w:18rem] min-[1921px]:[--aside-w:24rem] wide:-mx-[var(--main-pad)] wide:-mt-[var(--main-pad)] wide:-mb-[var(--main-pad)] wide:gap-0">
      {emptyTop ? (
        // Ponsel tanpa lencana dan tanpa aksi di bar atas: tanpa bar ber-border/bayang yang kosong (dan tak menambah
        // `--headroom-offset`); judul tetap ada bagi pembaca layar.
        <div className="sr-only">
          <h1>{title}</h1>
        </div>
      ) : (
        <HeadroomBar className="border-b pt-1 pb-1 wide:pt-3 wide:pb-3">
          {/* Bar judul selebar penuh (tanpa batas `pageWidth`; keputusan pemilik 2026-11-23, K9): judul di kiri, aksi di kanan. */}
          <div className={cn('@container/viewbar min-w-0', gutterX)}>
            <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {/* Ponsel: judul tampak = judul navbar; h1 tetap ada bagi pembaca layar. */}
                <h1 className={cn('min-w-0 text-xl font-semibold break-words', phone && 'sr-only')}>
                  {title}
                </h1>
                {badge}
              </div>
              {topActions ? (
                <div
                  data-tour={actionsTour}
                  className="flex flex-wrap items-center gap-2 narrow:w-full"
                >
                  {actions}
                  {desktop
                    ? primaryActions.map((entry) =>
                        entry.submenu ? (
                          <DesktopSubmenu key={entry.id} entry={entry} />
                        ) : (
                          <DisabledReason
                            key={entry.id}
                            reason={entry.disabled ? entry.disabledReason : undefined}
                          >
                            <ActionButton
                              action={entry.action}
                              label={entry.label}
                              color={entry.color}
                              variant={entry.variant}
                              busy={entry.busy}
                              disabled={entry.disabled}
                              onClick={entry.onSelect}
                            />
                          </DisabledReason>
                        ),
                      )
                    : null}
                  {desktop ? <MoreActionsMenu entries={menuActions} side="bottom" /> : null}
                </div>
              ) : null}
            </div>
          </div>
        </HeadroomBar>
      )}
      {/* Wadah kueri badan: dua kolom (isi | panel samping) menurut lebar `<main>`, bukan viewport. TIDAK dipasang di
          `<main>` atau kerangka: `container-type` menjadikan elemen ini containing block bagi turunan `fixed`
          (bar aksi ponsel ada di luarnya, di bawah). */}
      <div className="@container/view min-w-0">
        {/* `min-h` memenuhi layar di bawah bar (garis panel samping sampai dasar); spanduk aplikasi di atas halaman ikut
            dikurangkan lewat `--banner-h` agar halaman tak dipaksa menggulir sejauh tinggi spanduk. */}
        <div
          style={{ '--banner-h': `${bannerHeight}px` } as CSSProperties}
          className="grid gap-6 wide:min-h-[calc(100dvh_-_var(--headroom-offset,3.5rem)_-_var(--banner-h,0px)_-_2px)] wide:gap-0 @3xl/view:grid-cols-[minmax(0,1fr)_var(--aside-w)]"
        >
          <div className="min-w-0">
            {banner ? (
              // Pembungkus baru tampil bila `banner` benar-benar merender sesuatu: `<>{null}</>` (mis. Serial tanpa
              // spanduk hapus/foto bermasalah) bernilai truthy, tetapi padding atas+bawahnya (2 x main-pad) tak boleh
              // menjadi celah kosong di antara judul dan tab.
              <div
                className={cn(
                  'hidden has-[[data-view-banner]>*]:block pb-3 wide:pt-[var(--main-pad)] wide:pb-[var(--main-pad)]',
                  gutterX,
                )}
              >
                <PageContent>
                  <div data-view-banner="" className="contents">
                    {banner}
                  </div>
                </PageContent>
              </div>
            ) : null}
            {tabsBody}
          </div>
          {aside ? (
            <aside className="border-t text-sm @3xl/view:border-t-0 @3xl/view:border-l">
              <div
                className={cn(
                  'space-y-4 pt-4 wide:pt-[var(--main-pad)] wide:pb-[var(--main-pad)]',
                  gutterX,
                  '@3xl/view:sticky @3xl/view:top-[var(--headroom-offset,3.5rem)] @3xl/view:max-h-[calc(100dvh_-_var(--headroom-offset,3.5rem))] @3xl/view:overflow-y-auto',
                )}
              >
                {aside}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
      {!desktop && (primaryActions.length > 0 || menuActions.length > 0) ? (
        <StickyActionBar label="Aksi halaman" busy={visibleActions.some((entry) => entry.busy)}>
          <div
            data-tour={actionsTour}
            className={cn(
              'flex w-full items-center gap-2',
              primaryActions.length === 0 && 'justify-end',
            )}
          >
            {primaryActions.map((entry) => (
              <DisabledReason
                key={entry.id}
                reason={entry.disabled ? entry.disabledReason : undefined}
                className="flex-1"
              >
                <ActionButton
                  action={entry.action}
                  label={entry.label}
                  color={entry.color}
                  variant={entry.variant}
                  emphasis="primary"
                  busy={entry.busy}
                  disabled={entry.disabled}
                  onClick={entry.onSelect}
                  className="flex-1"
                />
              </DisabledReason>
            ))}
            <MoreActionsMenu entries={menuActions} side="top" />
          </div>
        </StickyActionBar>
      ) : null}
    </HeadroomFrame>
  );
}

/** Bagian isi View: judul kecil + isi. */
export function ViewSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export interface DetailItem {
  label: string;
  value: ReactNode;
  hidden?: boolean;
}

/** Daftar label–nilai (`dl`) dua kolom; nilai kosong tampil "—" dan butir `hidden` dilewati. */
export function DetailList({ items }: { items: readonly DetailItem[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
      {items
        .filter((item) => !item.hidden)
        .map((item) => (
          <div key={item.label} className="contents">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 break-words">
              {item.value === null || item.value === undefined || item.value === ''
                ? '—'
                : item.value}
            </dd>
          </div>
        ))}
    </dl>
  );
}

export interface ViewMetaLink {
  label: string;
  to: LinkProps['to'];
  search?: Record<string, unknown>;
  params?: Record<string, string>;
}

/**
 * Isi standar `aside`: "Dibuat oleh … · kapan" HANYA bila DTO punya `createdBy`/`createdAt`, "Diubah oleh …" dari
 * `updatedBy`/`updatedAt` bila ada, dan tautan ke data terkait TANPA angka hitungan.
 */
export function ViewMeta({
  createdBy,
  createdAt,
  updatedBy,
  updatedAt,
  links,
}: {
  createdBy?: string | null;
  createdAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  links?: readonly ViewMetaLink[];
}) {
  const created = createdBy || createdAt;
  const updated = updatedBy || updatedAt;
  return (
    <>
      {created ? (
        <p>
          <span className="text-muted-foreground">Dibuat</span>
          {createdBy ? ` oleh ${createdBy}` : ''}
          {createdAt ? ` · ${formatStamp(createdAt)}` : ''}
        </p>
      ) : null}
      {updated ? (
        <p>
          <span className="text-muted-foreground">Diubah</span>
          {updatedBy ? ` oleh ${updatedBy}` : ''}
          {updatedAt ? ` · ${formatStamp(updatedAt)}` : ''}
        </p>
      ) : null}
      {links && links.length > 0 ? (
        <ul className="space-y-1">
          {links.map((link) => (
            <li key={link.label}>
              <Link
                to={link.to}
                params={link.params as never}
                search={link.search as never}
                className="font-medium text-info-text underline-offset-4 hover:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
