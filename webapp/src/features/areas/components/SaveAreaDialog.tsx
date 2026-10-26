/**
 * Save area dialog — prompts for a name after the user finishes drawing a polygon.
 *
 * Shown as a modal dialog with a text input for the area name.
 * On save, the parent creates the area in the store with the provided
 * name and the pending polygon geometry.
 */

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** The polygon geometry to save, or `null` when the dialog is closed. */
  polygon: GeoJSON.Polygon | null
  /** Called with the user-provided area name when they click Save. */
  onSave: (name: string) => void
  /** Called when the user cancels (closes dialog or clicks Cancel). */
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SaveAreaDialog({ polygon, onSave, onCancel }: Props) {
  const [name, setName] = useState('')

  // Reset name each time the dialog opens with a new polygon
  useEffect(() => {
    if (polygon) setName('')
  }, [polygon])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onSave(trimmed)
  }

  return (
    <Dialog open={!!polygon} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save Area</DialogTitle>
          <DialogDescription>
            Give this area a name to use it as a geographic filter.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="area-name">Area name</Label>
            <Input
              id="area-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Inner West, Northern Beaches"
              autoFocus
            />
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
