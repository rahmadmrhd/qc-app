import { QR_LAYOUT_KEYS, QR_LAYOUT_RANGES } from '@shared/qrcode';
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
import { layoutRangeMessage, qrDesignFormSchema } from '../schemas';
import { LabelPreview } from './label-preview';
import type { LabelStatus } from './label-status-alerts';
import { LabelStatusAlerts } from './label-status-alerts';
import { LogoField } from './logo-field';
import { PdfSourceField } from './pdf-source-field';
import { SheetPreviewDialog } from './sheet-preview-dialog';

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

        <Section title="Ukuran">
          <form.Field name="layout">
            {(field) => (
              <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-2">
                  {QR_LAYOUT_KEYS.map((key) => {
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
        }}
        logoUrl={logo}
      />
    </>
  );
}
