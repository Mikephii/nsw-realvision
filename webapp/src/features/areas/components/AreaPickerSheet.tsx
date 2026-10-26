/**
 * Sheet overlay for selecting custom areas in widget settings.
 *
 * Displays all saved areas as toggleable items with preview thumbnails.
 * Includes a "view on map" button per item and a link to create new areas.
 */

import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { MapsLocation01Icon } from '@hugeicons/core-free-icons'
import { useAreas } from '../hooks/use-areas'
import { AreaPreview } from './AreaPreview'
import type { CustomArea } from '../types'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface Props {
  selectedAreaIds: Array<string>
  onChange: (areaIds: Array<string>) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  onViewArea?: (area: CustomArea) => void
}

export function AreaPickerSheet({
  selectedAreaIds,
  onChange,
  open,
  onOpenChange,
  onViewArea,
}: Props) {
  const areas = useAreas()

  const toggleArea = (id: string) => {
    if (selectedAreaIds.includes(id)) {
      onChange(selectedAreaIds.filter((a) => a !== id))
    } else {
      onChange([...selectedAreaIds, id])
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Select Areas</SheetTitle>
          <SheetDescription>
            Choose custom areas to filter this widget&apos;s data.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 pt-0">
          {areas.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No custom areas yet.
              </p>
              <Button asChild variant="outline">
                <Link to="/areas/new">Create Area</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {areas.map((area) => (
                <AreaPickerItem
                  key={area.id}
                  area={area}
                  selected={selectedAreaIds.includes(area.id)}
                  onToggle={() => toggleArea(area.id)}
                  onView={onViewArea ? () => onViewArea(area) : undefined}
                />
              ))}

              <div className="pt-3">
                <Button asChild variant="outline" className="w-full">
                  <Link to="/areas/new">Create New Area</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button size="lg" className="w-full">
              Done
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function AreaPickerItem({
  area,
  selected,
  onToggle,
  onView,
}: {
  area: CustomArea
  selected: boolean
  onToggle: () => void
  onView?: () => void
}) {
  return (
    <div
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 transition-colors ${
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={onToggle}
      >
        <AreaPreview
          polygon={area.polygon}
          color={area.color}
          size={36}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: area.color }}
            />
            <span className="truncate text-sm font-medium">{area.name}</span>
          </div>
          {area.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {area.description}
            </p>
          )}
        </div>
      </button>

      {/* View on map */}
      {onView && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="View on map"
          onClick={onView}
        >
          <HugeiconsIcon icon={MapsLocation01Icon} strokeWidth={2} />
        </Button>
      )}

      {/* Selection indicator */}
      <button
        type="button"
        onClick={onToggle}
        className={`size-4 shrink-0 rounded-sm border transition-colors ${
          selected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
        }`}
      >
        {selected && (
          <svg viewBox="0 0 16 16" className="size-4 text-primary-foreground">
            <path
              d="M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2.5-2.5a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>
    </div>
  )
}
