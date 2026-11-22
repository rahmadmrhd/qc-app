import { describe, expect, it } from 'vitest'
import { colorVariantClasses } from './variant-style'

describe('colorVariantClasses', () => {
  it('link berwarna teks warnanya', () => {
    expect(colorVariantClasses('link', 'info')).toContain('text-info-text')
  })
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
