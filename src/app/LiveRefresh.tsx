"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-runs the enclosing server component on an interval, so the leaderboard
 * updates while a player has the tab open rather than only on manual reload.
 *
 * Pauses while the tab is hidden — there's no reason to hit the database for
 * a page nobody is looking at, and resuming on focus means a player coming
 * back to the tab always sees a fresh number immediately rather than waiting
 * out a stale interval.
 */
export function LiveRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const start = () => {
      if (timer.current) return;
      timer.current = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (!timer.current) return;
      clearInterval(timer.current);
      timer.current = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh(); // catch up immediately rather than wait out the interval
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
