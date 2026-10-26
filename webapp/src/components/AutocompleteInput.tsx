import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

interface AutocompleteInputProps<T> {
  label: string
  placeholder: string
  disabled?: boolean
  value: T | null
  onSelect: (item: T) => void
  onClear: () => void
  search: (query: string) => Promise<Array<T>>
  renderItem: (item: T) => React.ReactNode
  getItemLabel: (item: T) => string
}

export function AutocompleteInput<T>({
  label,
  placeholder,
  disabled,
  value,
  onSelect,
  onClear,
  search,
  renderItem,
  getItemLabel,
}: AutocompleteInputProps<T>) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<T>>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const debouncedQuery = useDebouncedValue(query, 200)

  useEffect(() => {
    if (debouncedQuery.length < 1) {
      setResults([])
      return
    }
    let cancelled = false
    setIsLoading(true)
    search(debouncedQuery).then((r) => {
      if (!cancelled) {
        setResults(r)
        setIsOpen(r.length > 0)
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, search])

  if (value) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-7 flex-1 flex items-center rounded-md border bg-card px-2 text-sm md:text-xs/relaxed truncate">
            {getItemLabel(value)}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClear()
              setQuery('')
            }}
          >
            Clear
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        className="mt-1"
        placeholder={placeholder}
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          if (e.target.value.length === 0) setIsOpen(false)
        }}
        onFocus={() => {
          if (results.length > 0) setIsOpen(true)
        }}
        onBlur={() => {
          setTimeout(() => setIsOpen(false), 200)
        }}
      />
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="max-h-60 overflow-auto py-1">
            {isLoading && results.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                Searching...
              </div>
            )}
            {results.map((item, i) => (
              <button
                key={i}
                type="button"
                className="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(item)
                  setIsOpen(false)
                  setQuery('')
                }}
              >
                {renderItem(item)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
