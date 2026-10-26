import { BellOff, Mail, MessageSquare, ShieldAlert, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  type AccountStatus,
  type AccountType,
} from "@/lib/validation/accounts";

/** Badges shared by the account and contact screens. */

const STATUS_VARIANT: Record<AccountStatus, "info" | "success" | "neutral" | "warning"> = {
  prospect: "info",
  active_customer: "success",
  past_customer: "warning",
  inactive: "neutral",
};

export function AccountStatusBadge({
  status,
  className,
}: {
  status: AccountStatus;
  className?: string;
}) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={cn("whitespace-nowrap", className)}>
      {ACCOUNT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function AccountTypeBadge({ type, className }: { type: AccountType; className?: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", className)}>
      {ACCOUNT_TYPE_LABELS[type]}
    </Badge>
  );
}

export function ReferralChampionBadge() {
  return (
    <Badge variant="sample" className="whitespace-nowrap">
      <Star aria-hidden />
      Referral champion
    </Badge>
  );
}

/** Built before 1978 (or not sure): lead-safe work practices apply (SPEC §13.3). */
export function LeadSafeBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="warning"
      className={cn("whitespace-nowrap", className)}
      title="Built before 1978, or the year isn't known. Lead-safe work practices apply."
    >
      <ShieldAlert aria-hidden />
      Lead-safe (pre-1978)
    </Badge>
  );
}

export function PrimaryBadge() {
  return (
    <Badge variant="success" className="whitespace-nowrap">
      Primary
    </Badge>
  );
}

/** Compact consent summary: Do Not Contact wins; then texts and email opt-ins. */
export function ConsentBadges({
  smsOptIn,
  emailOptIn,
  doNotContact,
  optedOut,
}: {
  smsOptIn: boolean;
  emailOptIn: boolean;
  doNotContact: boolean;
  optedOut?: boolean;
}) {
  if (doNotContact) {
    return (
      <Badge variant="danger" className="whitespace-nowrap">
        <BellOff aria-hidden />
        Do not contact
      </Badge>
    );
  }
  if (!smsOptIn && !emailOptIn) {
    return (
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {optedOut ? "Opted out" : "No marketing consent"}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {smsOptIn && (
        <Badge variant="success" className="whitespace-nowrap">
          <MessageSquare aria-hidden />
          Texts
        </Badge>
      )}
      {emailOptIn && (
        <Badge variant="info" className="whitespace-nowrap">
          <Mail aria-hidden />
          Email
        </Badge>
      )}
    </span>
  );
}
