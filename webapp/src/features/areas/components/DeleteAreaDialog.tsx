/**
 * Delete area confirmation dialog.
 *
 * Uses shadcn AlertDialog to prompt the user before permanently
 * deleting a custom area. Warns about downstream effects on
 * widget filters that reference the area.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** Whether the dialog is open. */
  open: boolean
  /** Callback to control dialog visibility. */
  onOpenChange: (open: boolean) => void
  /** Name of the area being deleted (shown in the confirmation message). */
  areaName: string
  /** Called when the user confirms deletion. */
  onConfirm: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeleteAreaDialog({
  open,
  onOpenChange,
  areaName,
  onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete area</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &ldquo;{areaName}&rdquo;? Any widget
            filters using this area will stop working.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
