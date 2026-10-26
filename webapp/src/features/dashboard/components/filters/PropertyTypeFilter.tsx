/**
 * Shared strata/freehold filter for widget settings panels.
 *
 * Renders a Select dropdown with All Properties / Freehold Only / Strata Only.
 */

import type { StrataFilter } from '@/lib/queries'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  value: StrataFilter
  onChange: (value: StrataFilter) => void
}

export function PropertyTypeFilter({ value, onChange }: Props) {
  return (
    <div>
      <Label>Property Type</Label>
      <Select value={value} onValueChange={(v) => onChange(v as StrataFilter)}>
        <SelectTrigger className="mt-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Properties</SelectItem>
          <SelectItem value="freehold">Freehold Only</SelectItem>
          <SelectItem value="strata">Strata Only</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
