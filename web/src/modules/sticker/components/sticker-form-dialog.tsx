import { formatBuLabel } from '@shared/business-units';
import type {
  BusinessUnitDto,
  BusinessUnitOptionDto,
  SaveBusinessUnitInput,
  SavePostelInput,
  StickerDto,
  StickerTypeDto,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { STICKER_LIMITS } from '@shared/stickers';
import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { LinkField, LinkMultiField, type LinkOption } from '@/components/link-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { describeError } from '@/lib/api/describe-error';
import { newUuid } from '@/lib/uuid';
import { BusinessUnitFormDialog } from '@/modules/access/components/business-unit-form-dialog';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { ImagePicker } from '@/modules/item/components/image-picker';
import { ImageThumb } from '@/modules/item/components/image-thumb';
import type { QrSubmitOptions } from '@/modules/qrcode/components/qr-design-form';
import type { QrFormOutput } from '@/modules/qrcode/schemas';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '../lib/stale';
import { stickerFormSchema } from '../schemas';
import {
  type ManualBookDraft,
  ManualBookSegment,
  PostelSegment,
  type SegmentHandle,
  UMUM_TAB,
} from './sticker-form-segments';
import {
  StickerTypeFormDialog,
  type StickerTypeSaveInput,
  type StickerTypeSaveResult,
  stickerTypeSaveFailure,
} from './sticker-type-form-dialog';

export interface StickerSaveInput {
  id?: string;
  /** Versi yang dilihat saat form dibuka; wajib saat ubah, tidak dikirim saat membuat. */
  expectedUpdatedAt?: string;
  typeId: string;
  name: string;
  alias: string;
  fileId: string | null;
  minQty: number;
  businessUnitIds: string[];
  /** Hanya stiker baru: stok awal per lokasi yang dicatat server bersama pembuatan stiker (izin stok per lokasi). */
  openingStocks?: { locationId: string; quantity: number; clientId: string }[];
}

/** Lokasi yang boleh dicatatkan stok awalnya oleh pengguna (`stickerstock: edit`). */
export interface StockLocationOption {
  id: string;
  name: string;
  code: string;
}

const FIELD_KEYS = [
  'typeId',
  'name',
  'alias',
  'fileId',
  'minQty',
  'businessUnitIds',
  'openingStock',
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type FieldErrors = Partial<Record<FieldKey, string>>;
type StickerValues = ReturnType<typeof stickerFormSchema.parse>;

/** Galat simpan: pesan umum dan, bila server menyebut field, pesan khusus field itu. */
export interface StickerSaveFailure extends FieldErrors {
  message: string;
}

export type StickerSaveResult = string | StickerSaveFailure | null;

/**
 * Hasil simpan segmen Postel/Manual Book: `fields` memuat galat per field dari server (campuran field stiker dan field
 * milik segmen; form stiker membagi sendiri menurut kuncinya).
 */
export type CompanionSaveResult =
  | string
  | { message: string; fields?: Record<string, string | undefined> }
  | null;

/** Mengubah galat API menjadi hasil simpan dialog (dipakai pemanggil yang memanggil API stiker). */
export function stickerSaveFailure(error: unknown): StickerSaveFailure {
  if (isStaleSaveError(error)) return { message: STALE_SAVE_MESSAGE };
  return { message: describeError(error), ...pickFieldErrors(error, FIELD_KEYS) };
}

export interface StickerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stiker yang diubah; kosong = stiker baru. */
  sticker?: StickerDto;
  /** Semua jenis; stiker baru hanya dapat memilih jenis aktif, jenis stiker lama tak dapat diubah. */
  types: readonly StickerTypeDto[];
  /** Semua BU; yang aktif ditawarkan, yang nonaktif hanya tampil bila sudah melekat pada stiker. */
  businessUnits: readonly BusinessUnitOptionDto[];
  /** `null` = berhasil (dialog menutup sendiri); string/objek = galat yang tampil di dialog. */
  onSave: (input: StickerSaveInput) => Promise<StickerSaveResult>;
  /**
   * Membuat jenis baru dari baris "Tambah Jenis" pada field Jenis; hanya disediakan bila user berhak menulis katalog
   * (`sticker: edit`). Jenis baru langsung terpilih. Melempar galat bila gagal (pesannya tampil di dialog).
   */
  onCreateType?: (input: StickerTypeSaveInput) => Promise<StickerTypeDto>;
  /** Membuat BU baru dari baris "Tambah BU" (hanya untuk `access: manage`); BU baru langsung terpilih. */
  onCreateBusinessUnit?: (input: SaveBusinessUnitInput) => Promise<BusinessUnitDto>;
  /** Tautan ke halaman lihat BU (tab baru); tidak disediakan bila user tak berhak melihatnya. */
  openBusinessUnitHref?: (id: string) => string | null;
  /** Tautan ke View jenis (tab baru) pada field Jenis; tidak disediakan bila user tak berhak melihatnya. */
  openStickerTypeHref?: (id: string) => string | null;
  /**
   * Lokasi tempat pengguna boleh mencatat stok masuk. Bila ada isinya, stiker BARU menampilkan bagian "Stok awal"
   * (jumlah + lokasi); kosong atau tidak diberikan = bagian itu tidak tampil (stiker lama tak pernah menampilkannya).
   */
  stockLocations?: readonly StockLocationOption[];
  /** Dialog "Tambah Jenis" dari field Jenis boleh mengisi minimum stok bawaan (`sticker: manage`). */
  canSetTypeDefaultMin?: boolean;
  /**
   * Menyimpan catatan Postel baru beserta stikernya (satu panggilan). Bila disediakan, jenis Postel dapat dipilih pada
   * stiker baru dan seluruh form Postel menjadi tab sejajar di dialog ini.
   */
  onSavePostel?: (input: SavePostelInput) => Promise<CompanionSaveResult>;
  /**
   * Menyimpan konfigurasi QR Manual Book baru. Bila disediakan (butuh `qrcode: edit`), jenis Manual Book dapat dipilih
   * dan seluruh form QR menjadi tab sejajar. Stiker Manual Book baru lahir saat QR diekspor, bukan saat simpan.
   */
  onSaveManualBook?: (
    values: QrFormOutput,
    options: QrSubmitOptions,
  ) => Promise<CompanionSaveResult>;
}

function buLabel(bu: BusinessUnitOptionDto): string {
  return `${formatBuLabel(bu)}${bu.status === 'inactive' ? ' — nonaktif' : ''}`;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} role="alert" className="text-sm text-destructive-text">
      {message}
    </p>
  ) : null;
}

