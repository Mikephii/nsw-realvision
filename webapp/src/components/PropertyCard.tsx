import type { PropertyResult } from '@/lib/autocomplete'
import { cn } from '@/lib/utils'
import { formatAddress, propertyKey } from '@/lib/format'

interface PropertyCardProps {
  property: PropertyResult
  isSelected: boolean
  onSelect: (property: PropertyResult) => void
}

export function PropertyCard({
  property,
  isSelected,
  onSelect,
}: PropertyCardProps) {
  return (
    <button
      key={propertyKey(property)}
      type="button"
      onClick={() => onSelect(property)}
      className={cn(
        'w-full cursor-pointer rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent',
        isSelected && 'ring-2 ring-primary',
      )}
    >
      <div className="font-medium text-sm">{formatAddress(property)}</div>
      <div className="text-xs text-muted-foreground">
        {property.saleCount} sale{property.saleCount !== 1 ? 's' : ''}
        {property.lastSaleYear && ` · Last ${property.lastSaleYear}`}
      </div>
    </button>
  )
}
