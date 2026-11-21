"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as SheetPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { useBackToCloseRoot } from "@/hooks/use-back-to-close"
import { XIcon } from "lucide-react"

/** Meminta lembar yang sedang terbuka menutup (dipakai gestur seret ke bawah pada lembar bawah). */
const SheetCloseContext = React.createContext<(() => void) | null>(null)

function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  backToClose,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root> & { backToClose?: boolean }) {
  // Ponsel: back menutup panel (hook no-op di desktop).
  const root = useBackToCloseRoot({ open, defaultOpen, onOpenChange, backToClose })
  const changeOpen = root.onOpenChange
  const requestClose = React.useCallback(() => changeOpen(false), [changeOpen])
  return (
    <SheetCloseContext.Provider value={requestClose}>
      <SheetPrimitive.Root data-slot="sheet" {...root} {...props} />
    </SheetCloseContext.Provider>
  )
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/** Seretan dihitung sebagai gestur bila melewati jarak ini (px), atau cukup cepat (px/ms) dan melewati jarak minimum. */
const DRAG_DISTANCE = 48
const DRAG_MIN_FOR_VELOCITY = 16
const DRAG_VELOCITY = 0.5
/** Di bawah jarak ini pelepasan dianggap ketukan (membalik collapsed/expanded). */
const TAP_DISTANCE = 6

/**
 * Pegangan lembar bawah (B2d): seret ke atas = layar penuh (expanded), seret ke bawah dari layar penuh = tinggi awal
 * (collapsed), seret ke bawah dari tinggi awal = tutup; ketukan membalik collapsed/expanded. Ditangani dengan pointer
 * events; selama menyeret lembar mengikuti jari lewat `transform` (tanpa render ulang).
 */
function SheetHandle({
  expanded,
  onExpandedChange,
  contentRef,
}: {
  expanded: boolean
  onExpandedChange: (next: boolean) => void
  contentRef: React.RefObject<HTMLDivElement | null>
}) {
  const requestClose = React.useContext(SheetCloseContext)
  const start = React.useRef<{ y: number; at: number; id: number } | null>(null)
  // Seretan baru saja selesai: `click` yang menyusul pelepasan jari tidak boleh dihitung sebagai ketukan.
  const dragged = React.useRef(false)

  const setOffset = (value: number | null) => {
    const node = contentRef.current
    if (!node) return
    node.style.transition = value === null ? "" : "none"
    node.style.transform = value === null ? "" : `translateY(${value}px)`
  }

  const finish = (clientY: number, cancelled: boolean) => {
    const origin = start.current
    start.current = null
    setOffset(null)
    if (!origin || cancelled) return
    const dy = clientY - origin.y
    if (Math.abs(dy) >= TAP_DISTANCE) {
      dragged.current = true
      setTimeout(() => {
        dragged.current = false
      }, 50)
    }
    const elapsed = Math.max(1, performance.now() - origin.at)
    const velocity = Math.abs(dy) / elapsed
    const passed =
      Math.abs(dy) >= DRAG_DISTANCE ||
      (Math.abs(dy) >= DRAG_MIN_FOR_VELOCITY && velocity >= DRAG_VELOCITY)
    if (!passed) return
    if (dy < 0) {
      if (!expanded) onExpandedChange(true)
    } else if (expanded) {
      onExpandedChange(false)
    } else {
      requestClose?.()
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: pegangan seret berbentuk strip; butuh pointer events pada elemen non-tombol
    <div
      role="button"
      tabIndex={0}
      aria-label={expanded ? "Kecilkan lembar" : "Lebarkan lembar"}
      data-slot="sheet-handle"
      className="-mb-3 flex shrink-0 cursor-grab items-center justify-center py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
      style={{ touchAction: "none" }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return
        start.current = { y: event.clientY, at: performance.now(), id: event.pointerId }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        const origin = start.current
        if (!origin || origin.id !== event.pointerId) return
        const dy = event.clientY - origin.y
        // Ke atas hanya diikuti saat belum expanded (lembar tak melewati batas atas layar).
        setOffset(expanded ? Math.max(dy, 0) : Math.max(dy, -DRAG_DISTANCE * 2))
      }}
      onPointerUp={(event) => finish(event.clientY, false)}
      onPointerCancel={(event) => finish(event.clientY, true)}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false
          return
        }
        onExpandedChange(!expanded)
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" && !expanded) {
          event.preventDefault()
          onExpandedChange(true)
        } else if (event.key === "ArrowDown" && expanded) {
          event.preventDefault()
          onExpandedChange(false)
        }
      }}
    >
      <span aria-hidden className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
    </div>
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  style,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  const bottom = side === "bottom"
  // Tiga keadaan lembar bawah: collapsed (tinggi isi), expanded (layar penuh), tertutup (tak dirender). Konten hanya
  // terpasang saat terbuka, jadi keadaan ini otomatis kembali collapsed pada pembukaan berikutnya.
  const [expanded, setExpanded] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement>(null)
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={contentRef}
        data-slot="sheet-content"
        data-side={side}
        data-expanded={bottom && expanded ? "true" : undefined}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground [--tabs-surface:var(--popover)] shadow-lg transition duration-200 ease-in-out motion-reduce:animate-none motion-reduce:transition-none data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10 data-[expanded=true]:rounded-none data-[expanded=true]:pt-[env(safe-area-inset-top)]",
          className
        )}
        style={bottom && expanded ? { ...style, height: "100dvh", maxHeight: "none" } : style}
        {...props}
      >
        {bottom ? (
          <SheetHandle expanded={expanded} onExpandedChange={setExpanded} contentRef={contentRef} />
        ) : null}
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
