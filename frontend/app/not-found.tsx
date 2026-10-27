import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageShell
      title="Page not found"
      description="Nothing lives at this address. If it was a video, it may have been deleted."
    >
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/">All videos</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/results">Results</Link>
        </Button>
      </div>
    </PageShell>
  );
}
