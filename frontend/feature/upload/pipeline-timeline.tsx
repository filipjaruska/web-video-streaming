"use client";

import { Check, X } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { PIPELINE_PHASES, phaseStates, stepIndex, type PhaseState } from "@/lib/pipelineSteps";
import { cn } from "@/lib/utils";
import type { UploadSessionState } from "@/lib/videoApi";

function Marker({ state }: { state: PhaseState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative z-10 grid size-5 shrink-0 place-items-center rounded-full border-2 bg-background transition-colors duration-500",
        state === "done" && "border-primary bg-primary text-primary-foreground",
        state === "current" && "border-primary",
        state === "failed" && "border-destructive bg-destructive text-white",
        state === "pending" && "border-border",
      )}
    >
      {state === "done" && <Check className="size-3" strokeWidth={3} />}
      {state === "failed" && <X className="size-3" strokeWidth={3} />}
      {state === "current" && <span className="size-2 animate-pulse rounded-full bg-primary" />}
    </span>
  );
}

/** The seven phases of processing, with the running step and its progress inside the current one. */
export function PipelineTimeline({ session }: { session: UploadSessionState }) {
  const states = phaseStates(session.status, session.currentStepKey);
  const current = stepIndex(session.currentStepKey);
  const { currentStepDone: done, currentStepTotal: total } = session;

  return (
    <ol className="relative space-y-0">
      {PIPELINE_PHASES.map((phase, index) => {
        const state = states[phase.id];
        const last = index === PIPELINE_PHASES.length - 1;
        return (
          <li key={phase.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-5 bottom-0 left-[9px] w-0.5 transition-colors duration-500",
                  state === "done" ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <Marker state={state} />
            <div className="min-w-0 flex-1 -translate-y-0.5">
              <div
                className={cn(
                  "text-sm",
                  state === "pending" ? "text-muted-foreground" : "font-medium",
                  state === "failed" && "text-destructive",
                )}
              >
                {phase.label}
              </div>
              {(state === "current" || state === "failed") && (
                <ul className="mt-2 space-y-1.5 animate-rise">
                  {phase.steps.map((step) => {
                    const position = stepIndex(step.key);
                    const running = position === current;
                    return (
                      <li
                        key={step.key}
                        className={cn(
                          "text-xs",
                          position !== current && "text-muted-foreground",
                          running && "font-medium text-foreground",
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span>{step.label}</span>
                          {running && total ? (
                            <span className="font-mono tabular text-muted-foreground">
                              {done ?? 0} of {total}
                            </span>
                          ) : null}
                        </div>
                        {running && total ? (
                          <Progress value={((done ?? 0) / total) * 100} className="mt-1 h-1" />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
