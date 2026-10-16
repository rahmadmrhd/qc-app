import { QR_FRAME_KEYS, QR_FRAME_RANGES, QR_LAYOUT_KEYS, QR_LAYOUT_RANGES } from '@shared/qrcode';
import type { QrDesignDto, QrDocumentDto } from '@shared/rpc';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFileUrl } from '@/modules/files/queries';
import { fileToBase64 } from '../lib/file-to-base64';
import { useUploadQrPdf } from '../queries';
import type { QrFieldErrors, QrFormInput, QrFormOutput } from '../schemas';
import { frameRangeMessage, layoutRangeMessage, qrDesignFormSchema } from '../schemas';
import { LabelPreview } from './label-preview';
import type { LabelStatus } from './label-status-alerts';
import { LabelStatusAlerts } from './label-status-alerts';
import { LogoField } from './logo-field';
import { PdfSourceField } from './pdf-source-field';
import { SheetPreviewDialog } from './sheet-preview-dialog';
import { TextStyleToolbar } from './text-style-toolbar';

export interface QrDesignFormProps {
  defaultValues: QrFormInput;
  /** PDF sumber yang sudah terpasang (saat ubah/duplikat). */
  initialDocument?: QrDocumentDto | null;
  designs: readonly QrDesignDto[];
  submitError?: string | null;
  fieldErrors?: QrFieldErrors;
  onSubmit: (values: QrFormOutput) => void | Promise<void>;
  onCancel: () => void;
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
  defaultValues,
  initialDocument = null,
  designs,
  submitError,
  fieldErrors,
  onSubmit,
  onCancel,
}: QrDesignFormProps) {
  const uploadPdf = useUploadQrPdf();
  const [document, setDocument] = useState<QrDocumentDto | null>(initialDocument);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [labelStatus, setLabelStatus] = useState<LabelStatus | null>(null);
  const form = useForm({
    defaultValues,
    validators: { onSubmit: qrDesignFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(qrDesignFormSchema.parse(value));
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="lg:col-span-2">
        <LabelStatusAlerts status={labelStatus} />
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

        <Section title="Sumber link">
          <form.Field name="linkSource">
            {(field) => (
              <div role="radiogroup" aria-label="Sumber link" className="flex flex-wrap gap-4">
                {(
                  [
                    ['url', 'Link manual'],
                    ['pdf', 'PDF di Drive'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="qr-link-source"
                      checked={field.state.value === value}
                      onChange={() => field.handleChange(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.linkSource}>
            {(source) =>
              source === 'url' ? (
                <form.Field name="link">
                  {(field) => (
                    <div className="space-y-1.5">
                      <Label htmlFor="qr-link">Link</Label>
                      <Input
                        id="qr-link"
                        inputMode="url"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                      <FieldError errors={[...field.state.meta.errors, fieldErrors?.link]} />
                    </div>
                  )}
                </form.Field>
              ) : (
                <form.Field name="documentId">
                  {(field) => (
                    <div className="space-y-1.5">
                      <PdfSourceField
                        document={document}
                        onDocument={(next) => {
                          setDocument(next);
                          field.handleChange(next.id);
                        }}
                        onUpload={async (file, replaceId) =>
                          uploadPdf.mutateAsync({
                            name: file.name,
                            base64: await fileToBase64(file),
                            ...(replaceId ? { replaceDocumentId: replaceId } : {}),
                          })
                        }
                      />
                      <FieldError errors={[...field.state.meta.errors, fieldErrors?.documentId]} />
                    </div>
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
        </Section>

        <Section title="Logo di tengah QR">
          <form.Field name="logoFileId">
            {(field) => (
              <div className="space-y-1.5">
                <LogoField
                  value={field.state.value}
                  onChange={field.handleChange}
                  designs={designs}
                />
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.logoFileId]} />
              </div>
            )}
          </form.Field>
        </Section>

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
        <div className="flex flex-wrap gap-2">
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <Button type="submit" disabled={submitting}>
                Simpan
              </Button>
            )}
          </form.Subscribe>
          <Button type="button" variant="outline" onClick={onCancel}>
            Batal
          </Button>
        </div>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
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
