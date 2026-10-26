import { formatDateTime } from "@/lib/format/dates";

/** Consent with when and where it was given (SPEC §13.2). Server- and client-safe. */
export function ConsentDetails({
  smsOptIn,
  smsOptInAt,
  smsOptInSource,
  emailOptIn,
  emailOptInAt,
  emailOptInSource,
  optedOutAt,
  doNotContact,
}: {
  smsOptIn: boolean;
  smsOptInAt: string | null;
  smsOptInSource: string | null;
  emailOptIn: boolean;
  emailOptInAt: string | null;
  emailOptInSource: string | null;
  optedOutAt: string | null;
  doNotContact: boolean;
}) {
  const line = (on: boolean, at: string | null, source: string | null) =>
    on ? (
      <>
        <span className="font-medium text-success">Opted in</span>
        {at && <span> on {formatDateTime(at)}</span>}
        {source && <span className="block text-muted-foreground">Source: {source}</span>}
      </>
    ) : (
      <span className="text-muted-foreground">Not opted in</span>
    );

  return (
    <dl className="flex flex-col gap-2 text-sm" data-testid="consent-details">
      {doNotContact && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg p-2.5 text-danger">
          <dt className="font-semibold">Do not contact</dt>
          <dd>No marketing texts, emails or calls.</dd>
        </div>
      )}
      {optedOutAt && (
        <div className="rounded-lg border border-warning/30 bg-warning-bg p-2.5 text-warning">
          <dt className="font-semibold">Opted out</dt>
          <dd>Replied STOP on {formatDateTime(optedOutAt)}.</dd>
        </div>
      )}
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <dt className="text-muted-foreground">Texts</dt>
        <dd>{line(smsOptIn, smsOptInAt, smsOptInSource)}</dd>
      </div>
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <dt className="text-muted-foreground">Email</dt>
        <dd>{line(emailOptIn, emailOptInAt, emailOptInSource)}</dd>
      </div>
    </dl>
  );
}
