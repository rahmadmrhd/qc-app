import type { QrPresetDto, SavePostelInput } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { type MutableRefObject, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type FormTab, FormTabs } from '@/components/page/form-tabs';
import { itemLinkAccess, qrPresetLinkAccess } from '@/lib/link-access';
import { meQueryOptions } from '@/modules/auth/queries';
import { usePostelFormTabs } from '@/modules/postel/components/postel-form';
import type { PostelFieldErrors } from '@/modules/postel/lib/schemas';
import { POSTEL_FIELD_KEYS } from '@/modules/postel/lib/schemas';
import { postelListQueryOptions } from '@/modules/postel/queries';
import {
  type QrSubmitOptions,
  useQrDesignFormTabs,
} from '@/modules/qrcode/components/qr-design-form';
import { qrDefaultsQueryOptions } from '@/modules/qrcode/queries';
import type { QrFormOutput } from '@/modules/qrcode/schemas';
import { toQrFormDefaults } from '@/modules/qrcode/schemas';

/**
 * Tab Postel dan Manual Book pada form pembuatan Stiker (keputusan pemilik 2026-11-25): bila jenis yang dipilih berjenis
 * sistem, seluruh form Postel/Manual Book menjadi tab BARU yang sejajar dengan tab "Umum" (satu `FormTabs` datar, tanpa
 * tab bersarang). Isi tab-tab itu berasal dari hook form aslinya (`usePostelFormTabs`, `useQrDesignFormTabs`), bukan
 * salinan. Form stiker hanya mengumpulkan hasilnya lewat `SegmentHandle.collect` lalu menyimpan dengan satu aksi.
 */

/** Pegangan yang dipasang segmen agar form stiker dapat memvalidasi dan mengambil isinya saat Simpan. */
export interface SegmentHandle<T> {
  /** Memvalidasi segmen (galat tampil di tab-nya) dan mengembalikan isinya; `null` bila belum sah. */
  collect: () => Promise<T | null>;
}

export const UMUM_TAB = 'umum';

export interface SegmentProps<T> {
  /** Isi tab "Umum" (field stiker); dirender form stiker. */
  umum: ReactNode;
  umumHasError: boolean;
  tab: string;
  onTabChange: (tab: string) => void;
  handleRef: MutableRefObject<SegmentHandle<T> | null>;
  /** Simpan harus ditahan (unggahan berjalan, atau form belum siap). */
  onBlockedChange: (blocked: boolean) => void;
  /** Galat server per field milik segmen (bukan field stiker). */
  fieldErrors?: Record<string, string | undefined> | undefined;
}

function umumTab(umum: ReactNode, hasError: boolean): FormTab {
  return { id: UMUM_TAB, label: 'Umum', hasError, content: umum };
}

