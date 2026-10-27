import {
  CalendarCheck,
  CircleDot,
  CirclePause,
  FileText,
  Globe,
  ImageIcon,
  Mail,
  MessageSquareText,
  PhoneCall,
  Route,
  Sparkles,
  UserRoundCog,
  Users,
  Voicemail,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { formatDuration } from "@/lib/domain/leads/speed-to-lead";
import { cn } from "@/lib/utils";
import type { FeedEvent, FeedMessage } from "./feed-utils";

/**
 * Feed rows that read the same in Messages and the Activity Log. No hooks, so
 * both server and client components can render them.
 */

export function FromLeadBadge() {
  return (
    <Badge variant="neutral" title="History from the lead this job was converted from">
      From the lead
    </Badge>
  );
}

const EVENT_ICONS: { prefix: string; icon: React.ElementType }[] = [
  { prefix: "lead_created", icon: Sparkles },
  { prefix: "job_created", icon: Sparkles },
  { prefix: "converted", icon: Sparkles },
  { prefix: "stage_changed", icon: Route },
  { prefix: "status_changed", icon: CircleDot },
  { prefix: "owner_changed", icon: UserRoundCog },
  { prefix: "poc_changed", icon: UserRoundCog },
  { prefix: "pm_changed", icon: UserRoundCog },
  { prefix: "team_", icon: Users },
  { prefix: "hold_", icon: CirclePause },
  { prefix: "appointment_", icon: CalendarCheck },
  { prefix: "walkthrough_", icon: CalendarCheck },
  { prefix: "first_contact", icon: PhoneCall },
  { prefix: "document_", icon: FileText },
  { prefix: "photo_", icon: ImageIcon },
];

function eventIcon(type: string): React.ElementType {
  return EVENT_ICONS.find((e) => type.startsWith(e.prefix))?.icon ?? CircleDot;
}

export function EventEntry({ item }: { item: FeedEvent }) {
  const Icon = eventIcon(item.type);
  return (
    <div className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 pt-1 text-sm">
        <p className="break-words">{item.summary}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            <time dateTime={item.at}>{formatDateTime(item.at)}</time>
            {item.authorName ? ` · ${item.authorName}` : " · System"}
          </span>
          {item.fromLead && <FromLeadBadge />}
        </p>
      </div>
    </div>
  );
}

const CHANNEL_ICONS: Record<FeedMessage["channel"], React.ElementType> = {
  sms: MessageSquareText,
  email: Mail,
  call: PhoneCall,
  voicemail: Voicemail,
  portal: Globe,
};

export function messageTitle(m: FeedMessage): string {
  const to = m.to ? (m.channel === "email" ? m.to : formatPhone(m.to)) : null;
  const inbound = m.direction === "inbound";
  switch (m.channel) {
    case "sms":
      return inbound ? "Text received" : `Text${to ? ` to ${to}` : ""}`;
    case "email":
      return inbound ? "Email received" : `Email${to ? ` to ${to}` : ""}`;
    case "call":
      return inbound ? "Incoming call logged" : `Call logged${to ? ` · ${to}` : ""}`;
    case "voicemail":
      return "Voicemail";
    case "portal":
      return inbound ? "Portal message received" : "Portal message";
  }
}

export function MessageEntry({
  item,
  outcomeLabels,
}: {
  item: FeedMessage;
  outcomeLabels: Record<string, string>;
}) {
  const Icon = CHANNEL_ICONS[item.channel] ?? MessageSquareText;
  return (
    <div className="flex gap-3">
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          item.direction === "inbound" ? "bg-info-bg text-info" : "bg-bb-forest text-white",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 rounded-xl border bg-background p-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium break-words">{messageTitle(item)}</span>
          {item.status === "simulated" && <Badge variant="sample">Simulated – not sent</Badge>}
          {item.status === "failed" && <Badge variant="danger">Failed</Badge>}
          {item.fromLead && <FromLeadBadge />}
          {item.automatic && <Badge variant="neutral">Workflow</Badge>}
        </div>
        {item.channel === "call" && (
          <p className="mt-1 text-muted-foreground">
            Outcome:{" "}
            {item.callOutcome ? (outcomeLabels[item.callOutcome] ?? item.callOutcome) : "—"}
            {item.callDurationSeconds ? ` · ${formatDuration(item.callDurationSeconds)}` : ""}
          </p>
        )}
        {item.subject && <p className="mt-1 font-medium break-words">{item.subject}</p>}
        {item.body && <p className="mt-1 break-words whitespace-pre-wrap">{item.body}</p>}
        <p className="mt-1.5 text-xs text-muted-foreground">
          <time dateTime={item.at}>{formatDateTime(item.at)}</time>
          {item.authorName ? ` · ${item.authorName}` : ""}
        </p>
      </div>
    </div>
  );
}
