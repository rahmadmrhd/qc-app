import type { Assignment, LocationPermissionMap } from './assignments';
import type {
  BatchResult,
  IdBatchInput,
  ListStatusFilter,
  RemoveBatchResult,
  RemoveResult,
  SoftDeleteInfo,
  StatusBatchInput,
} from './batch';
import type { BuAssignment, BuPermissionMap } from './business-units';
import type { GuideProgressDto } from './guides';
import type { HandoverStatus } from './handover';
import type { NotificationDto } from './notifications';
import type { PartialPermissionMap, PermissionMap } from './permissions';
import type { PostelCondition, PostelRole } from './postel';
import type { QrExportStatus, QrLayout, QrLinkSource, QrNamePlacement, QrStyle } from './qrcode';
import type {
  SerialCustody,
  SerialEventType,
  SerialProofState,
  SerialStatus,
  ServiceDiagnosisStage,
} from './serials';
import type {
  GuideSort,
  StickerMarkTarget,
  StickerRule,
  StickerStatus,
  StickerSystemKind,
  StockCount,
  StockEntryKind,
} from './stickers';

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type UserStatus = 'active' | 'inactive';

export interface LocationAccessDto {
  id: string;
  code: string;
  name: string;
  /** Izin efektif user di lokasi ini (gabungan "Semua lokasi" dan penugasan lokasi). */
  permissions: LocationPermissionMap;
}

export interface BusinessUnitAccessDto extends BusinessUnitOptionDto {
  /** Izin efektif user di BU ini (gabungan "Semua BU" dan penugasan BU itu) untuk modul ber-BU. */
  permissions: BuPermissionMap;
  /**
   * BU sudah dihapus (soft delete). Entri TETAP ada karena BU terhapus tetap memberi hak (keputusan pemilik 9), tetapi
   * tidak boleh ditawarkan di pilihan/filter. Tak ada pada `me` lama = false.
   */
  deleted?: boolean;
}

