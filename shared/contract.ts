import type { Assignment, LocationPermissionMap } from './assignments';
import type { BuAssignment, BuPermissionMap } from './business-units';
import type { HandoverStatus } from './handover';
import type { PartialPermissionMap, PermissionMap } from './permissions';
import type { QrExportStatus, QrLayout, QrLinkSource, QrStyle } from './qrcode';

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
}

export interface MeDto {
  email: string;
  name: string;
  isSuperAdmin: boolean;
  /** Izin GLOBAL: hanya dari penugasan "Semua lokasi" (satu-satunya sumber modul `access`). */
  permissions: PermissionMap;
  /** Lokasi aktif yang boleh diakses, terurut menurut kode. */
  locations: LocationAccessDto[];
  /** BU yang user punya level apa pun atasnya (termasuk BU nonaktif), terurut menurut kode. */
  businessUnits: BusinessUnitAccessDto[];
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  assignments: Assignment[];
  /** Penugasan BU (`buId: null` = Semua BU); berlaku sama di semua lokasi. */
  buAssignments: BuAssignment[];
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

export interface FileContentDto {
  id: string;
  mime: string;
  bytes: Uint8Array;
}
export type ItemStatus = 'active' | 'inactive';

export interface ItemStickerDto {
  name: string;
  /** Posisi/ketentuan penempelan. */
  note: string;
  /** Id berkas contoh (sheet `files`), atau `null`. */
  fileId: string | null;
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
  /** Jumlah item (aktif maupun nonaktif) yang memakai merk ini. */
  itemCount: number;
  updatedAt: string;
}

export interface SaveBrandInput {
  id?: string;
  name: string;
}

export interface SetBrandStatusInput {
  id: string;
  status: ItemStatus;
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
  updatedAt: string;
}

export interface ItemDto extends ItemSummaryDto {
  stickers: ItemStickerDto[];
  accessories: ItemAccessoryDto[];
  /** Id berkas galeri (sheet `files`), urut. */
  attachments: string[];
  /** Detail Markdown. */
  detail: string;
  createdAt: string;
  updatedBy: string;
}

export interface SaveItemInput {
  id?: string;
  /** `updatedAt` item saat form dimuat; bila sudah berbeda, simpan ditolak (CONFLICT) agar tidak menimpa ubahan orang lain. */
  expectedUpdatedAt?: string;
  brand: string;
  model: string;
  isCountryLock: boolean;
  aliases: string[];
  stickers: ItemStickerDto[];
  accessories: ItemAccessoryDto[];
  attachments: string[];
  detail: string;
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
  tasks: Array<{ customerName: string; note: string }>;
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
}

// --- QR Code Label ---
export interface QrDesignDto {
  id: string;
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
}
export interface SaveQrDesignInput {
  id?: string;
  expectedUpdatedAt?: string;
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
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
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
export interface QrDesignRefInput {
  id: string;
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
  'brands.list': { input: null; output: BrandDto[] };
  'brands.save': { input: SaveBrandInput; output: BrandDto };
  'brands.setStatus': { input: SetBrandStatusInput; output: BrandDto };
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
  'qrcodes.list': { input: null; output: QrDesignDto[] };
  'qrcodes.get': { input: QrDesignRefInput; output: QrDesignDto };
  'qrcodes.save': { input: SaveQrDesignInput; output: QrDesignDto };
  'qrcodes.delete': { input: QrDesignRefInput; output: QrDesignRefInput };
  'qrcodes.getDefaults': { input: null; output: QrDefaultsDto };
  'qrcodes.savePreset': { input: SaveQrPresetInput; output: QrPresetDto };
  'qrcodes.deletePreset': { input: QrDesignRefInput; output: QrDesignRefInput };
  'qrcodes.saveLogoLibrary': { input: SaveQrLogoLibraryInput; output: QrLogoLibraryDto };
  'qrcodes.uploadPdf': { input: UploadQrPdfInput; output: QrDocumentDto };
  'qrcodes.cloneFromDrive': { input: CloneQrPdfInput; output: QrDocumentDto };
  'qrcodes.export': { input: ExportQrDesignInput; output: ExportQrJobDto };
  'qrcodes.file': { input: QrFileInput; output: QrFileDto };
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
  status?: ItemStatus;
}

export interface ItemPageDto {
  items: ItemSummaryDto[];
  nextCursor: string | null;
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

export type JobKind = 'qr_export' | 'sheets_export' | 'cleanup_qr' | 'db_backup';
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
export interface ExportSheetsInput {
  tables?: string[];
}
export type ExportSheetsJobDto = ExportQrJobDto;
