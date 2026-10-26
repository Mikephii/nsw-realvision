/**
 * Area card — displays a single custom area with interactive controls.
 *
 * Features:
 * - SVG polygon preview thumbnail
 * - Inline rename (click name or pencil icon → Input with confirm/cancel)
 * - Color picker (row of {@link AREA_COLORS} swatches, click to change)
 * - Delete button with {@link DeleteAreaDialog} confirmation
 * - Metadata line (vertex count, creation date)
 *
 * Follows the inline-edit pattern from {@link DashboardTabs}.
 */

import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  Delete02Icon,
  PencilEdit01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { useAreaActions } from '../hooks/use-areas'
import { AREA_COLORS } from '../types'
import { AreaPreview } from './AreaPreview'
import { DeleteAreaDialog } from './DeleteAreaDialog'
import type { CustomArea } from '../types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** The area to display. */
  area: CustomArea
  /** Whether inline rename is active for this card. */
  isEditing: boolean
  /** Start inline rename mode. */
  onStartEdit: () => void
  /** Exit inline rename mode. */
  onStopEdit: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AreaCard({ area, isEditing, onStartEdit, onStopEdit }: Props) {
  const { update, remove } = useAreaActions()
  const [editName, setEditName] = useState(area.name)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Sync local edit state when area name changes externally
  useEffect(() => {
    setEditName(area.name)
  }, [area.name])

  const confirmRename = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== area.name) {
      update(area.id, { name: trimmed })
    }
    onStopEdit()
  }

  // Subtract 1 for the closing coordinate (first == last in GeoJSON)
  const vertexCount = area.polygon.coordinates[0].length - 1
  const createdDate = new Date(area.createdAt).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="group rounded-lg border p-3">
      <div className="flex gap-3">
        {/* SVG polygon preview */}
        <AreaPreview
          polygon={area.polygon}
          color={area.color}
          className="shrink-0"
        />

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Name row */}
          <div className="flex items-center gap-1.5">
            {isEditing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  confirmRename()
                }}
                className="flex flex-1 items-center gap-1"
              >
                <Input
                  autoFocus
                  className="h-6 flex-1 px-1.5 text-xs"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={confirmRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditName(area.name)
                      onStopEdit()
                    }
                  }}
                />
                <button
                  type="submit"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    className="size-3"
                    strokeWidth={2}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditName(area.name)
                    onStopEdit()
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    className="size-3"
                    strokeWidth={2}
                  />
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="truncate text-left text-xs font-medium hover:underline"
                  onClick={onStartEdit}
                  title="Click to rename"
                >
                  {area.name}
                </button>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                  onClick={onStartEdit}
                >
                  <HugeiconsIcon
                    icon={PencilEdit01Icon}
                    className="size-3"
                    strokeWidth={2}
                  />
                </button>

                {/* Delete button — right-aligned */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </>
            )}
          </div>

          {/* Color swatches */}
          <div className="mt-1.5 flex gap-1">
            {AREA_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="size-3.5 rounded-full transition-transform hover:scale-125"
                style={{
                  backgroundColor: c,
                  outline: c === area.color ? '2px solid currentColor' : 'none',
                  outlineOffset: '1px',
                }}
                onClick={() => update(area.id, { color: c })}
              />
            ))}
          </div>

          {/* Metadata */}
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {vertexCount} vertices &middot; Created {createdDate}
          </p>
        </div>
      </div>

      {/* Delete confirmation */}
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