export interface MeDto {
  email: string;
  name: string;
  isSuperAdmin: boolean;
  /**
   * Boleh membaca/mengubah penerima surel "Serial Number rusak" (`serialSettings.get|save`): dihitung server dengan
   * aturan penjaga rute itu (super admin, atau `serial: manage` pada SETIAP BU). Hanya untuk menampilkan menu.
   */
  canManageSerialSettings: boolean;
  /** Izin GLOBAL: hanya dari penugasan "Semua lokasi" (satu-satunya sumber modul `access`). */
  permissions: PermissionMap;
  /** Lokasi aktif yang boleh diakses, terurut menurut kode. */
  locations: LocationAccessDto[];
  /** BU yang user punya level apa pun atasnya (termasuk BU nonaktif), terurut menurut kode. */
  businessUnits: BusinessUnitAccessDto[];
  /**
   * Id SEMUA BU yang terhapus (soft delete), bukan hanya yang ada di penugasan user: syarat tulis "SEMUA BU item"
   * mengabaikan BU terhapus (keputusan pemilik 9), jadi web perlu mengenalinya juga untuk BU yang bukan miliknya
   * (item ber-BU {hidup, terhapus}). Hanya id; tidak sensitif. Opsional: salinan `me` tersimpan lama tak memuatnya.
   */
  deletedBusinessUnitIds?: string[];
  /**
   * Akun bersama (dipakai beberapa orang): panduan interaktif tetap ditawarkan, tetapi penandanya disimpan per
   * perangkat (bukan di server), jadi ditawarkan lagi di tiap perangkat.
   */
  sharedAccount: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  assignments: Assignment[];
  /** Penugasan BU (`buId: null` = Semua BU); berlaku sama di semua lokasi. */
  buAssignments: BuAssignment[];
  /** Akun bersama (dipakai beberapa orang); lihat `MeDto.sharedAccount`. */
  sharedAccount: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RoleDto {
  id: string;
  name: string;
  description: string;
  permissions: PartialPermissionMap;
  userCount: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SaveUserInput {
  id?: string;
  email: string;
  name: string;
  status: UserStatus;
  assignments: Assignment[];
  buAssignments: BuAssignment[];
  /** Tidak dikirim = tidak berubah (user baru: false). */
  sharedAccount?: boolean;
}

export interface MarkGuideInput {
  id: string;
  version: number;
}

export interface ResetGuideInput {
  id: string;
}

export interface SetUserStatusInput {
  id: string;
  status: UserStatus;
}

export interface SaveRoleInput {
  id?: string;
  name: string;
  description: string;
  permissions: PartialPermissionMap;
}

export interface DeleteRoleInput {
  id: string;
}

/** Snapshot field bisnis pada satu sisi perubahan; null = tidak ada (before pada create, after pada delete). */
export type AuditSnapshot = Record<string, unknown> | null;

export interface AuditEntryDto {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  before: AuditSnapshot;
  after: AuditSnapshot;
}

export interface ListAuditInput {
  page?: number;
  /** Aksi persis, mis. `user.update`; kosong = semua. */
  action?: string;
  /** Kata kunci pada target atau pelaku. */
  query?: string;
}

export interface AuditPageDto {
  entries: AuditEntryDto[];
  total: number;
  page: number;
  pageSize: number;
}

export type LocationStatus = 'active' | 'inactive';

export interface LocationDto {
  id: string;
  /** Kode unik, huruf besar/angka/tanda hubung, maks. 10; tidak dapat diubah setelah dibuat. */
  code: string;
  name: string;
  status: LocationStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SaveLocationInput {
  id?: string;
  code: string;
  name: string;
}

export interface SetLocationStatusInput {
  id: string;
  status: LocationStatus;
}

export type BusinessUnitStatus = 'active' | 'inactive';

export interface BusinessUnitRefDto {
  id: string;
  code: string;
  name: string;
}

/** Ringkasan BU untuk pemilih (Merk, form item): tanpa hitungan dan metadata. */
export interface BusinessUnitOptionDto extends BusinessUnitRefDto {
  status: BusinessUnitStatus;
}

export interface BusinessUnitDto extends BusinessUnitOptionDto {
  /** Jumlah baris `item_business_units` (item yang bertaut ke BU ini). */
  itemCount: number;
  /** Jumlah user yang `bu_assignments`-nya memuat BU ini secara eksplisit atau "Semua BU". */
  userCount: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SaveBusinessUnitInput {
  id?: string;
  /** Huruf besar/angka/tanda hubung, maks. 10; tidak dapat diubah setelah dibuat. */
  code: string;
  name: string;
}

export interface SetBusinessUnitStatusInput {
  id: string;
  status: BusinessUnitStatus;
}

export interface FileDto {
  id: string;
  mime: string;
  size: number;
  width: number;
  height: number;
}

/** Unggah gambar (kontrak REST): byte mentah; `mime` = Content-Type badan. */
export interface UploadFileInput {
  mime: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface GetFileInput {
  id: string;
}

/** Gambar pustaka stiker (tahap 3b-1): metadata; thumbnail diambil lewat `stickerGuides.thumbnail`. */
export interface StickerGuideDto {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  uploadedBy: string;
  uploadedByMe: boolean;
  createdAt: string;
  /** Jumlah item yang memakai gambar ini sebagai gambar acuan penempelan (penempatan di item). */
  usageCount: number;
  canRename: boolean;
  canRemove: boolean;
}

export interface ListStickerGuidesInput {
  search?: string;
  sort?: GuideSort;
  /** Hanya gambar yang diunggah pengguna ini. */
  mine?: boolean;
  /** Hanya gambar yang belum dipakai item mana pun. */
  unused?: boolean;
  cursor?: string;
  limit?: number;
}

export interface StickerGuidePageDto {
  items: StickerGuideDto[];
  nextCursor: string | null;
}

/** Unggah gambar pustaka: gambar penuh dan thumbnail sebagai bagian multipart `image` dan `thumbnail`. */
export interface UploadStickerGuideInput {
  name: string;
  mime: string;
  thumbMime: string;
  width: number;
  height: number;
  image: Uint8Array;
  thumbnail: Uint8Array;
}

export interface RenameStickerGuideInput {
  id: string;
  name: string;
}

export interface RemoveStickerGuideInput {
  id: string;
}

export interface GetStickerGuideThumbInput {
  id: string;
}

export interface FileContentDto {
  id: string;
  mime: string;
  bytes: Uint8Array;
}
export type ItemStatus = 'active' | 'inactive';

/** Penanda pada foto instruksi: posisi (permil 0..1000) dan sasarannya. */
export interface ItemStickerMarkDto {
  x: number;
  y: number;
  target: StickerMarkTarget;
  note: string;
}

/** Foto instruksi pada simpan item: gambar pustaka, catatan, label BU (murni tampilan), dan penanda berurutan. */
export interface ItemStickerPhotoInput {
  guideId: string;
  caption: string;
  /** Label BU foto; harus salah satu BU item, atau `null` (tanpa label). */
  buId: string | null;
  marks: ItemStickerMarkDto[];
}

/** Stiker hasil penerjemahan sasaran penanda. */
export interface ResolvedStickerDto {
  id: string;
  name: string;
  alias: string;
  /** Id berkas gambar stiker, atau `null`. */
  fileId: string | null;
  /** Kode BU stiker (terurut). */
  buCodes: string[];
  inactive: boolean;
}

/** Penanda untuk tampilan: sasaran + nama + stiker yang cocok untuk BU item. */
export interface ItemStickerMarkView extends ItemStickerMarkDto {
  /** Nama stiker atau jenis sasaran. */
  targetName: string;
  resolved: ResolvedStickerDto[];
  /** Jenis tanpa stiker aktif yang cocok untuk BU item (peringatan; simpan tidak diblokir). */
  unresolved: boolean;
}

export interface ItemStickerPhotoDto {
  guideId: string;
  guideName: string;
  /** Dimensi gambar pustaka (piksel). */
  width: number;
  height: number;
  caption: string;
  buId: string | null;
  marks: ItemStickerMarkView[];
}

/** Pemakaian gambar pustaka oleh sebuah item (`stickerGuides.usages`). */
export interface GuideUsageDto {
  itemId: string;
  /** Nama tampilan item (merk + model). */
  label: string;
  status: ItemStatus;
}

export interface ListGuideUsagesInput {
  id: string;
}

export interface ItemAccessoryDto {
  name: string;
  /** Jumlah per unit. */
  qty: number;
}

export interface BrandDto {
  id: string;
  name: string;
  status: ItemStatus;
  /** Jumlah item HIDUP (aktif maupun nonaktif, tanpa yang terhapus; semua BU) yang memakai merk ini. */
  itemCount: number;
  updatedAt: string;
  /** BU bawaan merk (terurut menurut kode BU); hanya mengisi otomatis form item, tidak memberi hak apa pun. */
  businessUnitIds: string[];
  /** Ada hanya pada merk terhapus (soft delete); jejak penghapusan. */
  deleted?: SoftDeleteInfo;
}

export interface ListBrandsInput {
  /** Bawaan = merk hidup (aktif + nonaktif). `deleted` hanya bagi `item: manage`; selain itu `FORBIDDEN`. */
  status?: ListStatusFilter;
}

export interface GetBrandInput {
  id: string;
}

export interface SaveBrandInput {
  id?: string;
  name: string;
  /** BU bawaan (boleh kosong, tanpa kembar). Mengubah merk menggantikan himpunan lama seluruhnya. */
  businessUnitIds: string[];
}

export interface SetBrandStatusInput {
  id: string;
  status: ItemStatus;
}

/** Jenis stiker (katalog stiker, tahap 3a). */
export interface StickerTypeDto {
  id: string;
  name: string;
  rule: StickerRule;
  status: ItemStatus;
  /** Jenis sistem (`''` = jenis biasa): stiker dikelola aplikasi dan jenisnya tak dapat diubah lewat form katalog. */
  systemKind: StickerSystemKind;
  /** Minimum stok bawaan bagi stiker versi pertama pada jenis ini (0 = tanpa peringatan). */
  defaultMinQty: number;
  /** Jumlah stiker (aktif maupun nonaktif) pada jenis ini. */
  stickerCount: number;
  updatedAt: string;
}

export interface SaveStickerTypeInput {
  id?: string;
  /** `updatedAt` yang dilihat penyimpan; wajib saat `id` ada (usang = galat usang, 412 lewat If-Match). */
  expectedUpdatedAt?: string;
  name: string;
  /** Tak dapat diubah bila jenis sudah punya stiker. */
  rule: StickerRule;
}

export interface SetStickerTypeStatusInput {
  id: string;
  status: ItemStatus;
}

/** Stiker (katalog stiker, tahap 3a). `low` dihitung dari total stok semua lokasi (`isLowStock`). */
export interface StickerDto {
  id: string;
  typeId: string;
  typeName: string;
  name: string;
  /** Nama tampilan untuk tim QC; kosong bila tidak ada. */
  alias: string;
  fileId: string | null;
  /** Batas minimum stok (butir) total semua lokasi; 0 = tanpa peringatan. */
  minQty: number;
  /** `deprecated` = digantikan versi Manual Book yang lebih baru; hanya dapat menjadi nonaktif. */
  status: StickerStatus;
  /** BU tertaut (terurut menurut kode BU); kosong untuk jenis berrule `none` atau `group`. */
  businessUnitIds: string[];
  low: boolean;
  /**
   * Hanya stiker jenis sistem Manual Book: true bila ini versi TERBARU konfigurasinya (satu-satunya yang boleh
   * diaktifkan kembali setelah dinonaktifkan). False untuk stiker biasa dan versi yang sudah digantikan.
   */
  latestManualBookVersion: boolean;
  updatedAt: string;
}

export interface SaveStickerInput {
  id?: string;
  /** `updatedAt` yang dilihat penyimpan; wajib saat `id` ada (usang = galat usang, 412 lewat If-Match). */
  expectedUpdatedAt?: string;
  /** Tak dapat diubah setelah stiker dibuat. */
  typeId: string;
  name: string;
  alias: string;
  fileId: string | null;
  minQty: number;
  /** Jenis berrule `bu`: minimal satu; jenis berrule `none`: harus kosong. */
  businessUnitIds: string[];
}

/** Pengaturan email ringkasan harian stok stiker menipis (Konfigurasi Stiker). */
export interface StickerAlertSettings {
  enabled: boolean;
  /** Maks. 20 alamat email sah dan unik. */
  recipients: string[];
  /** Jam (0-23, WIB) paling awal ringkasan dikirim pada hari itu. */
  digestHour: number;
  /** Selang minimum antar ringkasan (hari, 1-365): 1 = tiap hari bila ada stok menipis; bawaan 1. */
  intervalDays: number;
}

/** Jenis stiker beserta minimum bawaan stiker barunya, untuk halaman Konfigurasi Stiker. */
export interface StickerSettingsTypeDto {
  id: string;
  name: string;
  systemKind: StickerSystemKind;
  /** Minimum bawaan stiker baru jenis ini (butir); 0 = tanpa peringatan. */
  defaultMinQty: number;
}

export interface StickerSettingsDto {
  alert: StickerAlertSettings;
  types: StickerSettingsTypeDto[];
  /** Versi pengaturan email ('' bila belum pernah disimpan). */
  updatedAt: string;
  /** Server punya SMTP terkonfigurasi (tanpa itu ringkasan tak terkirim). */
  smtpConfigured: boolean;
}

export interface SaveStickerSettingsInput {
  /** `updatedAt` yang dilihat penyimpan ('' bila belum pernah disimpan); usang = galat usang (412 lewat If-Match). */
  expectedUpdatedAt: string;
  alert: StickerAlertSettings;
  /** Hanya jenis yang disebut yang diubah. */
  defaults: Array<{ typeId: string; defaultMinQty: number }>;
}

export interface SetStickerStatusInput {
  id: string;
  status: ItemStatus;
}

/** Satu baris halaman Stok Stiker untuk lokasi yang diminta (tanpa gambar contoh). */
export interface StickerStockDto {
  stickerId: string;
  /** Alias bila ada, selain itu nama stiker. */
  name: string;
  typeName: string;
  /** Status jenis: jenis nonaktif menolak stok masuk (keluar, koreksi, dan opname tetap boleh). */
  typeStatus: ItemStatus;
  status: StickerStatus;
  minQty: number;
  /** Menipis menurut total SEMUA lokasi (sama dengan `StickerDto.low`), bukan hanya lokasi yang diminta. */
  low: boolean;
  /** Jumlah butir di lokasi yang diminta saja. */
  total: number;
  /** Satu entri per lokasi yang diminta (urut permintaan); 0 bila belum ada stok. */
  byLocation: { locationId: string; qty: number }[];
}

export interface ListStickerStockInput {
  locationIds: string[];
}

export interface RecordStockInput {
  locationId: string;
  stickerId: string;
  kind: 'in' | 'out';
  /** Tepat satu dari `quantity` atau `count`. */
  quantity?: number;
  count?: StockCount;
  /** Wajib untuk `out`. */
  reason: string;
}

export interface AdjustStockInput {
  locationId: string;
  stickerId: string;
  /** Bertanda, bukan 0. */
  delta: number;
  /** Wajib. */
  reason: string;
}

/** Satu baris stok opname: hitungan fisik untuk satu stiker di satu lokasi. */
export interface OpnameRowInput {
  stickerId: string;
  locationId: string;
  /** Stok tersimpan yang dilihat penghitung; berbeda dari stok sekarang = usang (seluruh permintaan ditolak). */
  expectedQty: number;
  count: StockCount;
}

export interface OpnameInput {
  /** 1..100 baris, pasangan stiker x lokasi unik. */
  rows: OpnameRowInput[];
  /** Diturunkan server dari `rows` agar router memeriksa SEMUA lokasi; isian klien diabaikan. */
  locationIds?: string[];
}

export interface StockEntryDto {
  id: string;
  stickerId: string;
  locationId: string;
  kind: StockEntryKind;
  delta: number;
  qtyAfter: number;
  count: StockCount | null;
  reason: string;
  actor: string;
  ts: string;
}

export interface StockHistoryInput {
  locationIds: string[];
  stickerId?: string;
  cursor?: string;
  /** Bawaan 50, maksimum 200. */
  limit?: number;
}

export interface StockHistoryPageDto {
  entries: StockEntryDto[];
  nextCursor: string | null;
}

export interface ItemSummaryDto {
  id: string;
  brandId: string;
  /** Nama merk (dari tabel merk). */
  brand: string;
  model: string;
  isCountryLock: boolean;
  status: ItemStatus;
  aliases: string[];
  imageCount: number;
  /** Ada minimal satu penanda instruksi stiker. */
  hasInstructions: boolean;
  /** Item tergabung ke konfigurasi QR (Manual Book) yang sudah punya minimal satu versi (stiker Manual Book). */
  hasManualBook: boolean;
  /** Item tertaut ke catatan Postel yang ada (tanpa identitas catatan; dihitung untuk semua pembaca). */
  hasPostel: boolean;
  /** Semua BU item (bukan hanya yang terlihat user), terurut menurut kode. */
  businessUnits: BusinessUnitRefDto[];
  updatedAt: string;
  /** Ada hanya pada item terhapus (soft delete); jejak penghapusan. */
  deleted?: SoftDeleteInfo;
  /** True bila merk item ini terhapus (rujukan tampil dengan nama + "Terhapus"). */
  brandDeleted?: boolean;
}

/** Manual Book sebuah item: konfigurasi QR yang menaunginya dan versi terbarunya. */
export interface ItemManualBookDto {
  designId: string;
  /** Nama Manual Book (nama konfigurasi QR). */
  name: string;
  /** Versi terbaru. */
  version: number;
  /** Status stiker versi terbaru. */
  status: StickerStatus;
}

/** Postel sebuah item: catatan yang menaunginya dan nomor Aktifnya (kondisi dihitung terhadap tanggal WIB server). */
export interface ItemPostelDto {
  id: string;
  /** Nama catatan (turunan dari tipe semua item catatan). */
  name: string;
  /** Nomor sertifikat Aktif (seq terbesar). */
  number: string;
  /** Tanggal kedaluwarsa nomor Aktif, 'YYYY-MM-DD' (WIB). */
  expiresOn: string;
  condition: PostelCondition;
  /** Sisa hari sampai `expiresOn` (negatif = sudah lewat). */
  daysLeft: number;
}

export interface ItemDto extends ItemSummaryDto {
  /** Null bila item belum punya Manual Book berversi. */
  manualBook: ItemManualBookDto | null;
  /** Diisi hanya bila pemanggil punya `sticker: view` dan item tertaut ke catatan Postel; selain itu null. */
  postel: ItemPostelDto | null;
  stickerPhotos: ItemStickerPhotoDto[];
  accessories: ItemAccessoryDto[];
  /** Id berkas galeri (sheet `files`), urut. */
  attachments: string[];
  /** Detail Markdown. */
  detail: string;
  /** Kode firmware Country Lock (`shared/firmware.ts`); '' = belum diisi atau bukan item Country lock. */
  firmware: string;
  /** Item wajib foto bukti pada Catat Serial (spek 2026-11-18); `proofMin` selalu 1 bila tidak wajib. */
  proofRequired: boolean;
  /** Jumlah foto bukti minimum (1 sampai `SERIAL_PROOF_LIMITS.perEntryMax`). */
  proofMin: number;
  createdAt: string;
  updatedBy: string;
}

export interface SaveItemInput {
  id?: string;
  /** `updatedAt` item saat form dimuat; bila sudah berbeda, simpan ditolak (CONFLICT) agar tidak menimpa ubahan orang lain. */
  expectedUpdatedAt?: string;
  /** Id merk yang sudah ada (merk baru dibuat lewat `brands.save`, bukan dari teks). */
  brandId: string;
  model: string;
  isCountryLock: boolean;
  /**
   * Kode firmware Country Lock; harus salah satu kode merk itu (`shared/firmware.ts`) atau '' dan hanya untuk item
   * Country lock (selain itu ditolak). Tidak dikirim = tak diubah (klien lama), dan dikosongkan bila item bukan Country
   * lock atau kodenya tak berlaku bagi merk baru.
   */
  firmware?: string;
  /** Wajib foto bukti; tidak dikirim = tak diubah (klien lama), item baru = false. */
  proofRequired?: boolean;
  /** Minimum foto (1 sampai 5); tidak dikirim = tak diubah, item baru = 1; disimpan 1 bila `proofRequired` salah. */
  proofMin?: number;
  aliases: string[];
  /** Instruksi stiker; PUT utuh (daftar kosong = tanpa instruksi). */
  stickerPhotos: ItemStickerPhotoInput[];
  accessories: ItemAccessoryDto[];
  attachments: string[];
  detail: string;
  /** BU item (minimal satu, tanpa kembar). */
  businessUnitIds: string[];
}

export interface GetItemInput {
  id: string;
}

export interface SetItemStatusInput {
  id: string;
  status: ItemStatus;
}

export interface CustomerDto {
  id: string;
  name: string;
  status: ItemStatus;
  updatedAt: string;
}

export interface RenameCustomerInput {
  id: string;
  name: string;
}

export interface SetCustomerStatusInput {
  id: string;
  status: ItemStatus;
}

export interface HandoverOptionCustomerDto {
  id: string;
  name: string;
}

export interface HandoverOptionsDto {
  customers: HandoverOptionCustomerDto[];
  /** Nama customer nonaktif: dipakai form untuk memberi petunjuk sebelum simpan ditolak. */
  inactiveCustomerNames: string[];
}

/** Butir checklist tingkat atas pada catatan; `checked`/`by`/`at` berasal dari centang QC. */
export interface HandoverChecklistItemDto {
  index: number;
  text: string;
  checked: boolean;
  by: string;
  at: string;
}

export interface HandoverCommentDto {
  id: string;
  quote: string;
  before: string;
  after: string;
  body: string;
  author: string;
  at: string;
  /** Kutipan tak lagi ditemukan pada catatan (catatan disunting). */
  stale: boolean;
}

export interface HandoverDto {
  id: string;
  number: string;
  locationId: string;
  customerId: string;
  customerName: string;
  note: string;
  status: HandoverStatus;
  checklist: HandoverChecklistItemDto[];
  comments: HandoverCommentDto[];
  completedAt: string;
  completedBy: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ListHandoversInput {
  locationIds: string[];
}

export interface GetHandoverInput {
  id: string;
  locationIds: string[];
}

export interface HandoverSaveBase {
  note: string;
  customerId: string;
  status: HandoverStatus;
}

export interface SaveHandoverInput {
  id?: string;
  /** `updatedAt` task saat form dimuat; bila sudah berbeda, simpan ditolak (CONFLICT) kecuali `base` menunjukkan hanya centang/komentar yang berubah. */
  expectedUpdatedAt?: string;
  /**
   * Keadaan task saat form ubah dibuka. Bila `updatedAt` sudah berbeda tetapi catatan, customer, dan status
   * (Selesai/Dibatalkan) sama dengan `base`, perubahan di antaranya hanya centang/komentar dan simpan tidak CONFLICT.
   */
  base?: HandoverSaveBase;
  locationId: string;
  /** Nama customer; yang belum ada dibuat saat task disimpan (FC2). */
  customerName: string;
  /** Catatan Markdown; butir "- [ ]" menjadi checklist. */
  note: string;
}

export interface SaveHandoverBatchInput {
  locationId: string;
  /**
   * `clientId` (UUID huruf kecil) opsional = kunci idempoten per task: kirim ulang yang sama (antrean offline)
   * mengembalikan task yang sudah ada tanpa membuat duplikat. Bila ada pada sebagian task, dan sebagian sudah
   * tersimpan, permintaan ditolak `CONFLICT`.
   */
  tasks: Array<{ customerName: string; note: string; clientId?: string }>;
}

export interface HandoverRefInput {
  id: string;
  locationId: string;
}

export interface SetCheckInput extends HandoverRefInput {
  index: number;
  text: string;
  checked: boolean;
}

/** Hanya menyelesaikan task; task Selesai tidak dibuka kembali (lihat `handovers.reopen` untuk Dibatalkan). */
export type SetDoneInput = HandoverRefInput;

export interface AddCommentInput extends HandoverRefInput {
  /** Kutipan dari catatan; kosong = komentar umum (tanpa seleksi, tidak pernah usang). */
  quote: string;
  before: string;
  after: string;
  body: string;
  /** Kunci idempoten (UUID huruf kecil): kirim ulang yang sama mengembalikan task apa adanya tanpa komentar ganda. */
  clientId?: string;
}

// --- QR Code Label ---
/** Item yang tergabung ke satu konfigurasi QR (Manual Book); hanya item yang terlihat bagi pembaca. */
export interface QrDesignItemDto {
  id: string;
  brand: string;
  model: string;
  /** True bila item ini terhapus (soft delete): tampil bertanda "Terhapus", tak dihitung di `itemCount` mana pun. */
  deleted?: boolean;
}
export interface QrDesignDto {
  id: string;
  /** Nama Manual Book (dihasilkan dari item, boleh diedit); `''` = konfigurasi lama tanpa nama. */
  name: string;
  /** Bagian label yang menampung nama (terkunci ke nama); `''` = tidak ada. */
  namePlacement: QrNamePlacement | '';
  /** Preset asal (pembanding banner penyimpangan); `''` = tanpa preset. */
  presetId: string;
  /** Item yang tergabung dan terlihat bagi pembaca (BU), urut merk lalu tipe. */
  items: QrDesignItemDto[];
  /** Jumlah item tergabung yang tidak terlihat bagi pembaca (di luar BU-nya). */
  hiddenItemCount: number;
  /** Nomor versi stiker terbaru (0 = belum pernah melahirkan stiker). */
  stickerVersion: number;
  /** Status stiker versi terbaru; `''` bila belum ada stiker. */
  stickerStatus: StickerStatus | '';
  title: string;
  linkSource: QrLinkSource;
  /** Link efektif: URL yang diketik, atau URL berbagi PDF sumber. */
  link: string;
  documentId: string;
  documentName: string;
  subtitle: string;
  footer: string;
  logoFileId: string;
  layout: QrLayout;
  /** Gaya teks per bagian dan bingkai QR. */
  style: QrStyle;
  /** Isi tidak muat di kanvas 3 × 3 cm (dilaporkan peramban saat simpan): ekspor diblokir. */
  overflow: boolean;
  exportStatus: QrExportStatus;
  exportedAt: string;
  exportedBy: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** Ada hanya pada konfigurasi terhapus (soft delete); jejak penghapusan. */
  deleted?: SoftDeleteInfo;
  /** True bila preset asal (`presetId`) kini terhapus: tampil bertanda "Terhapus", tak memengaruhi perhitungan apa pun. */
  presetDeleted?: boolean;
}
/** Daftar konfigurasi QR: bawaan konfigurasi hidup; `deleted` = hanya yang terhapus, hanya bagi `qrcode: manage`. */
export interface ListQrDesignsInput {
  status?: 'live' | 'deleted';
}
export interface SaveQrDesignInput {
  id?: string;
  expectedUpdatedAt?: string;
  /** Nama Manual Book; wajib untuk konfigurasi baru. */
  name: string;
  /** Preset asal (`''` = tanpa preset); saat dibuat, penempatan nama disalin dari preset ini. */
  presetId: string;
  /**
   * Daftar item yang tergabung DI ANTARA item yang terlihat bagi penyimpan (daftar lengkapnya, bukan selisih); item
   * yang tak terlihat tetap terpasang dan tidak dikirim. Konfigurasi baru wajib minimal satu.
   */
  itemIds: string[];
  title: string;
  linkSource: QrLinkSource;
  link: string;
  documentId: string;
  subtitle: string;
  footer: string;
  logoFileId: string;
  layout: QrLayout;
  /** Kosong = pertahankan gaya yang ada (ubah) atau bawaan (buat). */
  style?: QrStyle;
  /** Hasil pengukuran tata letak di peramban; kosong = pertahankan nilai yang ada (bawaan false). */
  overflow?: boolean;
}
/** Satu konfigurasi default QR: nilai awal (semua isian kecuali sumber link) yang dipilih user saat membuat QR baru. */
export interface QrPresetDto {
  id: string;
  name: string;
  title: string;
  subtitle: string;
  footer: string;
  layout: QrLayout;
  style: QrStyle;
  /** Logo yang terpilih awal; kosong = tanpa logo. Harus bagian dari pustaka logo. */
  defaultLogoId: string;
  /** BU pemilik preset (satu preset per BU); `''` = preset lama tanpa BU (tidak ditarik otomatis). */
  buId: string;
  /** Bagian label yang menampung nama Manual Book (terkunci); `''` = preset lama tanpa penempatan. */
  namePlacement: QrNamePlacement | '';
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** Ada hanya pada preset terhapus (soft delete); jejak penghapusan. */
  deleted?: SoftDeleteInfo;
}
/**
 * Masukan `qrcodes.getDefaults`: bawaan = preset hidup. `deleted` = hanya preset terhapus (pustaka logo tetap
 * dikembalikan), hanya bagi `qrcode: manage`; selain itu `FORBIDDEN`.
 */
export interface GetQrDefaultsInput {
  status?: 'live' | 'deleted';
}
/** Seluruh konfigurasi default dan pustaka logo bersama (dipilih user saat membuat/mengubah QR). */
export interface QrDefaultsDto {
  presets: QrPresetDto[];
  logoFileIds: string[];
  /** Versi pustaka logo; kosong bila belum pernah disimpan. */
  logoUpdatedAt: string;
}
export interface SaveQrPresetInput {
  id?: string;
  /** Wajib saat mengubah. */
  expectedUpdatedAt?: string;
  name: string;
  title: string;
  subtitle: string;
  footer: string;
  layout: QrLayout;
  style: QrStyle;
  defaultLogoId: string;
  /** BU pemilik (wajib, harus aktif; satu preset per BU). */
  buId: string;
  /** Bagian label yang menampung nama Manual Book. */
  namePlacement: QrNamePlacement;
}
/** Kloning preset ke BU lain: seluruh isi disalin kecuali BU dan nama. */
export interface ClonePresetInput {
  /** Preset sumber. */
  id: string;
  buId: string;
  name: string;
}
export interface SaveQrLogoLibraryInput {
  /** Wajib bila pustaka sudah pernah disimpan. */
  expectedUpdatedAt?: string;
  logoFileIds: string[];
}
export interface QrLogoLibraryDto {
  logoFileIds: string[];
  logoUpdatedAt: string;
}
/** Satu versi Manual Book sebuah konfigurasi QR (`qrcodes.versions`, terbaru dahulu). */
export interface QrVersionDto {
  stickerId: string;
  version: number;
  /** Nama stiker, `<nama Manual Book> v<n>`. */
  name: string;
  status: StickerStatus;
  /** Alasan ekspor ulang yang melahirkan versi ini ('' untuk versi pertama). */
  reason: string;
  createdAt: string;
  createdBy: string;
  /** Gambar contoh stiker (id berkas); null bila tak ada. */
  fileId: string | null;
}

export interface QrDesignRefInput {
  id: string;
}
/** Opsi item untuk pemilih di form QR: hanya item aktif yang terlihat bagi pengguna (BU). */
export interface QrItemOptionDto {
  id: string;
  brand: string;
  model: string;
  /** BU item (menentukan preset yang ditawarkan). */
  businessUnitIds: string[];
  /** Nama Manual Book tempat item sudah tergabung; `''` = belum tergabung. */
  manualBookName: string;
}
export interface ListQrItemOptionsInput {
  query?: string;
  cursor?: string;
  limit?: number;
}
export interface QrItemOptionsPageDto {
  items: QrItemOptionDto[];
  nextCursor: string | null;
}
export interface QrDocumentDto {
  id: string;
  name: string;
  link: string;
}
export interface UploadQrPdfInput {
  name: string;
  /** PDF mentah (badan permintaan). */
  bytes: Uint8Array;
  replaceDocumentId?: string;
}
/** Salin berkas Drive (link atau fileId) ke folder aplikasi sebagai PDF sumber. */
export interface CloneQrPdfInput {
  source: string;
  /** Ganti isi PDF sumber yang ada dengan berkas Drive ini (URL tetap) alih-alih membuat dokumen baru. */
  replaceDocumentId?: string;
}
/** Ekspor QR: PDF dan PNG hasil render klien sebagai bagian multipart `pdf` dan `png`. */
export interface ExportQrDesignInput {
  id: string;
  expectedUpdatedAt: string;
  pdf: Uint8Array;
  png: Uint8Array;
  /**
   * PNG kecil gambar contoh stiker (bagian multipart `preview`); wajib bila ekspor menghasilkan versi Manual Book
   * baru, diabaikan bila tidak (kosong = tidak ada).
   */
  preview: Uint8Array;
  /** Alasan perubahan label (query `reason`, maks. 500); wajib saat ekspor ulang yang menghasilkan versi baru. */
  reason: string;
}
export type QrFileKind = 'pdf' | 'png';
export interface QrFileInput {
  id: string;
  kind: QrFileKind;
}
export interface QrFileDto {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  /** Versi isi (ETag): berubah tiap ekspor ulang. */
  etag: string;
}

// --- Postel (stiker 4b) ---
/** Satu nomor sertifikat sebuah catatan Postel; `role` dan `condition` dihitung (tidak disimpan). */
export interface PostelNumberDto {
  id: string;
  number: string;
  /** Tanggal kalender 'YYYY-MM-DD' (WIB); berlaku sampai akhir hari itu. */
  expiresOn: string;
  /** URL http(s) sertifikat; `''` = tanpa tautan. */
  link: string;
  /** `active` = nomor terbaru (seq terbesar), selain itu `old`. */
  role: PostelRole;
  condition: PostelCondition;
  /** Sisa hari sampai `expiresOn` menurut `today` (negatif = sudah lewat). */
  daysLeft: number;
}
/** Item yang tergabung ke satu catatan Postel; hanya item yang terlihat bagi pembaca (BU). */
export interface PostelItemDto {
  id: string;
  brand: string;
  model: string;
  /** True bila item ini terhapus (soft delete): tampil bertanda "Terhapus", tak dihitung di `itemCount`. */
  deleted?: boolean;
}
/** Lampiran catatan Postel (gambar atau PDF). */
export interface PostelAttachmentDto {
  id: string;
  mime: string;
  size: number;
  /** Nama unduhan turunan (`lampiran-<8 karakter id>.<ekstensi>`). */
  filename: string;
}
/** Ringkasan satu catatan di daftar; kondisi dan sisa hari milik nomor Aktif. */
export interface PostelSummaryDto {
  id: string;
  /** Nama turunan dari tipe item-itemnya (tidak disimpan). */
  name: string;
  /** Jumlah SEMUA item catatan (termasuk yang tidak terlihat bagi pembaca). */
  itemCount: number;
  activeNumber: string;
  activeExpiresOn: string;
  condition: PostelCondition;
  daysLeft: number;
  oldNumberCount: number;
  /** SEMUA nomor catatan (Aktif dan Lama), urut `seq` menaik; bahan pencarian di klien. */
  numbers: string[];
  /** Model item yang berbeda (tanpa merk) dari SEMUA item catatan, termasuk yang tak terlihat; bahan pencarian. */
  models: string[];
  updatedAt: string;
  /** Ada hanya pada catatan terhapus (soft delete); jejak penghapusan. */
  deleted?: SoftDeleteInfo;
}
export interface PostelDto {
  id: string;
  name: string;
  note: string;
  /** Urut `seq` menaik (nomor Aktif terakhir). */
  numbers: PostelNumberDto[];
  /** Item yang terlihat bagi pembaca (BU), urut merk lalu tipe. */
  items: PostelItemDto[];
  /** Jumlah SEMUA item catatan. */
  itemCount: number;
  /** Jumlah item tergabung yang tidak terlihat bagi pembaca (di luar BU-nya). */
  hiddenItemCount: number;
  attachments: PostelAttachmentDto[];
  /** Tanggal WIB server (`YYYY-MM-DD`): dasar `daysLeft` dan `condition`. */
  today: string;
  /** Ambang "segera habis" (ambang peringatan terbesar). */
  soonDays: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** Ada hanya pada catatan terhapus (soft delete); jejak penghapusan. */
  deleted?: SoftDeleteInfo;
}
/** Daftar Postel: bawaan catatan hidup; `deleted` = hanya yang terhapus, hanya bagi `sticker: edit`. */
export interface ListPostelsInput {
  status?: 'live' | 'deleted';
}
export interface PostelListDto {
  postels: PostelSummaryDto[];
  today: string;
  soonDays: number;
}
export interface SavePostelNumberInput {
  /** Id nomor tersimpan milik catatan ini; tanpa id = nomor baru (menjadi Aktif). */
  id?: string;
  number: string;
  expiresOn: string;
  link: string;
}
/** PUT utuh: nomor, item (yang terlihat), dan lampiran diganti sesuai larik. */
export interface SavePostelInput {
  id?: string;
  /** Wajib saat mengubah (If-Match); versi usang = konflik. */
  expectedUpdatedAt?: string;
  note: string;
  itemIds: string[];
  numbers: SavePostelNumberInput[];
  attachmentIds: string[];
}
export interface GetPostelInput {
  id: string;
}
export interface RemovePostelInput {
  id: string;
}
export interface PostelItemOptionDto {
  id: string;
  brand: string;
  model: string;
  /** Nomor Aktif catatan Postel pemilik item; `''` = item belum tertaut ke Postel. */
  postelNumber: string;
}
export interface ListPostelItemOptionsInput {
  query?: string;
  cursor?: string;
  limit?: number;
}
export interface PostelItemOptionsPageDto {
  items: PostelItemOptionDto[];
  nextCursor: string | null;
}

/** Unggah lampiran Postel: byte mentah sebagai badan, MIME sebagai Content-Type (gambar atau PDF). */
export interface UploadPostelFileInput {
  mime: string;
  bytes: Uint8Array;
}
export interface GetPostelFileInput {
  id: string;
}
export interface PostelFileContentDto {
  id: string;
  mime: string;
  bytes: Uint8Array;
  /** Nama unduhan (`lampiran-<8 karakter id>.<ekstensi>`). */
  filename: string;
}

export interface ApiContract {
  'auth.me': { input: null; output: MeDto };
  'access.users.list': { input: null; output: UserDto[] };
  'access.users.save': { input: SaveUserInput; output: UserDto };
  'access.users.setStatus': { input: SetUserStatusInput; output: UserDto };
  'access.roles.list': { input: null; output: RoleDto[] };
  'access.roles.save': { input: SaveRoleInput; output: RoleDto };
  'access.roles.delete': { input: DeleteRoleInput; output: { id: string } };
  'access.audit.list': { input: ListAuditPageInput; output: AuditCursorPageDto };
  'access.locations.list': { input: null; output: LocationDto[] };
  'access.locations.save': { input: SaveLocationInput; output: LocationDto };
  'access.locations.setStatus': { input: SetLocationStatusInput; output: LocationDto };
  'access.businessUnits.list': { input: null; output: BusinessUnitDto[] };
  'access.businessUnits.save': { input: SaveBusinessUnitInput; output: BusinessUnitDto };
  'access.businessUnits.setStatus': { input: SetBusinessUnitStatusInput; output: BusinessUnitDto };
  /** Daftar BU ringkas untuk pemilih; izin `item: view` (user tanpa `access: view`). */
  'businessUnits.options': { input: null; output: BusinessUnitOptionDto[] };
  'files.upload': { input: UploadFileInput; output: FileDto };
  'files.get': { input: GetFileInput; output: FileContentDto };
  'stickerGuides.list': { input: ListStickerGuidesInput; output: StickerGuidePageDto };
  'stickerGuides.upload': { input: UploadStickerGuideInput; output: StickerGuideDto };
  'stickerGuides.rename': { input: RenameStickerGuideInput; output: StickerGuideDto };
  'stickerGuides.remove': { input: RemoveStickerGuideInput; output: { id: string } };
  'stickerGuides.thumbnail': { input: GetStickerGuideThumbInput; output: FileContentDto };
  'stickerGuides.usages': { input: ListGuideUsagesInput; output: GuideUsageDto[] };
  'brands.list': { input: ListBrandsInput | null; output: BrandDto[] };
  /** Merk terhapus hanya bagi `item: manage`; selain itu `NOT_FOUND`. */
  'brands.get': { input: GetBrandInput; output: BrandDto };
  'brands.save': { input: SaveBrandInput; output: BrandDto };
  'brands.setStatus': { input: SetBrandStatusInput; output: BrandDto };
  /** Batch atomik (maks. `BATCH_MAX` id): satu gagal = tidak ada yang berubah; status sama = bukan galat. */
  'brands.setStatusBatch': { input: StatusBatchInput; output: BatchResult<BrandDto> };
  /** Hapus lunak: hanya merk Nonaktif; hapus ulang = sukses tanpa audit. */
  'brands.remove': { input: GetBrandInput; output: RemoveResult };
  'brands.removeBatch': { input: IdBatchInput; output: RemoveBatchResult };
  /** Pulihkan: kembali Nonaktif. */
  'brands.restore': { input: GetBrandInput; output: BrandDto };
  'brands.restoreBatch': { input: IdBatchInput; output: BatchResult<BrandDto> };
  'stickerTypes.list': { input: null; output: StickerTypeDto[] };
  'stickerTypes.save': { input: SaveStickerTypeInput; output: StickerTypeDto };
  'stickerTypes.setStatus': { input: SetStickerTypeStatusInput; output: StickerTypeDto };
  'stickerSettings.get': { input: null; output: StickerSettingsDto };
  'stickerSettings.save': { input: SaveStickerSettingsInput; output: StickerSettingsDto };
  'stickers.list': { input: null; output: StickerDto[] };
  'stickers.save': { input: SaveStickerInput; output: StickerDto };
  'stickers.setStatus': { input: SetStickerStatusInput; output: StickerDto };
  'stickerStock.list': { input: ListStickerStockInput; output: StickerStockDto[] };
  'stickerStock.record': { input: RecordStockInput; output: StockEntryDto };
  'stickerStock.adjust': { input: AdjustStockInput; output: StockEntryDto };
  'stickerStock.opname': { input: OpnameInput; output: StockEntryDto[] };
  'stickerStock.history': { input: StockHistoryInput; output: StockHistoryPageDto };
  'customers.list': { input: null; output: CustomerDto[] };
  'customers.rename': { input: RenameCustomerInput; output: CustomerDto };
  'customers.setStatus': { input: SetCustomerStatusInput; output: CustomerDto };
  'handovers.options': { input: ListHandoversInput; output: HandoverOptionsDto };
  'handovers.board': { input: BoardPageInput; output: BoardPageDto };
  'handovers.get': { input: GetHandoverInput; output: HandoverDto };
  'handovers.save': { input: SaveHandoverInput; output: HandoverDto };
  /** Maks. 30 task per permintaan (`HANDOVER_BATCH_MAX`), atomik: gagal = tidak ada yang tersimpan. */
  'handovers.saveBatch': { input: SaveHandoverBatchInput; output: HandoverDto[] };
  'handovers.cancel': { input: HandoverRefInput; output: HandoverDto };
  'handovers.reopen': { input: HandoverRefInput; output: HandoverDto };
  'handovers.setCheck': { input: SetCheckInput; output: HandoverDto };
  'handovers.setDone': { input: SetDoneInput; output: HandoverDto };
  'handovers.comment': { input: AddCommentInput; output: HandoverDto };
  'items.list': { input: ListItemsPageInput; output: ItemPageDto };
  'items.get': { input: GetItemInput; output: ItemDto };
  'items.save': { input: SaveItemInput; output: ItemDto };
  'items.setStatus': { input: SetItemStatusInput; output: ItemDto };
  /** Batch atomik (maks. `BATCH_MAX` id): `manage` pada SEMUA BU tiap item; di luar hak = seluruh permintaan `NOT_FOUND`. */
  'items.setStatusBatch': { input: StatusBatchInput; output: BatchResult<ItemDto> };
  /** Hapus lunak: hanya item Nonaktif; hapus ulang = sukses tanpa audit. */
  'items.remove': { input: GetItemInput; output: RemoveResult };
  'items.removeBatch': { input: IdBatchInput; output: RemoveBatchResult };
  /** Pulihkan: kembali Nonaktif; ditolak generik bila merk+tipe/nama lainnya kini dipakai item hidup. */
  'items.restore': { input: GetItemInput; output: ItemDto };
  'items.restoreBatch': { input: IdBatchInput; output: BatchResult<ItemDto> };
  /** Konfigurasi terhapus hanya bagi `qrcode: manage` (`status=deleted`; selain itu `FORBIDDEN`). */
  'qrcodes.list': { input: ListQrDesignsInput | null; output: QrDesignDto[] };
  'qrcodes.get': { input: QrDesignRefInput; output: QrDesignDto };
  'qrcodes.versions': { input: QrDesignRefInput; output: QrVersionDto[] };
  'qrcodes.save': { input: SaveQrDesignInput; output: QrDesignDto };
  /** Hapus lunak (id dan bentuk lama tetap; perilaku beralih dari hapus keras). */
  'qrcodes.delete': { input: QrDesignRefInput; output: QrDesignRefInput };
  'qrcodes.removeBatch': { input: IdBatchInput; output: RemoveBatchResult };
  'qrcodes.restore': { input: QrDesignRefInput; output: QrDesignDto };
  'qrcodes.restoreBatch': { input: IdBatchInput; output: BatchResult<QrDesignDto> };
  'qrcodes.getDefaults': { input: GetQrDefaultsInput | null; output: QrDefaultsDto };
  /** Preset terhapus hanya bagi `qrcode: manage`; selain itu `NOT_FOUND`. */
  'qrcodes.getPreset': { input: QrDesignRefInput; output: QrPresetDto };
  'qrcodes.itemOptions': { input: ListQrItemOptionsInput; output: QrItemOptionsPageDto };
  'qrcodes.savePreset': { input: SaveQrPresetInput; output: QrPresetDto };
  'qrcodes.clonePreset': { input: ClonePresetInput; output: QrPresetDto };
  'qrcodes.deletePreset': { input: QrDesignRefInput; output: QrDesignRefInput };
  'qrcodes.removePresetBatch': { input: IdBatchInput; output: RemoveBatchResult };
  'qrcodes.restorePreset': { input: QrDesignRefInput; output: QrPresetDto };
  'qrcodes.restorePresetBatch': { input: IdBatchInput; output: BatchResult<QrPresetDto> };
  'qrcodes.saveLogoLibrary': { input: SaveQrLogoLibraryInput; output: QrLogoLibraryDto };
  'qrcodes.uploadPdf': { input: UploadQrPdfInput; output: QrDocumentDto };
  'qrcodes.cloneFromDrive': { input: CloneQrPdfInput; output: QrDocumentDto };
  'qrcodes.export': { input: ExportQrDesignInput; output: ExportQrJobDto };
  'qrcodes.file': { input: QrFileInput; output: QrFileDto };
  /** Catatan terhapus hanya bagi `sticker: edit` (`status=deleted`; selain itu `FORBIDDEN`). */
  'postels.list': { input: ListPostelsInput | null; output: PostelListDto };
  'postels.get': { input: GetPostelInput; output: PostelDto };
  'postels.save': { input: SavePostelInput; output: PostelDto };
  /** Hapus lunak (id dan bentuk lama tetap; perilaku beralih dari hapus keras). */
  'postels.remove': { input: RemovePostelInput; output: null };
  'postels.removeBatch': { input: IdBatchInput; output: RemoveBatchResult };
  'postels.restore': { input: GetPostelInput; output: PostelDto };
  'postels.restoreBatch': { input: IdBatchInput; output: BatchResult<PostelDto> };
  'postels.history': { input: ListPostelHistoryInput; output: AuditCursorPageDto };
  'postelSettings.get': { input: null; output: PostelSettingsDto };
  'postelSettings.save': { input: SavePostelSettingsInput; output: PostelSettingsDto };
  'postels.itemOptions': { input: ListPostelItemOptionsInput; output: PostelItemOptionsPageDto };
  'serials.itemOptions': { input: ListSerialItemOptionsInput; output: SerialItemOptionsPageDto };
  'serials.stickerOptions': { input: SerialStickerOptionsInput; output: SerialStickerOptionsDto };
  'serials.locationOptions': { input: null; output: SerialLocationOptionsDto };
  'serials.buOptions': { input: null; output: SerialBuOptionsDto };
  'serials.serviceLocations': { input: null; output: SerialLocationOptionsDto };
  'serials.lookup': { input: SerialLookupInput; output: SerialLookupOutput };
  'serials.lookupMany': { input: SerialLookupManyInput; output: SerialLookupManyOutput };
  'serials.reportNew': { input: SerialReportNewInput; output: SerialDto };
  'serials.saveBatch': { input: SaveSerialBatchInput; output: SaveSerialBatchOutput };
  'serials.get': { input: GetSerialInput; output: GetSerialOutput };
  'serials.list': { input: SerialListInput; output: SerialListOutput };
  'serials.update': { input: UpdateSerialInput; output: SerialDto };
  'serials.updateBatch': { input: UpdateSerialBatchInput; output: UpdateSerialBatchOutput };
  'serials.act': { input: SerialActInput; output: SerialDto };
  'serials.history': { input: SerialHistoryInput; output: SerialHistoryOutput };
  'serialSettings.get': { input: null; output: SerialSettingsDto };
  'serialSettings.save': { input: SaveSerialSettingsInput; output: SerialSettingsDto };
  'serialServiceSettings.get': { input: null; output: SerialServiceSettingsDto };
  'serialServiceSettings.save': {
    input: SaveSerialServiceSettingsInput;
    output: SerialServiceSettingsDto;
  };
  'serialCases.list': { input: SerialCaseListInput; output: SerialCaseListOutput };
  'serialProofs.upload': { input: UploadSerialProofInput; output: SerialProofPhotoDto };
  'serialProofs.get': { input: GetSerialProofInput; output: SerialProofContentDto };
  'serialProofs.remove': { input: RemoveSerialProofInput; output: { id: string } };
  'serialProofs.retry': { input: RetrySerialProofInput; output: SerialProofPhotoDto };
  'serialProofs.replace': { input: ReplaceSerialProofInput; output: SerialProofPhotoDto };
  'postelFiles.upload': { input: UploadPostelFileInput; output: PostelAttachmentDto };
  'postelFiles.get': { input: GetPostelFileInput; output: PostelFileContentDto };
  'notifications.list': { input: ListNotificationsInput; output: NotificationListDto };
  'notifications.markRead': { input: MarkNotificationReadInput; output: { ok: true } };
  'notifications.markAllRead': { input: Record<string, never>; output: { count: number } };
  'push.config': { input: null; output: PushConfigDto };
  'push.subscribe': { input: PushSubscribeInput; output: { ok: true } };
  'push.unsubscribe': { input: PushUnsubscribeInput; output: { ok: true } };
  'push.setPreference': { input: PushPreferenceInput; output: { enabled: boolean } };
  'push.deviceState': { input: PushUnsubscribeInput; output: PushDeviceStateDto };
  'push.setDeviceMuted': { input: PushDeviceMutedInput; output: PushDeviceStateDto };
  'push.reportPermission': { input: PushPermissionInput; output: { ok: true } };
  'push.status': { input: null; output: PushUserStatusDto[] };
  'desktop.handoff': { input: Record<string, never>; output: DesktopHandoffDto };
  'guides.list': { input: null; output: GuideProgressDto[] };
  'guides.mark': { input: MarkGuideInput; output: GuideProgressDto[] };
  'guides.reset': { input: ResetGuideInput; output: GuideProgressDto[] };
  'jobs.get': { input: GetJobInput; output: JobDto };
  'exports.sheets': { input: ExportSheetsInput; output: ExportSheetsJobDto };
}

export type ApiId = keyof ApiContract;
export type ApiInput<M extends ApiId> = ApiContract[M]['input'];
export type ApiOutput<M extends ApiId> = ApiContract[M]['output'];

export type AuthErrorCode = 'NOT_WHITELISTED' | 'LOGIN_FAILED';

/** Halaman berkursor; `nextCursor` null = halaman terakhir. */
export interface BoardPageInput {
  locationIds: string[];
  /** Kolom kanban yang dimuat (status turunan, termasuk `cancelled`). */
  status: HandoverStatus;
  cursor?: string;
  /** Bawaan 20, maksimum 50; klien memuat lanjutan lewat kursor. */
  limit?: number;
}

export interface BoardPageDto {
  items: HandoverDto[];
  nextCursor: string | null;
  /** Jumlah task pada kolom itu (judul kolom). */
  total: number;
}

export interface ListItemsPageInput {
  cursor?: string;
  /** Bawaan 20, maksimum 50. */
  limit?: number;
  /** Pencarian kunci (awalan/substring), opsional. */
  query?: string;
  /**
   * Bawaan = item hidup (aktif + nonaktif; `all` sama). `deleted` = hanya item terhapus, hanya bagi pemegang
   * `item: manage` pada minimal satu BU (selain itu `FORBIDDEN`) dan terbatas pada BU ber-`manage` itu.
   */
  status?: ListStatusFilter;
  /** `none` = hanya item tanpa instruksi stiker. */
  instruction?: 'none';
  /** Filter item menurut penanda ke stiker tertentu (bersama `stickerMode`). */
  stickerId?: string;
  /** Filter item menurut jenis stiker (bersama `stickerMode`). */
  typeId?: string;
  stickerMode?: 'has' | 'missing';
  /** `has` = hanya item ber-Manual Book; `missing` = hanya yang belum (definisi sama dengan `hasManualBook`). */
  manualBook?: 'has' | 'missing';
  /** `has` = hanya item ber-Postel; `missing` = hanya yang belum (definisi sama dengan `hasPostel`). */
  postel?: 'has' | 'missing';
  /** Hanya item bermerk ini (satu id). Merk terhapus tetap sah sebagai filter (tautan jumlah item dari View merk). */
  brandId?: string;
  /** Hanya item yang tergabung di BU ini (satu id); tetap dibatasi BU yang boleh dilihat pemanggil. */
  buId?: string;
}

export interface ItemPageDto {
  items: ItemSummaryDto[];
  nextCursor: string | null;
}

/** Pengaturan email peringatan masa berlaku Postel (terpisah dari pengaturan stok stiker). */
export interface PostelAlertSettings {
  enabled: boolean;
  /** Maks. 20 alamat email sah dan unik. */
  recipients: string[];
  /** Jam (0-23, WIB) paling awal ringkasan dikirim pada hari itu. */
  sendHour: number;
  /** Hari sebelum habis; 1-5 nilai bulat 1-730, unik, disimpan menurun. */
  thresholds: number[];
  /** 0 = tidak mengulang; selain itu pengingat ulang tiap N hari di ambang terkecil (maks. 365). */
  repeatEveryDays: number;
}

export interface PostelSettingsDto {
  alert: PostelAlertSettings;
  /** Versi pengaturan ('' bila belum pernah disimpan). */
  updatedAt: string;
  /** Server punya SMTP terkonfigurasi (tanpa itu ringkasan tak terkirim). */
  smtpConfigured: boolean;
}

export interface SavePostelSettingsInput {
  /** `updatedAt` yang dilihat penyimpan ('' bila belum pernah disimpan); usang = galat usang (412 lewat If-Match). */
  expectedUpdatedAt: string;
  alert: PostelAlertSettings;
}

/** Riwayat perubahan satu catatan Postel (log audit per target); halaman terbaru dahulu. */
export interface ListPostelHistoryInput {
  id: string;
  cursor?: string;
  /** Bawaan 20, maksimum 50. */
  limit?: number;
}

export interface ListAuditPageInput {
  cursor?: string;
  /** Bawaan 20, maksimum 50. */
  limit?: number;
  /** Aksi persis, mis. `user.update`; kosong = semua. */
  action?: string;
  /** Kata kunci pada target atau pelaku. */
  query?: string;
}

export interface AuditCursorPageDto {
  entries: AuditEntryDto[];
  nextCursor: string | null;
}

// --- Serial Number (tahap 5a) ---

/** Pilihan stiker pada satu serial: jumlah per stiker (1..`SERIAL_LIMITS.stickerQtyMax`). */
export interface SerialStickerPick {
  stickerId: string;
  qty: number;
}
export type SerialStickerStatus = 'active' | 'inactive' | 'deprecated';
export interface SerialStickerDto {
  stickerId: string;
  name: string;
  alias: string;
  qty: number;
  /** Status stiker saat ini; jumlah stiker `inactive` tidak dapat dinaikkan pada cek ulang (`deprecated` boleh). */
  stickerStatus: SerialStickerStatus;
}
/** Satu perubahan field pada kejadian `data_changed`; `null` = kosong. */
export interface SerialChangeDto {
  field: string;
  from: string | null;
  to: string | null;
}
export interface SerialEventDto {
  id: string;
  /** Kasus tidak lolos yang dimiliki kejadian ini; `null` = di luar kasus. */
  caseId: string | null;
  seq: number;
  type: SerialEventType;
  occurredOn: string;
  createdAt: string;
  actorName: string;
  actorTeam: 'qc' | 'service' | 'system';
  /** Markdown, boleh kosong. */
  message: string;
  changes: SerialChangeDto[];
  data: Record<string, unknown>;
  /** Bukti foto QC kejadian ini (hanya `recorded`/`recheck*`; kosong pada jenis lain). */
  proofPhotos: SerialProofPhotoDto[];
}
/** Satu foto bukti QC (tanpa nama berkas sementara dan data cap). */
export interface SerialProofPhotoDto {
  id: string;
  state: SerialProofState;
  mime: string;
  size: number;
  width: number;
  height: number;
  /** Nama unduhan yang disarankan. */
  filename: string;
  /** Alasan singkat bila `failed`; selain itu `null`. */
  error: string | null;
  /**
   * Pemanggil boleh Coba lagi/Buang foto ini: memegang `serial: edit` SAAT INI (izin rute) DAN (pelaku yang menyimpannya,
   * atau `serial: manage` pada BU serialnya).
   */
  canManage: boolean;
  /**
   * Boleh Coba lagi: `canManage` (termasuk `serial: edit` saat ini) DAN `failed` DAN bukan gagal karena ukuran gambar (kegagalan ukuran deterministik:
   * hanya Buang). Rute `serialProofs.retry` menolak (`CONFLICT`) bila `false`.
   */
  canRetry: boolean;
  /** Waktu foto menjadi `failed` (ISO UTC; = `updated_at` saat gagal); `null` bila belum `failed`. */
  failedAt: string | null;
  /** Batas buang otomatis foto `failed` (`failedAt` + `SERIAL_PROOF_LIMITS.failedRetentionDays` hari, ISO UTC); `null` bila belum `failed`. */
  expiresAt: string | null;
}
/** Unggah foto bukti (multipart; gambar sudah dikecilkan di browser). */
export interface UploadSerialProofInput {
  mime: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}
export interface GetSerialProofInput {
  id: string;
}
export interface SerialProofContentDto {
  id: string;
  mime: string;
  bytes: Uint8Array;
  filename: string;
}
export interface RemoveSerialProofInput {
  id: string;
}
export interface RetrySerialProofInput {
  id: string;
}
/** Unggah ulang (ganti foto bermasalah): `photoId` = foto `failed`, `newPhotoId` = unggahan `draft` pengganti. */
export interface ReplaceSerialProofInput {
  photoId: string;
  newPhotoId: string;
}
export interface SerialSummaryDto {
  id: string;
  buId: string;
  buCode: string;
  serial: string;
  itemId: string;
  itemLabel: string;
  testDate: string;
  sample: boolean;
  locationId: string;
  locationName: string;
  status: SerialStatus;
  custody: SerialCustody;
  /** Tujuan pengiriman yang sedang berjalan (custody `transit`), selain itu `null`. */
  transitToLocationId: string | null;
  transitToLocationName: string | null;
  /** Tanggal kirim (`YYYY-MM-DD`) pengiriman yang berjalan. */
  transitOn: string | null;
  /** Nomor kasus yang sedang terbuka (`LP/<BU>/YYMM-iiii`; nomor lama `LP-YYYYMMDD-NNN` tetap sah), bila ada. */
  openCaseNumber: string | null;
  /** Entri serial ini (Tambah/Cek ulang) punya bukti foto QC. */
  hasProofPhotos: boolean;
  /** Jumlah foto bukti QC entri serial ini yang `failed` (0 = tak ada; bahan badge "Foto bermasalah"). */
  proofProblemCount: number;
  createdAt: string;
}
/** Laporan rusak (`serial_cases`): satu episode kegagalan. */
export interface SerialCaseDto {
  id: string;
  /** `LP/<kode BU>/YYMM-iiii` (nomor lama `LP-YYYYMMDD-NNN` tetap sah). */
  number: string;
  openedOn: string;
  closedOn: string | null;
  outcome: 'good' | 'broken' | null;
}
export interface SerialDto extends SerialSummaryDto {
  /** Riwayat BU serial (urut `firstAt`); BU saat ini = baris dengan `leftAt` kosong. */
  buHistory: SerialBuHistoryDto[];
  note: string;
  recordedLocationId: string;
  stickers: SerialStickerDto[];
  openCaseId: string | null;
  /** Asal pengiriman yang sedang berjalan. */
  transitFromLocationId: string | null;
  transitFromLocationName: string | null;
  openCase: SerialCaseDto | null;
  /** Semua kasus serial ini, terbaru dulu. */
  cases: SerialCaseDto[];
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
/** Satu baris pada `serials.saveBatch`; `clientId` = kunci idempoten per baris. */
export interface SerialRowInput {
  clientId: string;
  serial: string;
  itemId: string;
  buId: string;
  testDate: string;
  locationId: string;
  sample: boolean;
  note: string;
  /** Asal catatan; disimpan di `data` kejadian `recorded`. Bawaan `manual`. */
  source?: 'manual' | 'countrylock';
  /**
   * Stiker yang ditempel. TIDAK dikirim (undefined) = SEMUA stiker yang berlaku bagi (item, BU) dengan `defaultQty`
   * (sama dengan bawaan web dan `.qcsn`); `[]` eksplisit = tanpa stiker. Maks. 20 pilihan eksplisit.
   */
  stickers?: SerialStickerPick[];
  /** Id foto bukti `draft` milik pengunggah (maks. `SERIAL_PROOF_LIMITS.perEntryMax`). */
  proofPhotoIds?: string[];
}
export type SerialRowResult = {
  clientId: string;
  /** `rechecked`: serial sudah ada, entri ini menjadi cek ulang lolos pada catatan itu (`id` = serial yang sama). */
  result: 'created' | 'rechecked' | 'duplicate' | 'invalid' | 'error';
  message: string;
  id?: string;
  serial?: string;
};
export interface SaveSerialBatchInput {
  rows: SerialRowInput[];
}
export interface SaveSerialBatchOutput {
  results: SerialRowResult[];
}
export interface GetSerialInput {
  id: string;
}
export interface GetSerialOutput {
  serial: SerialDto;
  /** Maks. 500 kejadian TERBARU, terbaru di atas (`seq` menurun). */
  events: SerialEventDto[];
  /** Ada kejadian lebih lama yang tidak dimuat (hanya 500 terbaru yang dikembalikan). */
  eventsTruncated: boolean;
  /**
   * Semua foto bukti QC `failed` entri ini (urut unggah; maks. 5 per entri dan dibuang otomatis sesudah 14 hari), terlepas
   * dari terpotongnya `events`: bahan banner "Foto bukti bermasalah" (tombol Unggah ulang dan batas buang). Foto yang sama
   * tetap muncul di `proofPhotos` kejadiannya bila kejadian itu dimuat. Tidak ada di halaman publik.
   */
  problemPhotos: SerialProofPhotoDto[];
}
export interface SerialListInput {
  /** Awalan serial (dinormalisasi). */
  query?: string;
  /** Teks tempelan, satu serial per baris (maks. 200 baris sebelum normalisasi): hanya yang persis cocok. */
  serials?: string;
  buId?: string;
  itemId?: string;
  locationId?: string;
  status?: SerialStatus;
  /** Posisi (custody): `qc`, `transit`, atau `service`. */
  custody?: SerialCustody;
  /** Rentang `test_date` inklusif (`YYYY-MM-DD`). */
  from?: string;
  to?: string;
  createdBy?: string;
  cursor?: string;
  limit?: number;
}
export interface SerialListOutput {
  items: SerialSummaryDto[];
  nextCursor: string | null;
}
/** Bidang catatan serial yang boleh diubah (BU, status, dan stiker tidak). */
export interface SerialEditable {
  serial: string;
  itemId: string;
  testDate: string;
  sample: boolean;
  note: string;
  locationId: string;
}
export interface UpdateSerialInput extends SerialEditable {
  id: string;
  expectedUpdatedAt: string;
}
export interface UpdateSerialBatchRowInput {
  id: string;
  expectedUpdatedAt: string;
  fields: Partial<SerialEditable>;
}
export interface UpdateSerialBatchInput {
  rows: UpdateSerialBatchRowInput[];
}
export interface UpdateSerialBatchRowResult {
  id: string;
  result: 'updated' | 'duplicate' | 'stale' | 'invalid' | 'error';
  message: string;
  updatedAt?: string;
}
export interface UpdateSerialBatchOutput {
  results: UpdateSerialBatchRowResult[];
}
interface SerialActBase {
  id: string;
  expectedUpdatedAt: string;
  /** Tanggal kejadian `YYYY-MM-DD`, tidak di masa depan. */
  occurredOn: string;
  /** Markdown, maks. `SERIAL_LIMITS.messageMax`. */
  message: string;
}
/**
 * Aksi pada serial (rancangan laporan rusak 2026-11-14 §4.1). `serialservice` hanya menindak serial berstatus
 * `at_service`/`diagnosis`/`service_repair`; jenis pengiriman/penerimaan diturunkan server dari status. `message` wajib pada
 * `note`, `report_failure`, `declare_broken`, `recheck_fail`, dan `recheck` hasil gagal; pada aksi lain opsional.
 */
export type SerialActInput =
  | (SerialActBase & { action: 'note' | 'declare_broken' | 'report_failure' })
  | (SerialActBase & {
      action: 'send' | 'receive';
      /**
       * `send`: lokasi tujuan servis (wajib bila konfigurasi servis punya lebih dari satu lokasi aktif, selain itu
       * kosong atau sama dengan satu-satunya lokasi). `receive` (QC): lokasi hanya bila lokasi QC asal sudah nonaktif.
       */
      toLocationId?: string;
      /**
       * Hanya `send`, opsional: ekspedisi, nomor resi, atau nama pengantar (satu baris, maks. `shipmentNoteMax`).
       * Disimpan di riwayat kirim; tidak pernah tampil di halaman publik.
       */
      shipmentNote?: string;
    })
  | (SerialActBase & { action: 'service_diagnosis'; stage: ServiceDiagnosisStage })
  | (SerialActBase & {
      action: 'recheck';
      /** Bawaan `pass`. `fail` membuka laporan (catatan wajib). */
      result?: 'pass' | 'fail';
      /**
       * Hanya hasil `pass`: BU tujuan (kosong = BU saat ini). Harus BU saat ini atau BU yang belum pernah terlibat pada
       * serial (`recheckBuCandidates`) dan BU yang boleh ditulis pengguna. Hasil `fail` menolak field ini.
       */
      buId?: string;
      /** Stiker yang DICENTANG: tiap id menambah 1 pada jumlah tempel dan memotong stok 1 di lokasi cek ulang. */
      stickerIds?: string[];
      /** Id foto bukti `draft` milik pengunggah (maks. `SERIAL_PROOF_LIMITS.perEntryMax`). */
      proofPhotoIds?: string[];
    })
  | (SerialActBase & {
      action: 'recheck_pass' | 'recheck_fail';
      /** Hanya `recheck_pass` (memindahkan BU, kosong = BU saat ini); `recheck_fail` menolaknya. */
      buId?: string;
      stickerIds?: string[];
      proofPhotoIds?: string[];
    });
export type SerialActAction = SerialActInput['action'];
/** Riwayat per serial (tab linimasa): kursor = `seq` terakhir. */
export interface SerialHistoryInput {
  id: string;
  group?: 'all' | 'checks' | 'changes';
  /** Hanya kejadian kasus ini (kasus milik serial lain = hasil kosong). */
  caseId?: string;
  cursor?: string;
  limit?: number;
}
export interface SerialHistoryOutput {
  events: SerialEventDto[];
  nextCursor: string | null;
  counts: { all: number; checks: number; changes: number; byCase: Record<string, number> };
}
export interface SerialAlertSettings {
  enabled: boolean;
  recipients: string[];
}
export interface SerialSettingsDto {
  alert: SerialAlertSettings;
  updatedAt: string;
  /** SMTP sudah diatur di server. */
  smtpConfigured: boolean;
}
export interface SaveSerialSettingsInput {
  expectedUpdatedAt: string;
  alert: SerialAlertSettings;
}
/** Pengaturan lokasi tim servis (global, ETag `updatedAt` sendiri). Kosong = semua lokasi aktif. */
export interface SerialServiceSettingsDto {
  locationIds: string[];
  /** Kosong sebelum pernah disimpan. */
  updatedAt: string;
}
export interface SaveSerialServiceSettingsInput {
  expectedUpdatedAt: string;
  locationIds: string[];
}
/** Pencarian Serial Number untuk Lapor Rusak (BU yang boleh ditulis pengguna). */
export interface SerialLookupInput {
  serial: string;
}
export interface SerialLookupMatchDto {
  id: string;
  buId: string;
  buCode: string;
  itemLabel: string;
  serial: string;
  status: SerialStatus;
  custody: SerialCustody;
  locationName: string;
  /** Laporan aktif serial ini, bila ada (Lapor rusak ditolak; UI menautkan ke laporan itu). */
  openCaseId: string | null;
  openCaseNumber: string | null;
  updatedAt: string;
}
export interface SerialLookupOutput {
  matches: SerialLookupMatchDto[];
  /**
   * Serial ada tetapi BU saat ini di luar hak tulis pengguna: hanya kode BU itu yang diungkap (Lapor Rusak
   * menampilkan peringatan). `null` = tidak ada serial, atau serial ada dan dapat ditulis (ada di `matches`).
   */
  elsewhere: { buCode: string } | null;
}
/** Draft Catat: serial yang sudah ada dicari sekaligus (maks. `SERIAL_LIMITS.batchRows`). */
export interface SerialLookupManyInput {
  serials: string[];
}
/**
 * Serial yang sudah tercatat, DENGAN pengungkapan minimal lintas BU (spek serial unik se-sistem §5.4/§7): item, BU saat
 * ini, status; tanpa catatan, riwayat, nama lokasi, atau pelaku.
 */
export interface SerialExistingDto {
  /** Serial ternormalisasi (kunci pencocokan di draft). */
  serial: string;
  id: string;
  itemId: string;
  itemLabel: string;
  buId: string;
  buCode: string;
  status: SerialStatus;
  hasOpenCase: boolean;
  /** Item serial ini wajib foto bukti QC pada cek ulang, dan jumlah minimumnya. */
  proofRequired: boolean;
  proofMin: number;
  /** BU yang boleh dipilih pengguna pada cek ulang (BU tulisnya dikurangi BU yang pernah ditinggalkan serial ini). */
  recheckBuIds: string[];
}
export interface SerialLookupManyOutput {
  found: SerialExistingDto[];
}
/** Satu BU yang pernah memegang serial (`leftAt` kosong = BU saat ini). */
export interface SerialBuHistoryDto {
  buId: string;
  buCode: string;
  firstAt: string;
  leftAt: string;
}
/** Lapor Rusak untuk Serial Number yang belum tercatat: serial dibuat langsung berstatus Dilaporkan. */
export interface SerialReportNewInput {
  serial: string;
  itemId: string;
  buId: string;
  locationId: string;
  /** Markdown, wajib. */
  message: string;
  /** Tanggal laporan `YYYY-MM-DD` (bukan di masa depan); jadi tanggal uji. */
  occurredOn: string;
}
export interface SerialCaseListInput {
  /** `active` = laporan terbuka, `closed` = sudah selesai. */
  status?: 'active' | 'closed';
  buId?: string;
  /** Awalan nomor LP atau serial. */
  query?: string;
  cursor?: string;
  limit?: number;
}
export interface SerialCaseRowDto {
  id: string;
  /** `LP/<kode BU>/YYMM-iiii` (nomor lama `LP-YYYYMMDD-NNN` tetap sah). */
  number: string;
  serialId: string;
  serial: string;
  buId: string;
  buCode: string;
  itemLabel: string;
  /** Status serial sekarang. */
  status: SerialStatus;
  custody: SerialCustody;
  openedOn: string;
  closedOn: string | null;
  outcome: 'good' | 'broken' | null;
  /** Hari kalender (WIB) sejak status serial terakhir berubah. */
  daysInStatus: number;
  /** Nama lokasi serial sekarang (kosong bila tidak dikenal). */
  locationName: string;
  /** Hari kalender (WIB) dari laporan dibuka sampai ditutup (atau sampai hari ini bila masih aktif). */
  durationDays: number;
  /** Email pelapor (`created_by`). */
  reporter: string;
  /** Baris pertama catatan laporan sebagai teks polos, maks. `SERIAL_LIMITS.reportSummaryMax` karakter. */
  summary: string;
}
export interface SerialCaseListOutput {
  items: SerialCaseRowDto[];
  nextCursor: string | null;
}
/** Item yang dapat dipilih pencatat serial (hanya bidang yang dibutuhkan), dengan BU yang boleh ia tulis. */
export interface SerialItemOptionDto {
  id: string;
  /** "Merk Model". */
  label: string;
  buIds: string[];
  buOptions: { id: string; code: string }[];
  /** Item wajib foto bukti pada Catat Serial (spek 2026-11-18); `proofMin` selalu 1 bila tidak wajib. */
  proofRequired: boolean;
  /** Jumlah foto bukti minimum (1 sampai 5). */
  proofMin: number;
}
export interface ListSerialItemOptionsInput {
  query?: string;
  cursor?: string;
  limit?: number;
  /**
   * Maks. 50 id item. Bila ada (juga kosong), hasilnya tepat item-item itu yang aktif dan beririsan dengan BU dalam
   * cakupan pengguna: pencatat = BU ber-level `serial: edit`; pembaca saja = BU ber-level view atau lebih pada
   * `serial`/`serialservice` (id lain tidak dikembalikan, tanpa galat); `query`, `cursor`, dan `limit` diabaikan.
   */
  itemIds?: string[];
}
export interface SerialItemOptionsPageDto {
  items: SerialItemOptionDto[];
  nextCursor: string | null;
}
/** Lokasi aktif yang boleh dipilih saat mencatat serial (tanpa penugasan lokasi: spek §3 butir 3, §11 butir 8). */
export interface SerialLocationOptionDto {
  id: string;
  code: string;
  name: string;
}
export interface SerialLocationOptionsDto {
  /** Semua lokasi AKTIF, urut kode. */
  locations: SerialLocationOptionDto[];
}
/** Business Unit aktif yang boleh dipilih saat mencatat serial (BU serial tidak lagi dibatasi pada BU item; spek 2026-11-18 butir N). */
export interface SerialBuOptionDto {
  id: string;
  code: string;
  name: string;
}
export interface SerialBuOptionsDto {
  /** BU AKTIF tempat user berlevel `serial: edit` (pembaca saja: BU yang boleh dibacanya), urut kode. */
  businessUnits: SerialBuOptionDto[];
}
export interface SerialStickerOptionsInput {
  itemId: string;
  buId: string;
  /**
   * OPSIONAL: serial yang sudah ada yang akan dicek ulang (draft Catat, dialog Cek ulang). Bila diisi dan serial itu
   * bertipe `itemId`, `buId` termasuk BU yang boleh dipilih pada cek ulang (BU saat ini atau BU yang belum pernah terlibat)
   * dan boleh ditulis pengguna, maka syarat "item aktif dan terlihat" TIDAK diterapkan (jalur cek ulang memakai item
   * catatan sebagai acuan). Selain itu perilaku biasa (`NOT_FOUND`), tanpa membedakan penyebabnya.
   */
  serialId?: string;
}
export interface SerialStickerOptionsDto {
  stickers: ApplicableStickerDto[];
}
/** Stiker yang berlaku bagi item pada sebuah BU (bahan daftar centang). */
export interface ApplicableStickerDto {
  id: string;
  name: string;
  alias: string;
  typeName: string;
  /** Jumlah awal saat tercentang; selalu 1. */
  defaultQty: number;
}

export type JobKind =
  | 'qr_export'
  | 'sheets_export'
  | 'cleanup_qr'
  | 'db_backup'
  | 'serial_alert'
  | 'serial_proof';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface GetJobInput {
  id: string;
}

export interface JobDto {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** 0-100. */
  progress: number;
  result?: string;
  error?: string;
}

/** Ekspor QR kini berupa pekerjaan latar; PDF/PNG dikirim klien lewat unggahan terpisah (Task 3.3). */
export interface ExportQrJobDto {
  jobId: string;
}

/** Ekspor tabel database ke Spreadsheet (job latar); `tables` kosong/tidak ada = semua tabel yang diizinkan. */
/** Lonceng notifikasi Serah Terima (spek 2026-11-12). `limit` bawaan 30, dibatasi maksimum 100. */
export interface ListNotificationsInput {
  limit?: number;
  /** Kursor `createdAt|id` dari `nextCursor` halaman sebelumnya. */
  before?: string;
}
export interface NotificationListDto {
  items: NotificationDto[];
  /** Jumlah belum dibaca di lokasi yang masih berhak dibaca pemanggil. */
  unread: number;
  nextCursor: string | null;
}
export interface MarkNotificationReadInput {
  id: string;
}

/** Push notifikasi (spek 2026-11-12 §5.2). */
export interface PushConfigDto {
  /** Push tersedia (kunci VAPID terkonfigurasi di server). */
  enabled: boolean;
  /** Kunci publik VAPID (teks URL-safe) untuk `pushManager.subscribe`; kosong bila tidak tersedia. */
  publicKey: string;
  /** Preferensi push pemanggil (bawaan aktif); lonceng tidak terpengaruh. */
  userEnabled: boolean;
}
export interface PushSubscribeInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushUnsubscribeInput {
  endpoint: string;
}
export interface PushPreferenceInput {
  enabled: boolean;
}
/** Push dimatikan per perangkat: `endpoint` = langganan peramban perangkat itu (kunci bersama `(endpoint, akun)`). */
export interface PushDeviceMutedInput {
  endpoint: string;
  muted: boolean;
}
export interface PushDeviceStateDto {
  /** Perangkat itu punya langganan untuk akun pemanggil. */
  registered: boolean;
  /** Push dimatikan di perangkat itu (selalu false bila belum terdaftar). */
  muted: boolean;
}
export type PushPermissionState = 'granted' | 'denied' | 'default';
export interface PushPermissionInput {
  state: PushPermissionState;
}
/** Status push per pengguna: dihitung dari hasil pengiriman nyata; tanpa pengenal perangkat atau rincian galat. */
export type PushUserState = 'active' | 'none' | 'failing' | 'disabled' | 'denied';
export interface PushUserStatusDto {
  email: string;
  name: string;
  state: PushUserState;
}

export interface ExportSheetsInput {
  tables?: string[];
}
export type ExportSheetsJobDto = ExportQrJobDto;

/**
 * Tiket serah-terima peramban -> aplikasi desktop (`desktop.handoff`): bertanda tangan, sekali pakai, berlaku 60 detik,
 * terikat ke akun pemanggil. `email` hanya untuk ditampilkan (petunjuk di tautan `qc://`); penukarannya di server
 * (`POST /auth/desktop/handoff`) menentukan akun yang sah.
 */
export interface DesktopHandoffDto {
  ticket: string;
  email: string;
}
