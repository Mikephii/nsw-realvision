/**
 * Info icon + dialog for explaining a statistical method to the user.
 *
 * Renders a small ⓘ button. When clicked, opens a dialog with the method's
 * plain-English explainer content (title, summary, benefits, parameters,
 * caveats). Content is sourced from the {@link METHOD_EXPLAINERS} registry.
 *
 * Usage:
 * ```tsx
 * <MethodExplainer methodId="loess" />
 * ```
 */

import { HugeiconsIcon } from '@hugeicons/react'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import {  getMethodExplainer } from '../content/method-explainers'
import type {MethodId} from '../content/method-explainers';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface MethodExplainerProps {
  /** Which method's explainer to show. */
  methodId: MethodId
  /** Optional className for the trigger button. */
  className?: string
}

export function MethodExplainer({ methodId, className }: MethodExplainerProps) {
  const [open, setOpen] = useState(false)
  const content = getMethodExplainer(methodId)

  if (!content) return null

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        onClick={() => setOpen(true)}
        aria-label={`Learn about ${content.title}`}
      >
        <HugeiconsIcon
          icon={InformationCircleIcon}
          className="h-3.5 w-3.5 text-muted-foreground"
          strokeWidth={2}
        />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{content.title}</DialogTitle>
            <DialogDescription>{content.summary}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium">Why it helps</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {content.benefits.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>

            {content.parameters && content.parameters.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium">Settings</p>
                <dl className="space-y-1">
                  {content.parameters.map((p) => (
                    <div key={p.name}>
                      <dt className="text-xs font-medium text-foreground">
                        {p.name}
                      </dt>
                      <dd className="text-xs text-muted-foreground">
                        {p.description}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-medium">Things to know</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {content.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
