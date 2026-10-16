import {
  parseDriveFileId,
  QR_FRAME_KEYS,
  QR_FRAME_RANGES,
  QR_LAYOUT_KEYS,
  QR_LAYOUT_RANGES,
} from '@shared/qrcode';
import type { QrDocumentDto } from '@shared/rpc';
import { useForm } from '@tanstack/react-form';
import { useRef, useState } from 'react';
import { FieldError } from '@/components/field-error';
import { FormHeader } from '@/components/form-header';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFileUrl } from '@/modules/files/queries';
import { limitDocumentName } from '../lib/document-name';
import { fileToBase64 } from '../lib/file-to-base64';
import { useCloneQrPdf, useUploadQrPdf } from '../queries';
import type { QrFieldErrors, QrFormInput, QrFormOutput } from '../schemas';
import {
  frameRangeMessage,
  layoutRangeMessage,
  qrDefaultsFormSchema,
  qrDesignFormSchema,
} from '../schemas';
import { LabelPreview } from './label-preview';
import type { LabelStatus } from './label-status-alerts';
import { LabelStatusAlerts } from './label-status-alerts';
import { LogoLibraryField } from './logo-library-field';
import { LogoPicker } from './logo-picker';
import { PdfSourceField } from './pdf-source-field';
import { SheetPreviewDialog } from './sheet-preview-dialog';
import { TextStyleToolbar } from './text-style-toolbar';

export interface QrDesignFormProps {
  /** Judul halaman, tampil di bar sticky bersama tombol aksi. */
  title: string;
  defaultValues: QrFormInput;
  /** PDF sumber yang sudah terpasang (saat ubah/duplikat). */
  initialDocument?: QrDocumentDto | null;
  /** Konfigurasi sudah pernah diekspor: PDF sumber hanya boleh diganti isinya (URL tetap). */
  exported?: boolean;
  /** `defaults`: konfigurasi default (tanpa sumber link dan ekspor; mengelola pustaka logo). */
  mode?: 'design' | 'defaults';
  /** Pustaka logo yang dapat dipilih (mode design). */
  logoLibrary?: readonly string[];
  submitError?: string | null;
  fieldErrors?: Readonly<Record<string, string | undefined>>;
  onSubmit: (values: QrFormOutput, options: QrSubmitOptions) => void | Promise<void>;
  onCancel: () => void;
  /** Pemegang izin ekspor: tombol "Simpan dan ekspor" tersedia. */
  canExport?: boolean;
}

export interface QrSubmitOptions {
  /** Isi tidak muat di kanvas 3 × 3 cm menurut pratinjau saat disimpan (disimpan server sebagai flag). */
  overflow: boolean;
  /** Setelah tersimpan, lanjut ke dialog konfirmasi ekspor. */
  thenExport: boolean;
}

