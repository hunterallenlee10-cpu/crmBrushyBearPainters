"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveDashboard } from "../../actions";

type CatalogItem = {
  id: string;
  label: string;
  kind: "kpi" | "chart";
  description: string;
  hiddenForYou: boolean;
};

export function DashboardForm({
  initial,
  catalog,
  readOnly,
}: {
  initial: { id?: string; name: string; description: string; widgets: string[]; shared: boolean };
  catalog: CatalogItem[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [description, setDescription] = React.useState(initial.description);
  const [shared, setShared] = React.useState(initial.shared);
  const [widgets, setWidgets] = React.useState<string[]>(initial.widgets);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const toggle = (id: string) =>
    setWidgets((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveDashboard({ id: initial.id, name, description, widgets, shared });
      if (!res.ok) {
        setError(
          res.error.fieldErrors
            ? (Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message)
            : res.error.message,
        );
        return;
      }
      toast.success("Dashboard saved.");
      router.push(`/analytics/dashboards/${res.data.id}`);
    });
  }

  const group = (kind: "kpi" | "chart", title: string) => (
    <fieldset className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {catalog
          .filter((c) => c.kind === kind)
          .map((c) => (
            <label
              key={c.id}
              className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm has-[:checked]:border-bb-forest has-[:checked]:bg-accent"
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-bb-forest"
                checked={widgets.includes(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span>
                <span className="block font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.hiddenForYou ? "Shows “—” for your role. " : ""}
                  {c.description}
                </span>
              </span>
            </label>
          ))}
      </div>
    </fieldset>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset disabled={readOnly || pending} className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="dash-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="dash-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              className="size-4 accent-bb-forest"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />
            Share with everyone who uses Analytics
          </label>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="dash-desc" className="text-sm font-medium">
              Description (optional)
            </label>
            <Textarea
              id="dash-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>
        {group("kpi", "KPI tiles")}
        {group("chart", "Charts")}
      </fieldset>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="cta"
          disabled={readOnly || pending || widgets.length === 0 || !name.trim()}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Save dashboard ({widgets.length})
        </Button>
      </div>
    </form>
  );
}
