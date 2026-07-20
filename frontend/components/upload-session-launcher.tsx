"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getPublicApiUrl } from "@/lib/env";
import { createUploadSession } from "@/lib/videoApi";

export function UploadSessionLauncher() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function handleCreateSession() {
    try {
      setIsLoading(true);
      const session = await createUploadSession(getPublicApiUrl());
      router.push(session.redirectUrl);
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  }

  return (
    <Button type="button" onClick={handleCreateSession} disabled={isLoading}>
      {isLoading ? "Creating..." : "Upload"}
    </Button>
  );
}
