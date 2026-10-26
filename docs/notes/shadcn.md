# shadcn/ui Skills

## Setup for TanStack Start

shadcn auto-detects TanStack Start when running `init`:

```bash
pnpm dlx shadcn@latest init --defaults --base-color zinc
```

The `create` command with `--preset` only works with `--template next` for creating new projects. For existing TanStack Start projects, use `init` then manually apply theme CSS.

To extract a theme preset for non-Next.js projects:
1. Create a temp Next.js project with the preset
2. Copy `globals.css` theme variables and `components.json` into your project

## Adding Components

```bash
pnpm dlx shadcn@latest add button
pnpm dlx shadcn@latest add card
```

Components are installed to `src/components/ui/`.

## Our Theme Config

- Style: `radix-mira`
- Base color: zinc
- Theme: blue (primary = oklch blue)
- Icon library: hugeicons (`@hugeicons/react`)
- Font: Inter (`@fontsource-variable/inter`)
- `components.json` has `"rsc": false` for TanStack Start (no React Server Components)

## Import Aliases

```ts
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
```

These map to `./src/*` via tsconfig paths.

## Button with Link (asChild pattern)

```tsx
import { Button } from '@/components/ui/button'
import { Link } from '@tanstack/react-router'

<Button asChild>
  <Link to="/dashboard">Dashboard</Link>
</Button>
```
