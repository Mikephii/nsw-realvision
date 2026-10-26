import { Link, createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <span className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Logo className="h-7 w-7" />
            NSW RealVision
          </span>
          <Button asChild>
            <Link to="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center">
        <div className="container mx-auto px-4 py-24 text-center max-w-3xl">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
            NSW Property Sales
            <br />
            <span className="text-primary">Analytics</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            Explore growth rates, compare suburbs, and analyse price trends
            across New South Wales using data from the NSW Valuer General.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Button size="lg" asChild>
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <a
                href="https://www.valuergeneral.nsw.gov.au"
                target="_blank"
                rel="noopener noreferrer"
              >
                Data Source
              </a>
            </Button>
          </div>
        </div>
      </main>

      <footer className="border-t py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>
            Sales data © Crown in right of New South Wales through the Valuer
            General NSW, licensed under{' '}
            <a
              href="https://creativecommons.org/licenses/by/3.0/au/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline"
            >
              CC BY 3.0 AU
            </a>
            . Addresses geocoded with G-NAF © Geoscape Australia, licensed by the
            Commonwealth of Australia under the Open G-NAF End User Licence
            Agreement.
          </p>
          <p className="mt-2">
            Open source on{' '}
            <a
              href="https://github.com/Mikephii/nsw-realvision"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline"
            >
              GitHub
            </a>
            . Not affiliated with the Valuer General NSW. Not financial or
            valuation advice.
          </p>
        </div>
      </footer>
    </div>
  )
}
