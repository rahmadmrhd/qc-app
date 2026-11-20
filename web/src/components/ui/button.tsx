import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"
import {
  colorVariantClasses,
  resolveStyle,
  type LegacyVariant,
  type UiColor,
  type UiVariant,
} from "./variant-style"

const buttonBase = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default:
          "h-8 gap-1.5 px-2.5 max-md:h-11 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 max-md:h-11 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 max-md:h-11 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8 max-md:size-11",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 max-md:size-11 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 max-md:size-11",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

type ButtonSize = NonNullable<VariantProps<typeof buttonBase>["size"]>

/** Kelas tombol lengkap (dasar + ukuran + warna x gaya); varian lama dipetakan lewat resolveStyle. */
function buttonVariants({
  variant,
  color,
  size,
  className,
}: {
  variant?: UiVariant | LegacyVariant
  color?: UiColor
  size?: ButtonSize
  className?: string
} = {}) {
  const r = resolveStyle(variant, color)
  return cn(buttonBase({ size }), colorVariantClasses(r.variant, r.color), className)
}

function Button({
  className,
  variant,
  color,
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: UiVariant | LegacyVariant
  color?: UiColor
  size?: ButtonSize
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "button"
  const r = resolveStyle(variant, color)

  return (
    <Comp
      data-slot="button"
      data-variant={r.variant}
      data-color={r.color}
      data-size={size}
      className={buttonVariants({ variant, color, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
