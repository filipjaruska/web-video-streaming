import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageShell
      title="Video not found"
      description="This video does not exist or may have been removed."
    >
      <Button asChild>
        <Link href="/">Back to videos</Link>
      </Button>
    </PageShell>
  );
}