export interface StickerFormProps extends Omit<StickerFormDialogProps, 'open' | 'onOpenChange'> {
  /** Id elemen `<form>`: tombol Simpan ada di luar form (footer dialog) dan memakai `form={formId}`. */
  formId: string;
  /** Dipanggil setelah simpan berhasil. */
  onClose: () => void;
  /** Proses simpan berjalan atau tidak (untuk tombol Simpan di luar form). */
  onBusyChange?: (busy: boolean) => void;
  /**
   * Simpan harus nonaktif: jenis/nama belum terisi atau gambar contoh masih diunggah atau gagal. Dilaporkan ke
   * pemilik tombol Simpan.
   */
  onBlockedChange?: (blocked: boolean) => void;
}

/**
 * Field form stiker: hanya `<form id={formId}>`, tanpa tombol. Terpasang hanya saat dialog terbuka, sehingga isian dan
 * galat selalu mulai bersih.
 */
export function StickerForm({
  formId,
  onBusyChange,
  onBlockedChange,
  sticker,
  types,
  businessUnits,
  onSave,
  onCreateType,
  onCreateBusinessUnit,
  openBusinessUnitHref,
  openStickerTypeHref,
  stockLocations,
  canSetTypeDefaultMin,
  onSavePostel,
  onSaveManualBook,
  onClose,
}: StickerFormProps) {
  // Ponsel: tanpa fokus otomatis (papan ketik layar akan menutupi separuh form).
  const desktop = useIsDesktop();
  const [typeId, setTypeId] = useState(sticker?.typeId ?? '');
  const [name, setName] = useState(sticker?.name ?? '');
  const [alias, setAlias] = useState(sticker?.alias ?? '');
  const [fileId, setFileId] = useState<string | null>(sticker?.fileId ?? null);
  const [minQty, setMinQty] = useState(sticker ? String(sticker.minQty) : '');
  const [businessUnitIds, setBusinessUnitIds] = useState<string[]>(sticker?.businessUnitIds ?? []);
  // Batas minimum terisi otomatis dari minimum bawaan jenis (stiker baru) sampai pengguna mengubahnya sendiri.
  const minTouched = useRef(false);
  const showOpeningStock = sticker === undefined && (stockLocations?.length ?? 0) > 0;
  // Daftar tetap: satu baris per lokasi yang boleh dicatat, jumlah bawaan 0 (kosong = 0). `clientId` per lokasi dibuat
  // sekali dan dipakai ulang saat Simpan ditekan lagi: kiriman ulang tak menggandakan stok awal.
  const [openingQty, setOpeningQty] = useState<Record<string, string>>({});
  const openingClientIds = useRef(new Map<string, string>());
  const [buTerm, setBuTerm] = useState('');
  const [typeTerm, setTypeTerm] = useState('');
  // Jenis/BU yang baru dibuat lewat dialog langsung bisa dipilih, sebelum daftar dari server dimuat ulang.
  const [createdTypes, setCreatedTypes] = useState<readonly StickerTypeDto[]>([]);
  const [createdBus, setCreatedBus] = useState<readonly BusinessUnitOptionDto[]>([]);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [buDialogOpen, setBuDialogOpen] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Tab sejajar (hanya bila jenis Postel/Manual Book dipilih): "umum" + tab milik form Postel/QR.
  const [tab, setTab] = useState<string>(UMUM_TAB);
  const [segmentBlocked, setSegmentBlocked] = useState(false);
  // Galat server milik form Postel/QR (bukan field stiker); diteruskan ke segmen yang memetakan ke tab-nya.
  const [segmentErrors, setSegmentErrors] = useState<Record<string, string | undefined>>({});
  const postelHandle = useRef<SegmentHandle<SavePostelInput> | null>(null);
  const manualBookHandle = useRef<SegmentHandle<ManualBookDraft> | null>(null);
  // Gambar contoh yang masih diunggah: Simpan ditahan agar gambarnya tidak tertinggal.
  const [imageBusy, setImageBusy] = useState(false);
  useUnsavedChanges(
    typeId !== (sticker?.typeId ?? '') ||
      name !== (sticker?.name ?? '') ||
      alias !== (sticker?.alias ?? '') ||
      fileId !== (sticker?.fileId ?? null) ||
      minQty !== (sticker ? String(sticker.minQty) : '') ||
      Object.values(openingQty).some((qty) => qty.trim() !== '' && Number(qty) !== 0) ||
      [...businessUnitIds].sort().join('|') !==
        [...(sticker?.businessUnitIds ?? [])].sort().join('|'),
  );
  // Versi saat form dibuka: tidak ikut berubah bila daftar dimuat ulang, agar versi usang tetap terdeteksi.
  const [expectedUpdatedAt] = useState(sticker?.updatedAt);

  // (efek penahan Simpan ada di bawah, setelah mode tab diketahui)

  const allTypes = [...types, ...createdTypes.filter((c) => !types.some((t) => t.id === c.id))];
  const allBus = [
    ...businessUnits,
    ...createdBus.filter((c) => !businessUnits.some((b) => b.id === c.id)),
  ];
  const selectedType = allTypes.find((type) => type.id === typeId);
  const needsBusinessUnits = selectedType?.rule === 'bu';
  // Stiker jenis sistem dikelola aplikasi: nama terkunci. Manual Book (lahir dari ekspor QR) mengunci juga gambarnya;
  // stiker Postel (satu per catatan Postel) boleh berganti gambar contoh.
  const systemKind = selectedType?.systemKind ?? '';
  const systemLocked = sticker !== undefined && systemKind !== '';
  // Stiker baru berjenis Postel/Manual Book: seluruh form catatan Postel / konfigurasi QR menjadi tab sejajar.
  const companion: 'postel' | 'manual_book' | null =
    sticker !== undefined
      ? null
      : systemKind === 'postel' && onSavePostel
        ? 'postel'
        : systemKind === 'manual_book' && onSaveManualBook
          ? 'manual_book'
          : null;
  useEffect(() => {
    onBlockedChange?.(
      imageBusy ||
        typeId === '' ||
        (companion === null && name.trim() === '') ||
        (companion !== null && segmentBlocked),
    );
  }, [imageBusy, name, typeId, companion, segmentBlocked, onBlockedChange]);
  // Jenis tak lagi Postel/Manual Book: kembali ke tab Umum dan bebaskan penahan segmen.
  useEffect(() => {
    if (companion === null) {
      setTab(UMUM_TAB);
      setSegmentBlocked(false);
    }
  }, [companion]);
  const imageLocked = sticker !== undefined && systemKind === 'manual_book';
  const typeHref = sticker ? (openStickerTypeHref?.(sticker.typeId) ?? null) : null;
  const buById = new Map(allBus.map((bu) => [bu.id, bu]));
  const selected = new Set(businessUnitIds);
  const termKey = normalizeKey(buTerm);
  const buOptions: LinkOption[] = allBus
    .filter((bu) => bu.status === 'active' && !selected.has(bu.id))
    .filter(
      (bu) =>
        termKey === '' ||
        normalizeKey(bu.name).includes(termKey) ||
        normalizeKey(bu.code).includes(termKey),
    )
    .map((bu) => ({ id: bu.id, label: buLabel(bu) }));
  const typeTermKey = normalizeKey(typeTerm);
  const typeOptions: LinkOption[] = allTypes
    .filter(
      (type) =>
        type.status === 'active' &&
        (type.systemKind === '' ||
          (type.systemKind === 'postel' && onSavePostel !== undefined) ||
          (type.systemKind === 'manual_book' && onSaveManualBook !== undefined)) &&
        (typeTermKey === '' || normalizeKey(type.name).includes(typeTermKey)),
    )
    .map((type) => ({ id: type.id, label: type.name }));

  /** Stiker baru: batas minimum mengikuti minimum bawaan jenis, kecuali pengguna sudah mengubahnya sendiri. */
  function applyDefaultMin(type: StickerTypeDto | undefined) {
    if (sticker || minTouched.current || !type) return;
    setMinQty(type.defaultMinQty > 0 ? String(type.defaultMinQty) : '');
  }

  function selectType(next: string) {
    setTypeId(next);
    clearError('typeId');
    const type = allTypes.find((item) => item.id === next);
    // Jenis tanpa aturan BU tidak boleh memuat BU: kosongkan pilihan lama.
    if (type?.rule !== 'bu') setBusinessUnitIds([]);
    applyDefaultMin(type);
  }

  async function handleCreateType(input: StickerTypeSaveInput): Promise<StickerTypeSaveResult> {
    if (!onCreateType) return 'Anda tidak berhak membuat jenis stiker';
    try {
      const created = await onCreateType(input);
      setCreatedTypes((previous) => [...previous, created]);
      // `allTypes` belum memuat jenis baru pada render ini: aturannya dipakai langsung dari hasil server.
      setTypeId(created.id);
      clearError('typeId');
      if (created.rule !== 'bu') setBusinessUnitIds([]);
      applyDefaultMin(created);
      return null;
    } catch (error) {
      return stickerTypeSaveFailure(error);
    }
  }

  async function handleCreateBusinessUnit(input: SaveBusinessUnitInput): Promise<void> {
    if (!onCreateBusinessUnit) throw new Error('Anda tidak berhak membuat BU');
    const created = await onCreateBusinessUnit(input);
    setCreatedBus((previous) => [
      ...previous,
      { id: created.id, code: created.code, name: created.name, status: created.status },
    ]);
    setBusinessUnitIds((previous) => [...previous, created.id]);
    clearError('businessUnitIds');
  }

  function updateOpeningQty(locationId: string, qty: string) {
    setOpeningQty((current) => ({ ...current, [locationId]: qty }));
    clearError('openingStock');
  }

  function openingClientId(locationId: string): string {
    let id = openingClientIds.current.get(locationId);
    if (id === undefined) {
      id = newUuid();
      openingClientIds.current.set(locationId, id);
    }
    return id;
  }

  function clearError(key: FieldKey) {
    setErrors((current) => ({ ...current, [key]: undefined }));
    setGeneralError(null);
  }

  /** Validasi sisi stiker (Umum); `null` bila ada galat (tampil di field). */
  function validateSticker(): {
    values: StickerValues;
    openingStocks?: StickerSaveInput['openingStocks'];
  } | null {
    const parsed = stickerFormSchema.safeParse({
      typeId,
      // Nama stiker Postel diturunkan server dari nama Postel: tak diisi di form.
      name: companion === 'postel' ? 'Postel' : name,
      alias,
      fileId,
      minQty: minQty.trim() === '' ? 0 : Number(minQty),
      businessUnitIds: needsBusinessUnits ? businessUnitIds : [],
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldKey;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return null;
    }
    if (needsBusinessUnits && parsed.data.businessUnitIds.length === 0) {
      setErrors({ businessUnitIds: 'Pilih minimal satu BU' });
      return null;
    }
    const openingStocks: NonNullable<StickerSaveInput['openingStocks']> = [];
    if (showOpeningStock) {
      for (const location of stockLocations ?? []) {
        const raw = (openingQty[location.id] ?? '').trim();
        if (raw === '') continue;
        const quantity = Number(raw);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > STICKER_LIMITS.qtyMax) {
          setErrors({
            openingStock: `Stok awal ${location.name} (${location.code}) harus bilangan bulat 0 sampai ${STICKER_LIMITS.qtyMax}`,
          });
          return null;
        }
        if (quantity === 0) continue;
        openingStocks.push({
          locationId: location.id,
          quantity,
          clientId: openingClientId(location.id),
        });
      }
      if (openingStocks.length > STICKER_LIMITS.openingRows) {
        setErrors({
          openingStock: `Stok awal maksimal ${STICKER_LIMITS.openingRows} lokasi sekaligus; sisanya catat lewat "Catat masuk" setelah stiker dibuat`,
        });
        return null;
      }
    }
    setErrors({});
    return { values: parsed.data, ...(openingStocks.length > 0 ? { openingStocks } : {}) };
  }

  /** Simpan segmen (Postel/Manual Book): satu aksi; galat server dibagi ke field stiker (Umum) dan field segmen. */
  async function runCompanion(call: () => Promise<CompanionSaveResult>) {
    setBusy(true);
    onBusyChange?.(true);
    let result: CompanionSaveResult;
    try {
      result = await call();
    } catch {
      result = 'Gagal menyimpan';
    }
    setBusy(false);
    onBusyChange?.(false);
    if (result === null) {
      onClose();
      return;
    }
    const message = typeof result === 'string' ? result : result.message;
    const fields = typeof result === 'string' ? {} : (result.fields ?? {});
    const stickerErrors: FieldErrors = {};
    const own: Record<string, string | undefined> = {};
    for (const [key, text] of Object.entries(fields)) {
      if (!text) continue;
      if ((FIELD_KEYS as readonly string[]).includes(key)) stickerErrors[key as FieldKey] = text;
      else own[key] = text;
    }
    setErrors(stickerErrors);
    setSegmentErrors(own);
    if (Object.values(stickerErrors).some(Boolean)) setTab(UMUM_TAB);
    setGeneralError(
      Object.keys(own).length > 0 || Object.keys(stickerErrors).length > 0 ? null : message,
    );
  }

  async function submit() {
    // Enter di kolom isian melewati tombol Simpan footer: penahan yang sama (gambar masih diunggah/gagal) berlaku.
    if (busy || imageBusy || (companion !== null && segmentBlocked)) return;
    setSegmentErrors({});
    if (companion === 'manual_book') {
      const draft = await manualBookHandle.current?.collect();
      if (!draft || !onSaveManualBook) return;
      await runCompanion(() => onSaveManualBook(draft.values, draft.options));
      return;
    }
    const checked = validateSticker();
    if (companion === 'postel') {
      // Kedua sisi divalidasi (galat tampil di tab masing-masing); galat Umum membuka tab Umum bila Postel sudah sah.
      const input = (await postelHandle.current?.collect()) ?? null;
      if (!checked) {
        if (input) setTab(UMUM_TAB);
        return;
      }
      if (!input || !onSavePostel) return;
      const data = checked.values;
      await runCompanion(() =>
        onSavePostel({
          ...input,
          sticker: {
            ...(data.alias === '' ? {} : { alias: data.alias }),
            minQty: data.minQty,
            ...(data.fileId ? { fileId: data.fileId } : {}),
            ...(checked.openingStocks ? { openingStocks: checked.openingStocks } : {}),
          },
        }),
      );
      return;
    }
    if (!checked) return;
    setBusy(true);
    onBusyChange?.(true);
    let failure: StickerSaveFailure | null;
    try {
      const values = checked.values;
      const input: StickerSaveInput = sticker
        ? {
            id: sticker.id,
            ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
            ...values,
          }
        : { ...values, ...(checked.openingStocks ? { openingStocks: checked.openingStocks } : {}) };
      const result = await onSave(input);
      failure = typeof result === 'string' ? { message: result } : result;
    } catch {
      // Galat tak terduga (mis. jaringan) menjadi pesan, bukan membuat tombol macet.
      failure = { message: 'Gagal menyimpan stiker' };
    }
    setBusy(false);
    onBusyChange?.(false);
    if (failure === null) {
      onClose();
      return;
    }
    const { message, ...fields } = failure;
    setErrors(fields);
    setGeneralError(Object.values(fields).some(Boolean) ? null : message);
  }

  const typeField = (
    <>
      {sticker ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Jenis</p>
          {typeHref ? (
            <a
              href={typeHref}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline underline-offset-2"
            >
              {sticker.typeName}
            </a>
          ) : (
            <p className="text-sm">{sticker.typeName}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Jenis tidak dapat diubah setelah stiker dibuat.
          </p>
          <FieldError id="sticker-form-type-error" message={errors.typeId} />
        </div>
      ) : (
        <LinkField
          id="sticker-form-type"
          required
          label="Jenis"
          placeholder="Pilih jenis"
          value={typeId === '' ? null : typeId}
          labelOf={(id) => allTypes.find((type) => type.id === id)?.name}
          openHref={openStickerTypeHref}
          options={typeOptions}
          onSearchChange={setTypeTerm}
          searchDebounceMs={0}
          onCreate={onCreateType ? () => setTypeDialogOpen(true) : undefined}
          onChange={(id) => selectType(id ?? '')}
          error={errors.typeId}
        />
      )}
    </>
  );
  const stickerFields = (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="sticker-form-name" required={companion !== 'postel'}>
          Nama stiker
        </Label>
        <Input
          id="sticker-form-name"
          aria-required={companion === 'postel' ? undefined : true}
          autoFocus={desktop && companion === null}
          maxLength={STICKER_LIMITS.nameMax}
          value={companion === 'postel' ? '' : name}
          placeholder={companion === 'postel' ? 'Otomatis dari nama Postel' : undefined}
          disabled={systemLocked || companion === 'postel'}
          aria-invalid={errors.name || generalError ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            clearError('name');
          }}
        />
        {companion === 'postel' ? (
          <p className="text-xs text-muted-foreground">
            Nama stiker Postel mengikuti nama Postel (dari tipe item yang dipilih di tab Item);
            tidak diisi di sini.
          </p>
        ) : null}
        {systemLocked ? (
          <p className="text-xs text-muted-foreground">
            {systemKind === 'postel'
              ? 'Stiker Postel dikelola aplikasi (satu stiker untuk tiap catatan Postel, namanya mengikuti nama Postel); nama dan jenis tidak dapat diubah, gambar contoh boleh diganti.'
              : 'Stiker jenis sistem dikelola aplikasi (lahir dari ekspor QR); nama, jenis, dan gambar tidak dapat diubah di sini.'}
          </p>
        ) : null}
        <FieldError
          id="sticker-form-name-error"
          message={errors.name ?? generalError ?? undefined}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sticker-form-alias">Alias</Label>
        <Input
          id="sticker-form-alias"
          maxLength={STICKER_LIMITS.aliasMax}
          value={alias}
          aria-invalid={errors.alias ? true : undefined}
          onChange={(event) => {
            setAlias(event.target.value);
            clearError('alias');
          }}
        />
        <p className="text-xs text-muted-foreground">
          Nama tampilan untuk tim QC; bila diisi, tampil menggantikan nama.
        </p>
        <FieldError id="sticker-form-alias-error" message={errors.alias} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Gambar contoh</p>
        {imageLocked ? (
          fileId ? (
            <ImageThumb id={fileId} alt={`Contoh ${name.trim() || 'stiker'}`} className="size-12" />
          ) : (
            <p className="text-sm text-muted-foreground">Tidak ada gambar contoh.</p>
          )
        ) : (
          <ImagePicker
            value={fileId}
            label={name.trim() || 'stiker'}
            onBusyChange={setImageBusy}
            onChange={(id) => {
              setFileId(id);
              clearError('fileId');
            }}
          />
        )}
        <FieldError id="sticker-form-file-error" message={errors.fileId} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sticker-form-min-qty">Batas minimum</Label>
        <Input
          id="sticker-form-min-qty"
          type="number"
          inputMode="numeric"
          min={0}
          max={STICKER_LIMITS.qtyMax}
          step={1}
          placeholder="0"
          value={minQty}
          aria-invalid={errors.minQty ? true : undefined}
          onChange={(event) => {
            minTouched.current = true;
            setMinQty(event.target.value);
            clearError('minQty');
          }}
        />
        <p className="text-xs text-muted-foreground">
          Peringatan "Menipis" bila total stok semua lokasi mencapai batas ini; 0 = tanpa
          peringatan.
          {sticker ? '' : ' Terisi otomatis dari minimum bawaan jenis, boleh diubah.'}
        </p>
        <FieldError id="sticker-form-min-qty-error" message={errors.minQty} />
      </div>
      {needsBusinessUnits ? (
        <LinkMultiField
          id="sticker-form-business-units"
          required
          label="BU"
          placeholder="Pilih BU"
          value={businessUnitIds}
          labelOf={(id) => {
            const bu = buById.get(id);
            return bu ? buLabel(bu) : id;
          }}
          options={buOptions}
          onSearchChange={setBuTerm}
          searchDebounceMs={0}
          onCreate={onCreateBusinessUnit ? () => setBuDialogOpen(true) : undefined}
          openHref={openBusinessUnitHref}
          onChange={(ids) => {
            setBusinessUnitIds(ids);
            clearError('businessUnitIds');
          }}
          error={errors.businessUnitIds}
        />
      ) : null}
      {showOpeningStock ? (
        <fieldset className="space-y-3 rounded-lg border p-3" data-section="opening-stock">
          <legend className="px-1 text-sm font-medium">Stok awal</legend>
          <p className="text-xs text-muted-foreground">
            Opsional. Isi jumlah di lokasi yang mendapat stok; lokasi berjumlah 0 diabaikan. Tiap
            lokasi dicatat sebagai stok masuk "Stok awal".
          </p>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1" data-opening-list>
            {(stockLocations ?? []).map((location) => {
              const inputId = `sticker-form-opening-qty-${location.id}`;
              return (
                <div
                  key={location.id}
                  className="grid grid-cols-[1fr_7rem] items-center gap-3"
                  data-opening-row={location.id}
                >
                  <Label htmlFor={inputId} className="break-words">
                    {`${location.name} (${location.code})`}
                  </Label>
                  <Input
                    id={inputId}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={STICKER_LIMITS.qtyMax}
                    step={1}
                    placeholder="0"
                    value={openingQty[location.id] ?? '0'}
                    aria-invalid={errors.openingStock ? true : undefined}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => updateOpeningQty(location.id, event.target.value)}
                  />
                </div>
              );
            })}
          </div>
          <FieldError id="sticker-form-opening-error" message={errors.openingStock} />
        </fieldset>
      ) : null}
    </>
  );
  const umumContent =
    companion === 'manual_book' ? (
      <div className="space-y-4">
        {typeField}
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          Stiker Manual Book lahir saat QR-nya diekspor (nama dan versinya dibuat otomatis, minimum
          awalnya mengikuti minimum bawaan jenis). Karena itu alias, minimum, gambar, dan stok
          diatur di katalog setelah ekspor. Isi tab lainnya untuk membuat konfigurasi QR Manual
          Book; ekspor dilakukan dari halaman QR setelah disimpan.
        </p>
      </div>
    ) : (
      <div className="space-y-4">
        {typeField}
        {stickerFields}
      </div>
    );
  const segmentProps = {
    umum: umumContent,
    umumHasError: Object.values(errors).some(Boolean),
    tab,
    onTabChange: setTab,
    onBlockedChange: setSegmentBlocked,
    fieldErrors: segmentErrors,
  };

  return (
    <>
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          // Dialog turunan (Tambah Item/preset) dirender lewat portal React: submitnya tak boleh memicu simpan stiker.
          if (event.target !== event.currentTarget) return;
          event.stopPropagation();
          void submit();
        }}
      >
        {companion === 'postel' ? (
          <PostelSegment {...segmentProps} handleRef={postelHandle} />
        ) : companion === 'manual_book' ? (
          <ManualBookSegment {...segmentProps} handleRef={manualBookHandle} />
        ) : (
          umumContent
        )}
        {companion !== null && generalError ? (
          <p role="alert" className="text-sm text-destructive-text">
            {generalError}
          </p>
        ) : null}
        {/* Penerima Enter di kolom isian: tombol Simpan sebenarnya ada di footer dialog (di luar form). */}
        <button type="submit" hidden tabIndex={-1} aria-hidden />
      </form>
      {/* Dialog turunan di luar <form>: event submit dari portalnya tidak menjalar ke form stiker. */}
      {onCreateType ? (
        <StickerTypeFormDialog
          open={typeDialogOpen}
          onOpenChange={setTypeDialogOpen}
          canSetDefaultMin={canSetTypeDefaultMin}
          onSave={handleCreateType}
        />
      ) : null}
      {onCreateBusinessUnit ? (
        <BusinessUnitFormDialog
          open={buDialogOpen}
          onOpenChange={setBuDialogOpen}
          onSave={handleCreateBusinessUnit}
        />
      ) : null}
    </>
  );
}

