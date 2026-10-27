"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunAction } from "@/components/forms/use-run-action";
import { markThread } from "@/app/(app)/messages/actions";
import { formatDateTime } from "@/lib/format/dates";

/**
 * "The customer wrote and nobody has read it yet" on a lead's or job's
 * Messages (SPEC §5.7). Marking it read clears the Attention item.
 */
export function ThreadReadBanner({
  threadId,
  unread,
  canMark,
  lastInboundAt,
}: {
  threadId: string;
  unread: boolean;
  canMark: boolean;
  lastInboundAt: string | null;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  if (!unread) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-bb-honey bg-bb-honey/10 p-3 text-sm"
    >
      <MailOpen className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">
        Unread reply from the customer
        {lastInboundAt ? (
          <>
            {" "}
            (<time dateTime={lastInboundAt}>{formatDateTime(lastInboundAt)}</time>)
          </>
        ) : null}
        .
      </span>
      <Link href={`/messages?t=${threadId}`} className="text-bb-forest underline">
        Open in Messages
      </Link>
      {canMark && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => markThread({ threadId, read: true }), { onOk: () => router.refresh() })
          }
        >
          Mark read
        </Button>
      )}
    </div>
  );
}
