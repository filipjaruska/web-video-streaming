import Link from 'next/link'
import { ModeToggle } from './mode-toggle'

export function Header() {
    return (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-14 items-center justify-between px-6">
                <nav className="flex items-center space-x-6 text-sm font-medium">
                    <Link
                        href="/"
                        className="transition-colors hover:text-foreground/80 text-foreground"
                    >
                        Videos
                    </Link>
                    <span className="text-muted-foreground cursor-not-allowed">
                        Statistics
                    </span>
                    <span className="text-muted-foreground cursor-not-allowed">
                        Editor
                    </span>
                </nav>
                <ModeToggle />
            </div>
        </header>
    )
}
