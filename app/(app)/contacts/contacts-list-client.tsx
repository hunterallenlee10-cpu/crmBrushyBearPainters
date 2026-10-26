"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListShell, type ListShellProps } from "@/components/lists/list-shell";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { CONTACT_ROLE_LABELS, PREFERRED_CHANNEL_LABELS } from "@/lib/validation/accounts";
import { ConsentBadges, PrimaryBadge } from "../accounts/_components/badges";
import { ConsentDetails } from "./consent-details";
import { getContactPreview, type ContactPreview } from "./actions";

type Props = Omit<
  ListShellProps,
  "moduleId" | "noun" | "bulkActions" | "renderPreview" | "quickFilters"
>;

function Preview({ id }: { id: string }) {
  const [contact, setContact] = React.useState<ContactPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    setContact(null);
    setError(null);
    void getContactPreview({ id }).then((r) => {
      if (!alive) return;
      if (r.ok) setContact(r.data);
      else setError(r.error.message);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!contact)
    return (
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading contact" />
    );

  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="min-w-0 break-words">{value}</dd>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{CONTACT_ROLE_LABELS[contact.role]}</span>
        {contact.isPrimary && <PrimaryBadge />}
        <ConsentBadges
          smsOptIn={contact.smsOptIn}
          emailOptIn={contact.emailOptIn}
          doNotContact={contact.doNotContact}
          optedOut={contact.optedOutAt !== null}
        />
      </div>
      <dl className="divide-y">
        {row(
          "Account",
          contact.accountName && (
            <Link
              href={`/accounts/${contact.accountId}`}
              className="text-bb-forest hover:underline"
            >
              {contact.accountName}
            </Link>
          ),
        )}
        {row("Mobile", contact.mobile && formatPhone(contact.mobile))}
        {row("Phone", contact.phone && formatPhone(contact.phone))}
        {row("Email", contact.email)}
        {row(
          "Prefers",
          contact.preferredChannel && PREFERRED_CHANNEL_LABELS[contact.preferredChannel],
        )}
      </dl>
      <ConsentDetails
        smsOptIn={contact.smsOptIn}
        smsOptInAt={contact.smsOptInAt}
        smsOptInSource={contact.smsOptInSource}
        emailOptIn={contact.emailOptIn}
        emailOptInAt={contact.emailOptInAt}
        emailOptInSource={contact.emailOptInSource}
        optedOutAt={contact.optedOutAt}
        doNotContact={contact.doNotContact}
      />
      <Button asChild>
        <Link href={`/contacts/${contact.id}`}>Open contact</Link>
      </Button>
    </div>
  );
}

export function ContactsListClient(props: Props) {
  return (
    <ListShell
      {...props}
      moduleId="contacts"
      noun="contact"
      renderPreview={(id) => <Preview id={id} />}
    />
  );
}
