import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock, DollarSign, FileText, Inbox, Percent, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi/kpi-card";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { StageBadge } from "@/components/layout/stage-badge";
import { CrewTabBar } from "@/components/shell/crew-tab-bar";
import { Logo } from "@/components/shell/logo";
import { AA_TEXT, contrastRatio } from "@/lib/design/contrast";
import { brand, brandCssVar, status, surface } from "@/lib/design/tokens";
import { JOB_STAGES } from "@/lib/domain/stages";

export const metadata: Metadata = { title: "Design system" };

/** Design-system reference (SPEC §16). Hidden in production. */
export default function DevUiPage() {
  if (process.env.VERCEL_ENV === "production") notFound();

  return (
    <div className="min-h-dvh bg-background">
      <PageContainer className="flex flex-col gap-10">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          <Badge variant="neutral">Dev only</Badge>
        </div>
        <PageHeader
          title="Design system"
          description="Brand tokens, semantic colors, stage legend and shared components. Contrast ratios are computed live."
        />

        <Section title="Brand colors">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(Object.keys(brand) as (keyof typeof brand)[]).map((key) => (
              <Swatch key={key} name={brandCssVar[key]} hex={brand[key]} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Honey is an accent and CTA background only. Text on honey is always ink (
            {contrastRatio(brand.ink, brand.honey).toFixed(1)}:1). Honey text on white would be{" "}
            {contrastRatio(brand.honey, "#FFFFFF").toFixed(1)}:1, which fails AA, so it is never
            used.
          </p>
        </Section>

        <Section title="Status colors">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(status) as (keyof typeof status)[]).map((tone) => (
              <Badge key={tone} variant={tone} className="capitalize">
                {tone} · {contrastRatio(status[tone].fg, status[tone].bg).toFixed(1)}:1
              </Badge>
            ))}
            <Badge variant="sample">Sample – Erik to calibrate</Badge>
          </div>
        </Section>

        <Section title="Job stages">
          <div className="flex flex-wrap gap-2">
            {JOB_STAGES.map((s) => (
              <StageBadge key={s.id} stage={s.id} />
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <p className="font-display text-4xl text-bb-forest">Lilita One — brand headings only</p>
          <p className="text-2xl font-bold">Manrope Bold — page titles</p>
          <p className="text-base">Manrope Regular — body text for dense, readable screens.</p>
          <p className="text-sm text-muted-foreground">
            Muted text · {contrastRatio(surface.mutedForeground, surface.card).toFixed(1)}:1 on
            white
          </p>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Primary</Button>
            <Button variant="cta">Send estimate</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="brand-surface flex flex-wrap items-center gap-3 rounded-2xl p-4">
            <Button variant="brand">Accept &amp; Sign</Button>
            <Button variant="brand" size="touch">
              Get my estimate
            </Button>
            <span className="text-xs text-bb-ink/80">Brand pill: customer-facing pages only.</span>
          </div>
        </Section>

        <Section title="KPI cards">
          <p className="text-xs text-muted-foreground">
            Example values for layout only. Real numbers come from the metrics registry (Phase 9).
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Open Pipeline Value"
              value="$236,400"
              caption="38 open estimates × $6.2k avg · rolling 90d"
              icon={DollarSign}
            />
            <KpiCard
              label="Speed to Lead"
              value="6 min"
              caption="Median, business hours · this month"
              icon={Clock}
              tone="info"
            />
            <KpiCard
              label="24h Estimate SLA"
              value="92%"
              caption="23 of 25 sent within 24h of walkthrough"
              icon={FileText}
              tone="success"
            />
            <KpiCard
              label="Gross Margin"
              value="38.5%"
              caption="Completed MTD · below 40% floor"
              icon={Percent}
              tone="warning"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <KpiCard
              label="Projected Revenue"
              value="$310K"
              caption="$310K MTD · 75% of month pace"
              icon={TrendingUp}
              tone="neutral"
            />
          </div>
        </Section>

        <Section title="Empty state">
          <EmptyState
            icon={Inbox}
            title="No tasks yet"
            action={<Button variant="brand">Add a follow-up</Button>}
          >
            Add a follow-up to stay on top of this lead.
          </EmptyState>
        </Section>

        <Section title="Crew tab bar (phones)">
          <div className="max-w-sm overflow-hidden rounded-2xl border">
            <CrewTabBar fixed={false} />
          </div>
        </Section>
      </PageContainer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  const onWhite = contrastRatio(hex, "#FFFFFF");
  const onInk = contrastRatio(hex, brand.ink);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="h-14 border-b" style={{ backgroundColor: hex }} />
      <div className="p-2 text-xs">
        <p className="font-mono font-semibold">{name}</p>
        <p className="font-mono text-muted-foreground">{hex}</p>
        <p className={onWhite >= AA_TEXT ? "text-success" : "text-muted-foreground"}>
          vs white {onWhite.toFixed(1)}:1
        </p>
        <p className={onInk >= AA_TEXT ? "text-success" : "text-muted-foreground"}>
          vs ink {onInk.toFixed(1)}:1
        </p>
      </div>
    </div>
  );
}
