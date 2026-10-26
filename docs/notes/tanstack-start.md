# TanStack Start Skills

## Project Setup

- Create with: `pnpx @tanstack/cli create <name> --package-manager pnpm --no-examples --no-git`
- Package is `@tanstack/react-start` (not `@tanstack/start`)
- Source directory is `src/` (not `app/`)
- No `ssr.tsx` or `client.tsx` entry files needed
- Uses Vite directly (not Vinxi) since v1.121.0+

## Vite Config

Plugin order matters: `tanstackStart()` must come before `viteReact()`.

```ts
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    tanstackStart(),  // MUST be first
    viteReact(),
  ],
})
```

## File-Based Routing

Files in `src/routes/` are auto-discovered. Key conventions:

| Pattern | Route | URL |
|---------|-------|-----|
| `__root.tsx` | Root layout | Wraps everything |
| `index.tsx` | Index route | `/` |
| `about.tsx` | Static route | `/about` |
| `posts/$postId.tsx` | Dynamic param | `/posts/:postId` |
| `_layout/page.tsx` | Pathless layout | `/page` (layout wraps without URL segment) |
| `(group)/page.tsx` | Route group | `/page` (organizational only) |

## Route Definition

```ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/path')({
  component: MyComponent,
  loader: async () => { /* fetch data */ },
  head: () => ({
    meta: [{ title: 'Page Title' }],
  }),
})
```

## Root Route

Uses standard HTML elements with `<HeadContent />` and `<Scripts />`:

```tsx
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
```

## Navigation

Type-safe `Link` component:

```tsx
import { Link } from '@tanstack/react-router'

<Link to="/user/$id" params={{ id: '42' }}>User 42</Link>
```

## Server Functions (Builder Pattern)

**IMPORTANT:** The method is `inputValidator`, NOT `validator` (changed in v1.161+).

```ts
import { createServerFn } from '@tanstack/react-start'

// With input validation
const getData = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => { /* runs on server, data is typed */ })

// Without input (no inputValidator needed)
const getAll = createServerFn({ method: 'GET' })
  .handler(async () => { /* runs on server */ })

// Call from client: await getData({ data: { id: '42' } })
// Call from loader: const result = await getAll()
```

## `routeTree.gen.ts`

Auto-generated file. Never edit manually. Delete and restart dev server if routing breaks.

## Server Function Input Validation (Zod)

**CRITICAL:** GET server functions deserialize URL params as **strings**. A param like `resolution=7` arrives as `"7"` (string), not `7` (number). This silently breaks SQL queries when the DB expects an integer.

**Always use `z.coerce.number()`** for numeric params in GET server functions. Plain `z.number()` would reject the string and throw a validation error.

Schemas live in `webapp/src/lib/validation.ts`. Pattern:

```ts
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'

const MyInputSchema = z.object({
  name: z.string(),
  count: z.coerce.number(),          // coerces "7" → 7
  limit: z.coerce.number().optional(),
})

export const myServerFn = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => MyInputSchema.parse(data))
  .handler(async ({ data }) => {
    // data.count is now a proper number, safe for SQL binding
  })
```

**Why not identity pass-through?** The old pattern `(data: SomeType) => data` does zero validation or coercion — it just trusts the input blindly. This caused a production bug where heatmap queries returned 0 results because `"7" !== 7` in DuckDB parameterized queries.

## Gotchas

- `shellComponent` vs `component` on root route: use `component` for the root layout
- After mutations, manually invalidate router: `await router.invalidate({ sync: true })`
- CSS imports use `?url` suffix: `import appCss from '../styles.css?url'`
- **GET param deserialization:** All URL query params arrive as strings. Use `z.coerce.number()` for numeric params, `z.coerce.boolean()` for booleans. See "Server Function Input Validation" section above.
- **Import protection:** Server-only modules (`.server.ts`) must NOT be statically imported from files in the client import graph. In server functions, use dynamic `import()` inside handlers instead of top-level imports:
  ```ts
  // BAD - triggers import-protection warning
  import { getDb } from './db.server'
  export const getData = createServerFn({ method: 'GET' })
    .handler(async () => { const conn = await getDb(); ... })

  // GOOD - dynamic import inside handler
  export const getData = createServerFn({ method: 'GET' })
    .handler(async () => {
      const { getDb } = await import('./db.server')
      const conn = await getDb(); ...
    })
  ```
  Type-only imports (`import type { ... }`) are fine since they're erased at compile time.
