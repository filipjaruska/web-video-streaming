"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isActionAuthRequired, verifyActionPassword } from "@/lib/actionAuth";

const STORAGE_KEY = "action-auth-unlocked";

type ActionAuthContextValue = {
  /** Prompt for password if needed. Resolves true when allowed to proceed. */
  requireAuth: () => Promise<boolean>;
};

const ActionAuthContext = createContext<ActionAuthContextValue | null>(null);

export function useActionAuth(): ActionAuthContextValue {
  const ctx = useContext(ActionAuthContext);
  if (!ctx) {
    throw new Error("useActionAuth must be used within ActionAuthProvider");
  }
  return ctx;
}

type PendingRequest = {
  resolve: (allowed: boolean) => void;
};

export function ActionAuthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        if (sessionStorage.getItem(STORAGE_KEY) === "1") {
          if (!cancelled) {
            setUnlocked(true);
            setAuthRequired(true);
          }
          return;
        }

        const required = await isActionAuthRequired();
        if (cancelled) {
          return;
        }

        setAuthRequired(required);
        if (!required) {
          setUnlocked(true);
        }
      } catch {
        if (!cancelled) {
          setAuthRequired(true);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const settle = useCallback((allowed: boolean) => {
    pendingRef.current?.resolve(allowed);
    pendingRef.current = null;
    setOpen(false);
    setPassword("");
    setError(null);
    setIsSubmitting(false);
  }, []);

  const requireAuth = useCallback(async () => {
    if (unlocked || authRequired === false) {
      return true;
    }

    if (authRequired === null) {
      const required = await isActionAuthRequired();
      setAuthRequired(required);
      if (!required) {
        setUnlocked(true);
        return true;
      }
    }

    if (sessionStorage.getItem(STORAGE_KEY) === "1") {
      setUnlocked(true);
      return true;
    }

    return new Promise<boolean>((resolve) => {
      pendingRef.current = { resolve };
      setPassword("");
      setError(null);
      setOpen(true);
      queueMicrotask(() => inputRef.current?.focus());
    });
  }, [authRequired, unlocked]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const result = await verifyActionPassword(password);
      if (!result.ok) {
        setError("Incorrect password");
        setIsSubmitting(false);
        return;
      }

      sessionStorage.setItem(STORAGE_KEY, "1");
      setUnlocked(true);
      settle(true);
    } catch {
      setError("Could not verify password. Try again.");
      setIsSubmitting(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      settle(false);
      return;
    }
    setOpen(true);
  }

  return (
    <ActionAuthContext.Provider value={{ requireAuth }}>
      {children}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent showCloseButton={false}>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Password required</DialogTitle>
              <DialogDescription>
                Enter the site password to continue with this action.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="action-password">Password</Label>
              <Input
                ref={inputRef}
                id="action-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={error ? true : undefined}
                disabled={isSubmitting}
              />
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => settle(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !password}>
                {isSubmitting ? "Checking..." : "Continue"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ActionAuthContext.Provider>
  );
}
