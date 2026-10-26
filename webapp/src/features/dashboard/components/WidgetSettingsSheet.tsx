/**
 * Sheet (slide-over panel) that renders a widget's settings panel.
 * Looks up the widget definition from the registry and renders its settingsPanel component.
 */

import { useCallback } from 'react'
import { useWidgetStore } from '../stores/widget-store'
import { getWidgetDefinition } from '../widgets/registry'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface Props {
  widgetId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WidgetSettingsSheet({ widgetId, open, onOpenChange }: Props) {
  const widget = useWidgetStore((s) => s.widgets[widgetId])
  const updateConfig = useWidgetStore((s) => s.updateWidgetConfig)

  const handleConfigChange = useCallback(
    (newConfig: unknown) => updateConfig(widgetId, newConfig),
    [widgetId, updateConfig],
  )

  if (!widget) return null
  const def = getWidgetDefinition(widget.type)
  if (!def) return null

  const SettingsPanel = def.settingsPanel

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{def.label} Settings</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6">
          <SettingsPanel config={widget.config} onChange={handleConfigChange} />
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
