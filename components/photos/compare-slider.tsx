"use client";

import * as React from "react";

/**
 * Before/after compare (SPEC §8.5 #6): the after photo sits on top of the
 * before photo and a range input (keyboard and touch friendly) reveals it.
 */
export function CompareSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = "Before",
  afterLabel = "After",
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const [pos, setPos] = React.useState(50);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed private URLs */}
        <img
          src={beforeUrl}
          alt={beforeLabel}
          className="absolute inset-0 size-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
          aria-hidden={pos >= 100}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed private URLs */}
          <img
            src={afterUrl}
            alt={afterLabel}
            className="absolute inset-0 size-full object-cover"
          />
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow"
          style={{ left: `${pos}%` }}
        />
        <span className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
          {beforeLabel}
        </span>
        <span className="absolute top-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
          {afterLabel}
        </span>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <span className="shrink-0 text-muted-foreground">Before</span>
        <input
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          className="h-11 w-full accent-[var(--bb-forest)]"
          aria-label="Compare before and after"
        />
        <span className="shrink-0 text-muted-foreground">After</span>
      </label>
    </div>
  );
}
