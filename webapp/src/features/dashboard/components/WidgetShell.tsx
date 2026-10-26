/**
 * Chrome wrapper for each widget in the dashboard grid.
 * Provides drag handle, settings button, and remove button.
 */

import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Delete02Icon,
  DragDropIcon,
  Settings02Icon,
} from '@hugeicons/core-free-icons'
import { getWidgetDefinition } from '../widgets/registry'
import { useWidgetStore } from '../stores/widget-store'
import { WidgetSettingsSheet } from './WidgetSettingsSheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface Props {
  widgetId: string
  type: string
  children: React.ReactNode
}

export function WidgetShell({ widgetId, type, children }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const removeWidget = useWidgetStore((s) => s.removeWidget)
  const config = useWidgetStore((s) => s.widgets[widgetId]?.config)
  const def = getWidgetDefinition(type)
  const tags = def?.getTags?.(config)

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="border-b py-1.5">
        <CardTitle className="widget-drag-handle flex cursor-grab items-center gap-1.5">
          <HugeiconsIcon
            icon={DragDropIcon}
            className="h-3.5 w-3.5 text-muted-foreground"
            strokeWidth={2}
          />
          {def?.label ?? type}
          {tags?.map((tag) => (
            <Badge
              key={tag.label}
              variant={tag.variant ?? 'secondary'}
              className="h-4 px-1.5 text-[0.5625rem]"
            >
              {tag.label}
            </Badge>
          ))}
        </CardTitle>
        <CardAction className="flex gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setSettingsOpen(true)}
          >
            <HugeiconsIcon
              icon={Settings02Icon}
              className="h-3.5 w-3.5"
              strokeWidth={2}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:text-destructive"
            onClick={() => removeWidget(widgetId)}
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              className="h-3.5 w-3.5"
              strokeWidth={2}
            />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-1 pt-0">
        {children}
      </CardContent>
      <WidgetSettingsSheet
        widgetId={widgetId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </Card>
  )
}
