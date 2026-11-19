import * as React from "react"
import { cn } from "cn"
import { Label as LabelPrimitive } from "radix-ui"

function Label({
  className,
  required,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & {
  /** Field wajib: bintang merah lewat CSS (bukan teks DOM, jadi nama aksesibel label tidak berubah). */
  required?: boolean
}) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      data-required={required ? "" : undefined}
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 data-[required]:after:ml-0.5 data-[required]:after:text-destructive data-[required]:after:content-['*']",
        className
      )}
      {...props}
    />
  )
}

export { Label }