export const STICKER_FORM_ID = 'sticker-form';

/** Dialog tambah/ubah stiker; field BU hanya muncul untuk jenis berrule `bu`, jenis tak dapat diubah saat ubah. */
export function StickerFormDialog({
  open,
  onOpenChange,
  sticker,
  types,
  businessUnits,
  onSave,
  onCreateType,
  onCreateBusinessUnit,
  openBusinessUnitHref,
  openStickerTypeHref,
  stockLocations,
  canSetTypeDefaultMin,
  onSavePostel,
  onSaveManualBook,
}: StickerFormDialogProps) {
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(true);
  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={STICKER_FORM_ID}
      title={sticker ? `Ubah stiker ${sticker.alias || sticker.name}` : 'Tambah stiker'}
      description="Gambar contoh membantu tim QC mengenali stiker."
      submitting={busy}
      submitDisabled={blocked}
      size={onSavePostel || onSaveManualBook ? 'xl' : 'md'}
    >
      {open ? (
        <StickerForm
          key={sticker?.id ?? 'new'}
          formId={STICKER_FORM_ID}
          sticker={sticker}
          types={types}
          businessUnits={businessUnits}
          onSave={onSave}
          onCreateType={onCreateType}
          onCreateBusinessUnit={onCreateBusinessUnit}
          openBusinessUnitHref={openBusinessUnitHref}
          openStickerTypeHref={openStickerTypeHref}
          stockLocations={stockLocations}
          canSetTypeDefaultMin={canSetTypeDefaultMin}
          onSavePostel={onSavePostel}
          onSaveManualBook={onSaveManualBook}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
          onBlockedChange={setBlocked}
        />
      ) : null}
    </FormDialogShell>
  );
}
