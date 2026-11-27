import type { MeDto } from '@shared/contract';
import type { Level, ModuleKey } from '@shared/permissions';
import type { LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
  BellRing,
  BookOpen,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Contact,
  Download,
  FileBadge,
  FileText,
  History,
  House,
  Images,
  LayoutDashboard,
  Link2,
  ListChecks,
  Lock,
  MapPin,
  Package,
  QrCode,
  Settings,
  Settings2,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Sticker,
  Tags,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react';
import { canAnywhere, canManageSerialSettings } from '@/modules/auth/permissions';
import { canSeeDashboard } from '@/modules/dashboard/lib/access';

export interface NavPermission {
  module: ModuleKey;
  level: Level;
  /** `scope: 'location'` = tampil bila izin cukup di minimal satu lokasi aktif terpilih. */
  scope?: 'location';
}

export interface NavItem {
  label: string;
  to: LinkProps['to'];
  icon: LucideIcon;
  /** Rute di bawah `to` yang punya menu sendiri: item ini tidak ikut aktif di sana. */
  excludes?: LinkProps['to'][];
  /** Rute lain yang membuat item ini aktif (halaman yang dibuka dari item ini tetapi bukan di bawah `to`). */
  alsoActiveOn?: LinkProps['to'][];
  /** Satu izin, atau **daftar** (salah satu cukup). */
  permission?: NavPermission | readonly NavPermission[];
  /** Hanya tampil di aplikasi desktop (jembatan `window.qcBridge` ada). */
  desktopOnly?: boolean;
  /** Hanya tampil di peramban (jembatan `window.qcBridge` tak ada); kebalikan `desktopOnly`. */
  webOnly?: boolean;
  /**
   * Disembunyikan dari sidebar dan peluncur di ponsel (viewport < 768 px; mis. fitur yang butuh aplikasi desktop).
   * Rutenya tetap dapat dibuka lewat URL.
   */
  hideOnPhone?: boolean;
  /**
   * Di peramban, menekan item ini juga membuka aplikasi desktop dengan akun yang sama (serah-terima tiket; halaman `to`
   * tetap terbuka sebagai cadangan bila aplikasi belum terpasang). Di aplikasi desktop item ini rute biasa.
   */
  opensDesktopApp?: boolean;
  /** Syarat tambahan di atas `permission` (keduanya harus terpenuhi), untuk aturan yang tak muat di satu izin. */
  visible?: (me: MeDto) => boolean;
}

/** Induk menu: hanya mengelompokkan anak (tak punya halaman sendiri); sidebar menampilkannya sebagai submenu. */
export interface NavParent {
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavItem[];
  /**
   * Hanya satu anak yang terlihat bagi pengguna: induk tampil sebagai butir biasa (label dan ikon induk, tujuan anak
   * itu) alih-alih submenu berisi satu butir.
   */
  collapseSingle?: boolean;
}

export type NavEntry = NavItem | NavParent;

export interface NavGroup {
  /** `null` = grup tanpa judul (Beranda). */
  label: string | null;
  items: NavEntry[];
}

export function isNavParent(entry: NavEntry): entry is NavParent {
  return 'children' in entry;
}

/** Semua butir bertujuan (anak induk ikut diratakan; induk sendiri tidak). */
export function flattenNavItems(groups: readonly NavGroup[]): NavItem[] {
  return groups.flatMap((group) =>
    group.items.flatMap((entry) => (isNavParent(entry) ? entry.children : [entry])),
  );
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { label: 'Beranda', to: '/', icon: House },
      // Tampil bagi pemegang izin sumber widget mana pun (BU atau lokasi; bukan satu izin modul, jadi `visible`).
      // Menu biasa tanpa submenu (keputusan pemilik 2026-11-25); laporan terjadwal dan tautan dibagikan ada di section
      // "Laporan" di bawahnya.
      {
        label: 'Dashboard',
        to: '/dashboard',
        icon: LayoutDashboard,
        excludes: ['/dashboard/laporan', '/dashboard/tautan'],
        visible: canSeeDashboard,
      },
      // Daftar unduhan aplikasi desktop; di dalam aplikasi desktop tautan unduh tak berfungsi, jadi hanya di peramban.
      {
        label: 'Aplikasi Desktop',
        to: '/desktop',
        icon: Download,
        webOnly: true,
        hideOnPhone: true,
      },
    ],
  },
  {
    label: 'Operasional',
    items: [
      {
        label: 'Serah Terima',
        to: '/handover',
        icon: ClipboardList,
        permission: [
          { module: 'handover', level: 'view', scope: 'location' },
          { module: 'qc', level: 'edit', scope: 'location' },
        ],
      },
      {
        label: 'Country Lock',
        to: '/country-lock',
        icon: Lock,
        permission: { module: 'countrylock', level: 'view' },
        opensDesktopApp: true,
        hideOnPhone: true,
      },
      {
        id: 'serial',
        label: 'Serial Number',
        icon: ListChecks,
        children: [
          {
            label: 'Daftar',
            to: '/serial',
            icon: ListChecks,
            excludes: ['/serial/settings', '/serial/report', '/serial/reports', '/serial/gudang'],
            permission: [
              { module: 'serial', level: 'view' },
              { module: 'serialservice', level: 'view' },
            ],
          },
          {
            label: 'Laporan',
            to: '/serial/reports',
            icon: FileText,
            // Halaman Lapor Rusak dibuka dari tombol di daftar Laporan (bukan menu sendiri), jadi menu ini yang menyala.
            alsoActiveOn: ['/serial/report'],
            permission: [
              { module: 'serial', level: 'view' },
              { module: 'serialservice', level: 'view' },
            ],
          },
          {
            label: 'Stok Ready',
            to: '/serial/gudang/ready',
            icon: Boxes,
            permission: { module: 'serialwh', level: 'view' },
          },
          {
            label: 'Riwayat Gudang',
            to: '/serial/gudang/riwayat',
            icon: History,
            // Form pencatatan dibuka dari tombol "Catat Serial WH" di daftar ini (bukan menu sendiri); Stok Ready punya
            // butir sendiri.
            alsoActiveOn: ['/serial/gudang'],
            excludes: ['/serial/gudang/ready'],
            permission: { module: 'serialwh', level: 'view' },
          },
          {
            label: 'Pengaturan',
            to: '/serial/settings',
            icon: Settings,
            permission: { module: 'serial', level: 'manage' },
            visible: canManageSerialSettings,
          },
        ],
      },
    ],
  },
  {
    label: 'Data Master',
    items: [
      {
        id: 'item',
        label: 'Item',
        icon: Package,
        children: [
          {
            label: 'Daftar Item',
            to: '/item',
            icon: Package,
            excludes: ['/item/brands'],
            permission: { module: 'item', level: 'view' },
          },
          {
            label: 'Merk',
            to: '/item/brands',
            icon: Tags,
            permission: { module: 'item', level: 'view' },
          },
        ],
      },
      {
        label: 'Customer',
        to: '/customer',
        icon: Contact,
        permission: { module: 'item', level: 'view' },
      },
    ],
  },
  {
    label: 'Stiker & Dokumen',
    items: [
      {
        id: 'sticker',
        label: 'Stiker',
        icon: Sticker,
        children: [
          {
            label: 'Katalog & Stok',
            to: '/sticker',
            icon: Sticker,
            excludes: ['/sticker/types', '/sticker/library', '/sticker/settings'],
            // Katalog dan stok digabung (2026-11-20): cukup salah satu izin.
            permission: [
              { module: 'sticker', level: 'view' },
              { module: 'stickerstock', level: 'view', scope: 'location' },
            ],
          },
          {
            label: 'Jenis',
            to: '/sticker/types',
            icon: Shapes,
            permission: { module: 'sticker', level: 'view' },
          },
          {
            label: 'Pustaka Gambar',
            to: '/sticker/library',
            icon: Images,
            permission: [
              { module: 'item', level: 'view' },
              { module: 'sticker', level: 'view' },
            ],
          },
          {
            label: 'Konfigurasi',
            to: '/sticker/settings',
            icon: Settings2,
            permission: { module: 'sticker', level: 'manage' },
          },
        ],
      },
      {
        id: 'manual-book',
        label: 'Manual Book',
        icon: BookOpen,
        children: [
          {
            label: 'QR Code',
            to: '/qrcode',
            icon: QrCode,
            excludes: ['/qrcode/default'],
            permission: { module: 'qrcode', level: 'view' },
          },
          {
            label: 'Default QR',
            to: '/qrcode/default',
            icon: SlidersHorizontal,
            // Sama dengan `beforeLoad` rute /qrcode/default.
            permission: { module: 'qrcode', level: 'manage' },
          },
        ],
      },
      {
        label: 'Postel',
        to: '/postel',
        icon: FileBadge,
        permission: { module: 'sticker', level: 'view' },
      },
    ],
  },
  {
    // Section tersendiri (bukan submenu Dashboard): pengelolaan laporan terjadwal dan tautan yang dibagikan.
    label: 'Laporan',
    items: [
      {
        label: 'Laporan terjadwal',
        to: '/dashboard/laporan',
        icon: CalendarClock,
        permission: { module: 'dashboard', level: 'edit' },
      },
      {
        label: 'Tautan dibagikan',
        to: '/dashboard/tautan',
        icon: Link2,
        permission: { module: 'dashboard', level: 'edit' },
      },
    ],
  },
  {
    label: 'Pengaturan',
    items: [
      {
        id: 'access',
        label: 'Akses',
        icon: UserCog,
        children: [
          {
            label: 'Pengguna',
            to: '/access/users',
            icon: Users,
            permission: { module: 'access', level: 'view' },
          },
          {
            label: 'Role',
            to: '/access/roles',
            icon: ShieldCheck,
            permission: { module: 'access', level: 'view' },
          },
          {
            label: 'Lokasi',
            to: '/access/locations',
            icon: MapPin,
            permission: { module: 'access', level: 'view' },
          },
          {
            label: 'Business Unit',
            to: '/access/business-units',
            icon: Building2,
            permission: { module: 'access', level: 'view' },
          },
        ],
      },
      {
        id: 'system',
        label: 'Sistem',
        icon: Wrench,
        children: [
          {
            label: 'Status Push',
            to: '/access/push',
            icon: BellRing,
            permission: { module: 'access', level: 'view' },
          },
          {
            label: 'Log Audit',
            to: '/access/audit',
            icon: History,
            permission: { module: 'access', level: 'view' },
          },
        ],
      },
    ],
  },
];