function Loading({ umum, label }: { umum: ReactNode; label: string }) {
  return (
    <div className="space-y-4">
      {umum}
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Postel
// ---------------------------------------------------------------------------------------------------------------

/** Tab Postel: Item, Nomor sertifikat, serta Catatan dan lampiran, sejajar dengan tab "Umum". */
export function PostelSegment(props: SegmentProps<SavePostelInput>) {
  const list = useQuery(postelListQueryOptions());
  useEffect(() => {
    if (!list.data) props.onBlockedChange(true);
  }, [list.data, props.onBlockedChange]);
  if (!list.data) return <Loading umum={props.umum} label="Memuat form Postel…" />;
  return <PostelSegmentReady {...props} soonDays={list.data.soonDays} today={list.data.today} />;
}

function PostelSegmentReady({
  umum,
  umumHasError,
  tab,
  onTabChange,
  handleRef,
  onBlockedChange,
  fieldErrors,
  soonDays,
  today,
}: SegmentProps<SavePostelInput> & { soonDays: number; today: string }) {
  // Tanpa suspense: data pengguna sudah dimuat cangkang; bila belum, baris Tambah/Buka sekadar tak tampil.
  const me = useQuery(meQueryOptions()).data;
  const captured = useRef<SavePostelInput | null>(null);
  // Stabil selama `fieldErrors` sama: form Postel mereset galat "sudah dikoreksi" tiap objek galat berganti.
  const picked = useMemo(() => {
    const result: PostelFieldErrors = {};
    for (const key of POSTEL_FIELD_KEYS) {
      const message = fieldErrors?.[key];
      if (message) result[key] = message;
    }
    return result;
  }, [fieldErrors]);
  const { tabs, submit, uploading, submitError } = usePostelFormTabs({
    soonDays,
    today,
    canCreateItem: itemLinkAccess(me).canCreate,
    fieldErrors: picked,
    activeTab: tab,
    onActiveTabChange: onTabChange,
    // Tidak menyimpan di sini: form stiker yang menyimpan (stiker Postel lahir bersama catatannya, satu panggilan).
    onSubmit: async (input) => {
      captured.current = input;
      return null;
    },
  });
  // Dipasang tiap render (tertaut ke `submit` terbaru) dan dilepas saat segmen hilang.
  useEffect(() => {
    handleRef.current = {
      collect: async () => {
        captured.current = null;
        await submit();
        return captured.current;
      },
    };
    return () => {
      handleRef.current = null;
    };
  });
  useEffect(() => {
    onBlockedChange(uploading);
  }, [uploading, onBlockedChange]);
  const all: FormTab[] = [umumTab(umum, umumHasError), ...tabs];
  return (
    <div className="space-y-4">
      <FormTabs tabs={all} value={tab} onValueChange={onTabChange} />
      {submitError ? (
        <p role="alert" className="text-sm text-destructive-text">
          {submitError}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Manual Book
// ---------------------------------------------------------------------------------------------------------------

export interface ManualBookDraft {
  values: QrFormOutput;
  options: QrSubmitOptions;
}

/** Tab Manual Book (konfigurasi QR): Detail, Isi label, Logo dan bingkai, serta Ukuran, sejajar dengan tab "Umum". */
export function ManualBookSegment(props: SegmentProps<ManualBookDraft>) {
  const defaults = useQuery(qrDefaultsQueryOptions());
  useEffect(() => {
    if (!defaults.data) props.onBlockedChange(true);
  }, [defaults.data, props.onBlockedChange]);
  if (!defaults.data) return <Loading umum={props.umum} label="Memuat form Manual Book…" />;
  return (
    <ManualBookSegmentReady
      {...props}
      logoLibrary={defaults.data.logoFileIds}
      presets={defaults.data.presets}
    />
  );
}

const QR_TABS: readonly string[] = ['detail', 'label', 'logo', 'ukuran'];

function ManualBookSegmentReady({
  umum,
  umumHasError,
  tab,
  onTabChange,
  handleRef,
  onBlockedChange,
  fieldErrors,
  logoLibrary,
  presets,
}: SegmentProps<ManualBookDraft> & {
  logoLibrary: readonly string[];
  presets: readonly QrPresetDto[];
}) {
  // Tanpa suspense: data pengguna sudah dimuat cangkang; bila belum, baris Tambah/Buka sekadar tak tampil.
  const me = useQuery(meQueryOptions()).data;
  const captured = useRef<ManualBookDraft | null>(null);
  // Nilai awal dihitung sekali (form memakainya hanya saat dibuat).
  const [defaultValues] = useState(() => toQrFormDefaults());
  const { tabs, submit, alerts, preview, outside, blocked, submitting } = useQrDesignFormTabs({
    defaultValues,
    logoLibrary,
    presets,
    fieldErrors,
    activeTab: tab,
    onActiveTabChange: onTabChange,
    openItemHref: itemLinkAccess(me).openItemHref,
    canCreateItem: itemLinkAccess(me).canCreate,
    canCreatePreset: qrPresetLinkAccess(me).canCreate,
    openPresetHref: qrPresetLinkAccess(me).openPresetHref,
    canOpenDeletedItem: itemLinkAccess(me).canOpenDeleted,
    // Tidak menyimpan di sini: form stiker yang menyimpan (ekspor ke Drive tetap proses terpisah).
    onSubmit: (values, options) => {
      captured.current = { values, options };
    },
  });
  // Dipasang tiap render (tertaut ke `submit` terbaru) dan dilepas saat segmen hilang.
  useEffect(() => {
    handleRef.current = {
      collect: async () => {
        captured.current = null;
        await submit(false);
        return captured.current;
      },
    };
    return () => {
      handleRef.current = null;
    };
  });
  useEffect(() => {
    onBlockedChange(blocked || submitting);
  }, [blocked, submitting, onBlockedChange]);
  const all: FormTab[] = [umumTab(umum, umumHasError), ...tabs];
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="lg:col-span-2">{alerts}</div>
        <div className="min-w-0 space-y-4">
          <FormTabs tabs={all} value={tab} onValueChange={onTabChange} />
        </div>
        {preview && QR_TABS.includes(tab) ? (
          <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">{preview}</aside>
        ) : null}
      </div>
      {outside}
    </>
  );
}
