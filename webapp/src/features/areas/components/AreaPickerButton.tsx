/**
 * Drop-in area picker for widget settings panels.
 *
 * Renders a trigger button that opens {@link AreaPickerSheet},
 * plus selected area chips with remove buttons below.
 * "View on map" opens {@link AreaMapDialog} in-context rather
 * than navigating away from the current board.
 */

import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Cancel01Icon,
  MapsLocation01Icon,
} from '@hugeicons/core-free-icons'
import { useAreas } from '../hooks/use-areas'
import { AreaPreview } from './AreaPreview'
import { AreaPickerSheet } from './AreaPickerSheet'
import { AreaMapDialog } from './AreaMapDialog'
import type { CustomArea } from '../types'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Props {
  selectedAreaIds: Array<string>
  onChange: (areaIds: Array<string>) => void
}

export function AreaPickerButton({ selectedAreaIds, onChange }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [previewArea, setPreviewArea] = useState<CustomArea | null>(null)
  const areas = useAreas()

  const selectedAreas = areas.filter((a) => selectedAreaIds.includes(a.id))

  const removeArea = (id: string) => {
    onChange(selectedAreaIds.filter((a) => a !== id))
  }

  return (
    <div>
      <Label>Custom Areas</Label>

      <div className="mt-1.5 flex gap-2">
        <Button
          variant="outline"
          size="default"
          className="w-full"
          onClick={() => setSheetOpen(true)}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Add custom area
        </Button>
      </div>

      {/* Selected area chips */}
      {selectedAreas.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {selectedAreas.map((area) => (
            <div
              key={area.id}
              className="flex items-center gap-2 rounded-md border px-2 py-1"
            >
              <AreaPreview
                polygon={area.polygon}
                color={area.color}
                size={28}
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: area.color }}
                  />
                  <span className="truncate text-xs font-medium">
                    {area.name}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title="View on map"
                onClick={() => setPreviewArea(area)}
              >
                <HugeiconsIcon icon={MapsLocation01Icon} strokeWidth={2} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Remove"
                onClick={() => removeArea(area.id)}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <AreaPickerSheet
        selectedAreaIds={selectedAreaIds}
        onChange={onChange}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onViewArea={setPreviewArea}
      />

      <AreaMapDialog
        area={previewArea}
        open={previewArea !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewArea(null)
        }}
      />
    </div>
  )
}