/** Aktif bila rute cocok (fuzzy kecuali beranda) dan bukan rute yang dikecualikan. */
export function isNavItemActive(
  item: NavItem,
  matches: (to: string, fuzzy: boolean) => boolean,
): boolean {
  // Pengecualian menang atas `alsoActiveOn` (Riwayat Gudang menaungi form pencatatan tetapi bukan Stok Ready).
  if ((item.excludes ?? []).some((to) => matches(to as string, true))) return false;
  if ((item.alsoActiveOn ?? []).some((to) => matches(to as string, true))) return true;
  return matches(item.to as string, item.to !== '/');
}

/** Butir aktif untuk rute saat ini beserta induknya; bila beberapa aktif, `to` terpanjang menang. */
export function findNavTrail(
  groups: readonly NavGroup[],
  matches: (to: string, fuzzy: boolean) => boolean,
): { parent: NavParent | null; item: NavItem } | null {
  let best: { parent: NavParent | null; item: NavItem } | null = null;
  const consider = (parent: NavParent | null, item: NavItem) => {
    if (!isNavItemActive(item, matches)) return;
    if (best === null || (item.to as string).length > (best.item.to as string).length) {
      best = { parent, item };
    }
  };
  for (const group of groups) {
    for (const entry of group.items) {
      if (isNavParent(entry)) for (const child of entry.children) consider(entry, child);
      else consider(null, entry);
    }
  }
  return best;
}

