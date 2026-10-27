"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Owners: "View a rep…" (SPEC §8.15). */
export function RepPicker({
  people,
  value,
  self,
}: {
  people: { value: string; label: string }[];
  value: string;
  self: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="mn-rep" className="text-xs font-medium text-muted-foreground">
        View a rep…
      </label>
      <select
        id="mn-rep"
        className="h-9 rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        value={value}
        onChange={(e) => {
          const q = new URLSearchParams(params.toString());
          q.delete("card");
          if (e.target.value === self) q.delete("rep");
          else q.set("rep", e.target.value);
          router.push(q.toString() ? `${pathname}?${q.toString()}` : pathname);
        }}
      >
        {people.map((p) => (
          <option key={p.value} value={p.value}>
            {p.value === self ? `${p.label} (you)` : p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
