"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Where a section counts as current: just under the sticky header. */
const ACTIVE_OFFSET_PX = 120;

/**
 * The sticky list of a long page's sections, marking the one being read. The current section is
 * the last one whose top has scrolled past the header; at the very bottom it is the last section,
 * however short.
 */
export function SectionIndex({
  sections,
}: {
  sections: ReadonlyArray<{ id: string; title: string }>;
}) {
  const [active, setActive] = useState<string | undefined>(sections[0]?.id);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) {
        setActive(sections.at(-1)?.id);
        return;
      }
      let current = sections[0]?.id;
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= ACTIVE_OFFSET_PX) {
          current = section.id;
        }
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [sections]);

  return (
    <nav aria-label="Sections" className="hidden xl:block">
      <ol className="sticky top-20 space-y-1 border-l text-sm">
        {sections.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={current ? "location" : undefined}
                className={cn(
                  "-ml-px block border-l-2 py-1 pl-3 transition-colors",
                  current
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {section.title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