/** Kunci ukuran font pada tata letak untuk tiap bagian teks (isiannya ada di bagian teks itu sendiri). */
const TEXT_SIZE_KEY = {
  title: 'titleSize',
  subtitle: 'subtitleSize',
  footer: 'footerSize',
} as const;
const TEXT_SIZE_KEYS: readonly string[] = Object.values(TEXT_SIZE_KEY);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function QrDesignForm({
  title,
  defaultValues,
  initialDocument = null,
  exported = false,
  mode = 'design',
  logoLibrary = [],
  submitError,
  fieldErrors,
  onSubmit,
  onCancel,
  canExport = false,
}: QrDesignFormProps) {
  const uploadPdf = useUploadQrPdf();
  const cloneQrPdf = useCloneQrPdf();
  const [document, setDocument] = useState<QrDocumentDto | null>(initialDocument);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [legacyCloning, setLegacyCloning] = useState(false);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [labelStatus, setLabelStatus] = useState<LabelStatus | null>(null);
  // Nilai terkini untuk handler simpan (menghindari closure basi): status tata letak dan mode simpan.
  const statusRef = useRef<LabelStatus | null>(null);
  statusRef.current = labelStatus;
  const exportAfterRef = useRef(false);
  const isDefaults = mode === 'defaults';
  const schema = (
    isDefaults ? qrDefaultsFormSchema : qrDesignFormSchema
  ) as typeof qrDesignFormSchema;
  const form = useForm({
    defaultValues,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const thenExport = exportAfterRef.current;
      exportAfterRef.current = false;
      await onSubmit(schema.parse(value), {
        overflow: statusRef.current?.overflow ?? false,
        thenExport,
      });
    },
  });

  function applyDocument(next: QrDocumentDto) {
    setDocument(next);
    setLegacyError(null);
    form.setFieldValue('linkSource', 'pdf');
    form.setFieldValue('documentId', next.id);
  }

  async function cloneLegacy(link: string) {
    setLegacyError(null);
    setLegacyCloning(true);
    try {
      applyDocument(await cloneQrPdf.mutateAsync({ source: link }));
    } catch (caught) {
      setLegacyError(caught instanceof Error ? caught.message : 'Gagal menyalin PDF dari Drive');
    } finally {
      setLegacyCloning(false);
    }
  }

  return (
    <form
      noValidate
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="contents">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <FormHeader
              className="lg:col-span-2"
              title={title}
              onCancel={onCancel}
              submitting={submitting}
              busyText={isDefaults ? 'Menyimpan konfigurasi default…' : 'Menyimpan konfigurasi…'}
              submitLabel={isDefaults ? 'Simpan default' : undefined}
              submitDisabled={logoBusy || pdfBusy || legacyCloning}
              onSubmitClick={() => (exportAfterRef.current = false)}
              extra={
                canExport && !isDefaults ? (
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={
                      submitting ||
                      logoBusy ||
                      pdfBusy ||
                      legacyCloning ||
                      labelStatus?.overflow === true
                    }
                    title={
                      labelStatus?.overflow
                        ? 'Isi tidak muat di kanvas 3 × 3 cm: perbaiki dulu agar bisa diekspor'
                        : undefined
                    }
                    onClick={() => (exportAfterRef.current = true)}
                  >
                    Simpan dan ekspor
                  </Button>
                ) : null
              }
            />
          )}
        </form.Subscribe>
        <div className="lg:col-span-2">
          <LabelStatusAlerts status={labelStatus} />
        </div>
      </div>
      <div className="space-y-4">
        <Section title="Isi label">
          {(['title', 'subtitle', 'footer'] as const).map((name) => (
            <form.Field key={name} name={name}>
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor={`qr-${name}`}>
                    {name === 'title' ? 'Title' : name === 'subtitle' ? 'Subtitle' : 'Footer'}
                  </Label>
                  <Input
                    id={`qr-${name}`}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldError errors={[...field.state.meta.errors, fieldErrors?.[name]]} />
                  <form.Subscribe selector={(state) => state.values.layout[TEXT_SIZE_KEY[name]]}>
                    {(size) => {
                      const sizeKey = TEXT_SIZE_KEY[name];
                      const part =
                        name === 'title' ? 'Title' : name === 'subtitle' ? 'Subtitle' : 'Footer';
                      const message = layoutRangeMessage(sizeKey, size);
                      return (
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor={`qr-size-${name}`}
                            className="text-xs text-muted-foreground"
                          >
                            {`Ukuran ${part} (pt)`}
                          </Label>
                          <Input
                            id={`qr-size-${name}`}
                            type="number"
                            className="h-8 w-24"
                            step={QR_LAYOUT_RANGES[sizeKey].step}
                            min={QR_LAYOUT_RANGES[sizeKey].min}
                            max={QR_LAYOUT_RANGES[sizeKey].max}
                            aria-invalid={message ? true : undefined}
                            value={Number.isNaN(size) ? '' : size}
                            onChange={(event) =>
                              form.setFieldValue('layout', {
                                ...form.state.values.layout,
                                [sizeKey]:
                                  event.target.value === ''
                                    ? Number.NaN
                                    : Number(event.target.value),
                              })
                            }
                          />
                          {message ? (
                            <span className="text-sm text-destructive">{message}</span>
                          ) : null}
                        </div>
                      );
                    }}
                  </form.Subscribe>
                  <form.Subscribe selector={(state) => state.values.style[name]}>
                    {(textStyle) => (
                      <TextStyleToolbar
                        part={
                          name === 'title' ? 'Title' : name === 'subtitle' ? 'Subtitle' : 'Footer'
                        }
                        value={textStyle}
                        onChange={(next) =>
                          form.setFieldValue('style', { ...form.state.values.style, [name]: next })
                        }
                      />
                    )}
                  </form.Subscribe>
                </div>
              )}
            </form.Field>
          ))}
        </Section>

        {isDefaults ? null : (
          <Section title="Sumber link">
            <form.Subscribe selector={(state) => state.values}>
              {(values) => {
                if (values.linkSource !== 'url') return null;
                const driveLink = parseDriveFileId(values.link) !== null;
                return (
                  <div className="space-y-2 rounded-md border p-3">
                    <p className="text-sm text-muted-foreground">
                      Link saat ini (bukan salinan di aplikasi):{' '}
                      <span className="break-all">{values.link}</span>
                    </p>
                    {driveLink ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={legacyCloning || pdfBusy}
                        onClick={() => void cloneLegacy(values.link)}
                      >
                        {legacyCloning ? (
                          <BusyLabel>Menyalin…</BusyLabel>
                        ) : (
                          'Salin link ini ke Drive aplikasi'
                        )}
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Link ini bukan link Drive sehingga tidak dapat disalin. Unggah PDF atau
                        salin berkas dari Drive di bawah untuk menggantinya.
                      </p>
                    )}
                    {legacyCloning ? (
                      <p role="status" className="text-sm">
                        <BusyLabel>
                          Memeriksa berkas di Drive, lalu menyalinnya ke folder aplikasi…
                        </BusyLabel>
                      </p>
                    ) : null}
                    {legacyError ? (
                      <p role="alert" className="text-sm text-destructive">
                        {legacyError}
                      </p>
                    ) : null}
                  </div>
                );
              }}
            </form.Subscribe>
            <form.Field name="documentId">
              {(field) => (
                <div className="space-y-1.5">
                  <PdfSourceField
                    document={document}
                    replaceOnly={exported}
                    onDocument={applyDocument}
                    onBusyChange={setPdfBusy}
                    onUpload={async (file, replaceId) =>
                      uploadPdf.mutateAsync({
                        name: limitDocumentName(file.name),
                        base64: await fileToBase64(file),
                        ...(replaceId ? { replaceDocumentId: replaceId } : {}),
                      })
                    }
                    onClone={(source) => cloneQrPdf.mutateAsync({ source })}
                  />
                  <FieldError errors={[...field.state.meta.errors, fieldErrors?.documentId]} />
                  <FieldError errors={[fieldErrors?.link]} />
                </div>
              )}
            </form.Field>
          </Section>
        )}

        {isDefaults ? (
          <Section title="Pustaka logo">
            <form.Field name="logoLibrary">
              {(library) => (
                <form.Field name="logoFileId">
                  {(initial) => (
                    <div className="space-y-1.5">
                      <LogoLibraryField
                        library={library.state.value ?? []}
                        onLibraryChange={library.handleChange}
                        defaultLogoId={initial.state.value}
                        onDefaultLogoChange={initial.handleChange}
                        onBusyChange={setLogoBusy}
                      />
                      <FieldError
                        errors={[
                          ...library.state.meta.errors,
                          fieldErrors?.logoFileIds,
                          fieldErrors?.defaultLogoId,
                        ]}
                      />
                    </div>
                  )}
                </form.Field>
              )}
            </form.Field>
          </Section>
        ) : (
          <Section title="Logo di tengah QR">
            <form.Field name="logoFileId">
              {(field) => (
                <div className="space-y-1.5">
                  <LogoPicker
                    value={field.state.value}
                    onChange={field.handleChange}
                    library={logoLibrary}
                  />
                  <FieldError errors={[...field.state.meta.errors, fieldErrors?.logoFileId]} />
                </div>
              )}
            </form.Field>
          </Section>
        )}

        <Section title="Bingkai QR">
          <form.Subscribe selector={(state) => state.values.style.frame}>
            {(frame) => (
              <div className="space-y-3">
                <div role="radiogroup" aria-label="Jenis bingkai" className="flex flex-wrap gap-4">
                  {(
                    [
                      ['none', 'Tanpa bingkai'],
                      ['corners', 'Siku di sudut'],
                      ['box', 'Kotak penuh'],
                    ] as const
                  ).map(([kind, label]) => (
                    <label key={kind} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="qr-frame-kind"
                        checked={frame.kind === kind}
                        onChange={() =>
                          form.setFieldValue('style', {
                            ...form.state.values.style,
                            frame: { ...form.state.values.style.frame, kind },
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {frame.kind !== 'none' ? (
                  <div role="radiogroup" aria-label="Gaya garis" className="flex flex-wrap gap-4">
                    {(
                      [
                        ['solid', 'Solid'],
                        ['dashed', 'Putus-putus'],
                        ['dotted', 'Titik-titik'],
                      ] as const
                    ).map(([line, label]) => (
                      <label key={line} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="qr-frame-line"
                          checked={frame.line === line}
                          onChange={() =>
                            form.setFieldValue('style', {
                              ...form.state.values.style,
                              frame: { ...form.state.values.style.frame, line },
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                ) : null}
                {frame.kind !== 'none' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {QR_FRAME_KEYS.filter((key) => key !== 'arm' || frame.kind === 'corners').map(
                      (key) => {
                        const range = QR_FRAME_RANGES[key];
                        const id = `qr-frame-${key}`;
                        const message = frameRangeMessage(key, frame[key]);
                        return (
                          <div key={key} className="space-y-1.5">
                            <Label htmlFor={id}>{`${range.label} (${range.unit})`}</Label>
                            <Input
                              id={id}
                              type="number"
                              step={range.step}
                              min={range.min}
                              max={range.max}
                              aria-invalid={message ? true : undefined}
                              value={Number.isNaN(frame[key]) ? '' : frame[key]}
                              onChange={(event) =>
                                form.setFieldValue('style', {
                                  ...form.state.values.style,
                                  frame: {
                                    ...form.state.values.style.frame,
                                    [key]:
                                      event.target.value === ''
                                        ? Number.NaN
                                        : Number(event.target.value),
                                  },
                                })
                              }
                            />
                            {message ? <p className="text-sm text-destructive">{message}</p> : null}
                          </div>
                        );
                      },
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </form.Subscribe>
        </Section>

        <Section title="Ukuran">
          <form.Field name="layout">
            {(field) => (
              <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-2">
                  {QR_LAYOUT_KEYS.filter((key) => !TEXT_SIZE_KEYS.includes(key)).map((key) => {
                    const range = QR_LAYOUT_RANGES[key];
                    const id = `qr-layout-${key}`;
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={id}>{`${range.label} (${range.unit})`}</Label>
                        <Input
                          id={id}
                          type="number"
                          step={range.step}
                          min={range.min}
                          max={range.max}
                          value={Number.isNaN(field.state.value[key]) ? '' : field.state.value[key]}
                          aria-invalid={
                            layoutRangeMessage(key, field.state.value[key]) ? true : undefined
                          }
                          onChange={(event) =>
                            field.handleChange({
                              ...field.state.value,
                              [key]:
                                event.target.value === '' ? Number.NaN : Number(event.target.value),
                            })
                          }
                        />
                        {layoutRangeMessage(key, field.state.value[key]) ? (
                          <p className="text-sm text-destructive">
                            {layoutRangeMessage(key, field.state.value[key])}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <FieldError stacked errors={[...field.state.meta.errors, fieldErrors?.layout]} />
              </div>
            )}
          </form.Field>
        </Section>

        {submitError ? (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        ) : null}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-36 lg:self-start">
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <PreviewPane
              values={values}
              document={document}
              sheetOpen={sheetOpen}
              onSheetOpenChange={setSheetOpen}
              onStatus={setLabelStatus}
            />
          )}
        </form.Subscribe>
      </aside>
    </form>
  );
}

function PreviewPane({
  values,
  document,
  sheetOpen,
  onSheetOpenChange,
  onStatus,
}: {
  values: QrFormInput;
  document: QrDocumentDto | null;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  onStatus: (status: LabelStatus) => void;
}) {
  const { url: logoUrl } = useFileUrl(values.logoFileId);
  const link = values.linkSource === 'url' ? values.link : (document?.link ?? '');
  const logo = values.logoFileId !== '' ? logoUrl : null;
  return (
    <>
      <LabelPreview
        title={values.title}
        subtitle={values.subtitle}
        footer={values.footer}
        link={link}
        layout={values.layout}
        style={values.style}
        logoUrl={logo}
        onStatus={onStatus}
      />
      <Button type="button" variant="outline" onClick={() => onSheetOpenChange(true)}>
        Pratinjau lembar
      </Button>
      <SheetPreviewDialog
        open={sheetOpen}
        onOpenChange={onSheetOpenChange}
        design={{
          title: values.title,
          subtitle: values.subtitle,
          footer: values.footer,
          link,
          layout: values.layout,
          style: values.style,
        }}
        logoUrl={logo}
      />
    </>
  );
}
