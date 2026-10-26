/**
 * Shared data source selector for line chart widgets.
 *
 * Lets the user choose between "All Sales" (default) and "Repeat Sales Only"
 * (properties that have sold 2+ times). The repeat-sales option reduces
 * composition bias by tracking the same set of properties over time.
 *
 * Shows an ⓘ explainer icon when repeat-sales is active.
 */

import { MethodExplainer } from '../MethodExplainer'
import type { DataSource } from '@/lib/queries'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface DataSourceControlProps {
  /** Currently selected data source. */
  value: DataSource
  /** Called when the user selects a different data source. */
  onChange: (value: DataSource) => void
}

export function DataSourceControl({ value, onChange }: DataSourceControlProps) {
  return (
    <div>
      <div className="flex items-center gap-0.5">
        <Label>Data Source</Label>
        {value === 'repeat-sales' && (
          <MethodExplainer methodId="repeat-sales" />
        )}
      </div>
      <Select value={value} onValueChange={(v) => onChange(v as DataSource)}>
        <SelectTrigger className="mt-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-sales">All Sales</SelectItem>
          <SelectItem value="repeat-sales">Repeat Sales Only</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
