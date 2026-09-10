import Link from 'next/link'
import { ModeToggle } from './mode-toggle'
import { UploadSessionLauncher } from './upload-session-launcher'

const NAV_ITEMS = [
    { href: '/', label: 'Videos' },
    { href: '/results', label: 'Results' },
    { href: '/editor', label: 'Editor' },
    { href: '/concepts', label: 'Concepts' },
] as const

export function Header() {
    return (
        <header className="supports-backdrop-filter:bg-background/60 sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur">
            <div className="flex h-14 items-center justify-between px-6">
                <nav className="flex items-center space-x-6 text-sm font-medium">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="transition-colors hover:text-foreground/80 text-foreground"
                        >
                            {item.label}
                        </Link>
                    ))}
                </nav>
                <div className='flex items-center space-x-2'>
                    <UploadSessionLauncher />
                    <ModeToggle />
                </div>
            </div>
        </header>
    )
}
