/**
 * Shared suburb picker for widget settings panels.
 *
 * Renders selected suburbs as removable badges plus an autocomplete input
 * to add new ones. Manages its own search callback internally.
 */

import { useCallback } from 'react'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { AutocompleteInput } from '@/components/AutocompleteInput'
import { getLocalities } from '@/lib/server-fns'

interface Props {
  localities: Array<string>
  onChange: (localities: Array<string>) => void
}

export function SuburbsFilter({ localities, onChange }: Props) {
  const searchLocalities = useCallback(
    (prefix: string) => getLocalities({ data: { prefix } }),
    [],
  )

  const addLocality = (locality: string) => {
    if (!localities.includes(locality)) {
      onChange([...localities, locality])
    }
  }

  const removeLocality = (locality: string) => {
    onChange(localities.filter((l) => l !== locality))
  }

  return (
    <div>
      <Label>Suburbs</Label>
      {localities.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {localities.map((loc) => (
            <Badge key={loc} variant="secondary" className="gap-1">
              {loc}
              <button
                type="button"
                onClick={() => removeLocality(loc)}
                className="ml-0.5 hover:text-destructive"
              >
                x
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-1.5">
        <AutocompleteInput
          label=""
          placeholder="Add a suburb..."
          value={null}
          onSelect={(item) => addLocality(item.locality)}
          onClear={() => {}}
          search={searchLocalities}
          renderItem={(item) => (
            <div className="flex items-center justify-between">
              <span>{item.locality}</span>
              <span className="text-muted-foreground">{item.postCode}</span>
            </div>
          )}
          getItemLabel={(item) => item.locality}
        />
      </div>
    </div>
  )
}
