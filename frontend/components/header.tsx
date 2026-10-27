import Link from "next/link";

import { Container } from "./page-shell";
import { HeaderNav, MobileNav } from "./header-nav";
import { ModeToggle } from "./mode-toggle";
import { UploadSessionLauncher } from "./upload-session-launcher";

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
      <Container className="flex h-14 items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="h-5 w-1.5 rounded-[1px] bg-primary" />
          <span>Video Streaming</span>
        </Link>
        <HeaderNav />
        <div className="ml-auto flex items-center gap-2">
          <UploadSessionLauncher />
          <ModeToggle />
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