function isItemVisible(
  item: NavItem,
  me: MeDto,
  activeLocationIds: readonly string[] | undefined,
  desktop: boolean,
  phone: boolean,
): boolean {
  // Fitur yang butuh aplikasi desktop disembunyikan di ponsel, bukan di jendela sempit aplikasi desktop (Electron).
  if (item.hideOnPhone && phone && !desktop) return false;
  if (item.desktopOnly && !desktop) return false;
  if (item.webOnly && desktop) return false;
  if (item.visible && !item.visible(me)) return false;
  if (!item.permission) return true;
  const alternatives: readonly NavPermission[] = Array.isArray(item.permission)
    ? item.permission
    : [item.permission as NavPermission];
  return alternatives.some((permission) =>
    canAnywhere(
      me,
      permission.module,
      permission.level,
      permission.scope === 'location' ? activeLocationIds : undefined,
    ),
  );
}

/** Menyaring butir menurut izin; induk tanpa anak terlihat dan grup kosong dibuang. */
export function visibleNavGroups(
  groups: readonly NavGroup[],
  me: MeDto,
  activeLocationIds?: readonly string[],
  desktop = false,
  phone = false,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.flatMap((entry): NavEntry[] => {
        if (isNavParent(entry)) {
          const children = entry.children.filter((child) =>
            isItemVisible(child, me, activeLocationIds, desktop, phone),
          );
          const only = children[0];
          if (entry.collapseSingle && children.length === 1 && only) {
            return [{ ...only, label: entry.label, icon: entry.icon }];
          }
          return children.length > 0 ? [{ ...entry, children }] : [];
        }
        return isItemVisible(entry, me, activeLocationIds, desktop, phone) ? [entry] : [];
      }),
    }))
    .filter((group) => group.items.length > 0);
}
