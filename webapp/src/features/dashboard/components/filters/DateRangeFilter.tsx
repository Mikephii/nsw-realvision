/**
 * Shared date range picker for widget settings panels.
 *
 * Renders a two-column grid with From and To date inputs.
 */

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

interface Props {
  dateFrom: string | null
  dateTo: string | null
  onChange: (dateFrom: string | null, dateTo: string | null) => void
}

export function DateRangeFilter({ dateFrom, dateTo, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label>From</Label>
        <Input
          type="date"
          className="mt-1"
          value={dateFrom ?? ''}
          onChange={(e) => onChange(e.target.value || null, dateTo)}
        />
      </div>
      <div>
        <Label>To</Label>
        <Input
          type="date"
          className="mt-1"
          value={dateTo ?? ''}
          onChange={(e) => onChange(dateFrom, e.target.value || null)}
        />
      </div>
    </div>
  )
}
