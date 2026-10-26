/**
 * Full property detail dialog — opened from the map popup's "View Details" button.
 */

import type { MapPointProperties } from './types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

const NATURE_LABELS: Record<string, string> = {
  V: 'Vacant Land',
  R: 'Residence',
  '3': 'Other',
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High (exact address match)',
  medium: 'Medium (fuzzy match)',
  low: 'Low (locality centroid)',
}

interface Props {
  properties: MapPointProperties | null
  onClose: () => void
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value ?? '—'}</span>
    </div>
  )
}

export function PropertyDetailDialog({ properties, onClose }: Props) {
  if (!properties) return null

  return (
    <Dialog open={!!properties} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{properties.address}</DialogTitle>
          <DialogDescription>
            {properties.locality}
            {properties.zoneCode && ` — ${properties.zoneCode}`}
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border">
          <DetailRow
            label="Sale Price"
            value={currencyFormatter.format(properties.purchasePrice)}
          />
          <DetailRow
            label="Contract Date"
            value={properties.contractDate || '—'}
          />
          <DetailRow label="Zone Code" value={properties.zoneCode || '—'} />
          <DetailRow
            label="Nature of Property"
            value={
              properties.natureOfProperty
                ? (NATURE_LABELS[properties.natureOfProperty] ??
                  properties.natureOfProperty)
                : '—'
            }
          />
          <DetailRow
            label="Geocode Confidence"
            value={
              properties.geocodeConfidence
                ? (CONFIDENCE_LABELS[properties.geocodeConfidence] ??
                  properties.geocodeConfidence)
                : '—'
            }
          />
          <DetailRow
            label="Property ID"
            value={
              <span className="font-mono text-xs">{properties.propertyId}</span>
            }
          />
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
