/**
 * Shared formatting utilities for property sale data.
 */

import type { PropertyResult } from './autocomplete'

export function formatAddress(p: PropertyResult): string {
  const parts: Array<string> = []
  if (p.unitNumber) parts.push(`Unit ${p.unitNumber},`)
  if (p.houseNumber) parts.push(p.houseNumber)
  if (p.streetName) parts.push(p.streetName)
  return parts.join(' ') || 'Unknown address'
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(price)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Date unknown'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function natureLabel(code: string): string {
  switch (code) {
    case 'V':
      return 'Vacant Land'
    case 'R':
      return 'Residence'
    case '3':
      return 'Other'
    default:
      return code
  }
}

/**
 * Composite key for uniquely identifying a property card.
 * propertyId alone is not unique when multiple units share the same ID.
 */
export function propertyKey(p: PropertyResult): string {
  return `${p.propertyId}::${p.unitNumber ?? ''}::${p.houseNumber ?? ''}`
}
