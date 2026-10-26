/**
 * Area card for the area list page.
 *
 * Displays a larger preview than the sheet-context {@link AreaCard},
 * with name, description, metadata, and navigation to the edit page.
 * Delete confirmation reuses {@link DeleteAreaDialog}.
 */

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Delete02Icon,
  MapsLocation01Icon,
  PencilEdit01Icon,
} from '@hugeicons/core-free-icons'
import { useAreaActions } from '../hooks/use-areas'
import { AreaPreview } from './AreaPreview'
import { DeleteAreaDialog } from './DeleteAreaDialog'
import type { CustomArea } from '../types'
import { Button } from '@/components/ui/button'

interface Props {
  area: CustomArea
}

export function AreaListCard({ area }: Props) {
  const { remove } = useAreaActions()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const vertexCount = area.polygon.coordinates[0].length - 1
  const createdDate = new Date(area.createdAt).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="group relative rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50">
      <div className="flex gap-4">
        {/* SVG polygon preview */}
        <AreaPreview
          polygon={area.polygon}
          color={area.color}
          size={80}
          className="shrink-0"
        />

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Name + color indicator */}
          <div className="flex items-center gap-2">
            <div
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: area.color }}
            />
            <h3 className="truncate text-sm font-medium">{area.name}</h3>
          </div>

          {/* Description */}
          {area.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {area.description}
            </p>
          )}

          {/* Metadata */}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {vertexCount} vertices &middot; Created {createdDate}
          </p>
        </div>
      </div>

      {/* Action buttons — top right, visible on hover */}
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon" title="View on map" asChild>
          <Link to="/areas/$areaId/edit" params={{ areaId: area.id }}>
            <HugeiconsIcon icon={MapsLocation01Icon} strokeWidth={2} />
          </Link>
        </Button>
        <Button variant="ghost" size="icon" title="Edit area" asChild>
          <Link to="/areas/$areaId/edit" params={{ areaId: area.id }}>
            <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Delete area"
          className="hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
      </div>

      <DeleteAreaDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        areaName={area.name}
        onConfirm={() => {
          remove(area.id)
          setDeleteOpen(false)
        }}
      />
    </div>
  )
}
