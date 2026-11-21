import { describe, expect, it } from 'vitest'
import { colorVariantClasses, resolveStyle } from './variant-style'

describe('resolveStyle', () => {
  it('bawaan = solid primary', () => {
    expect(resolveStyle()).toEqual({ variant: 'solid', color: 'primary' })
    expect(resolveStyle('default')).toEqual({ variant: 'solid', color: 'primary' })
  })

  it('memetakan varian lama', () => {
    expect(resolveStyle('secondary')).toEqual({ variant: 'soft', color: 'secondary' })
    expect(resolveStyle('destructive')).toEqual({ variant: 'soft', color: 'destructive' })
    expect(resolveStyle('link')).toEqual({ variant: 'link', color: 'info' })
    expect(resolveStyle('outline')).toEqual({ variant: 'outline', color: 'primary' })
    expect(resolveStyle('ghost')).toEqual({ variant: 'ghost', color: 'primary' })
  })

  it('warna eksplisit menang', () => {
    expect(resolveStyle('soft', 'success')).toEqual({ variant: 'soft', color: 'success' })
    expect(resolveStyle('destructive', 'warning')).toEqual({ variant: 'soft', color: 'warning' })
  })
})

describe('colorVariantClasses', () => {
  it('solid', () => {
    const c = colorVariantClasses('solid', 'success')
    expect(c).toContain('bg-success')
    expect(c).toContain('text-success-foreground')
  })
  it('soft memakai warna teks', () => {
    expect(colorVariantClasses('soft', 'info')).toContain('text-info-text')
  })
  it('outline', () => {
    expect(colorVariantClasses('outline', 'destructive')).toContain('border-destructive-text')
  })
  it('ghost primary tidak berlatar primary', () => {
    expect(colorVariantClasses('ghost', 'primary')).not.toContain('bg-primary')
  })
})
