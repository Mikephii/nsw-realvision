/**
 * Drawing control — UI overlay for terra-draw polygon drawing.
 *
 * Pure presentation component: renders a toggle button that
 * switches between "Draw Area" and "Cancel Drawing" states.
 * All terra-draw lifecycle management is handled by the
 * {@link useTerraDraw} hook in the parent component.
 */

import { Button } from '@/components/ui/button'

interface Props {
  isDrawing: boolean
  onToggle: () => void
}

export function DrawingControl({ isDrawing, onToggle }: Props) {
  return (
    <div className="absolute left-2 top-2 z-10">
      <Button
        variant={isDrawing ? 'destructive' : 'secondary'}
        size="sm"
        className="shadow-md"
        onClick={onToggle}
      >
        {isDrawing ? 'Cancel Drawing' : 'Draw Area'}
      </Button>
    </div>
  )
}
