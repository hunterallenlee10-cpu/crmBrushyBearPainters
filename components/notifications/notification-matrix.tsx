"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useRunAction } from "@/components/forms/use-run-action";
import {
  saveCompanyNotifications,
  saveMyNotifications,
} from "@/app/(app)/settings/notification-actions";

export type MatrixRow = {
  type: string;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
  sms: boolean;
  locked: boolean;
};

/**
 * Per-event channel choices (in-app / email / text). With `company`, the
 * "Required" column sets whether people may turn the in-app alert off.
 */
export function NotificationMatrix({
  rows: initial,
  company = false,
  readOnly,
  note,
}: {
  rows: MatrixRow[];
  company?: boolean;
  readOnly: boolean;
  note?: React.ReactNode;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [rows, setRows] = React.useState(initial);
  const set = (type: string, patch: Partial<MatrixRow>) =>
    setRows((rs) => rs.map((r) => (r.type === type ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const disabled = pending || readOnly;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Notification channels per event</caption>
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Event
              </th>
              <th scope="col" className="w-20 px-2 py-2 text-center font-medium">
                In-app
              </th>
              <th scope="col" className="w-20 px-2 py-2 text-center font-medium">
                Email
              </th>
              <th scope="col" className="w-20 px-2 py-2 text-center font-medium">
                Text
              </th>
              {company && (
                <th scope="col" className="w-24 px-2 py-2 text-center font-medium">
                  Required
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type} className="border-b last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <span className="font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.description}</span>
                </th>
                <td className="px-2 py-2 text-center">
                  <Checkbox
                    checked={r.inApp || (!company && r.locked)}
                    disabled={disabled || (!company && r.locked)}
                    onCheckedChange={(c) => set(r.type, { inApp: c === true })}
                    aria-label={`${r.label}: in-app${!company && r.locked ? " (required by your company)" : ""}`}
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <Checkbox
                    checked={r.email}
                    disabled={disabled}
                    onCheckedChange={(c) => set(r.type, { email: c === true })}
                    aria-label={`${r.label}: email`}
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <Checkbox
                    checked={r.sms}
                    disabled={disabled}
                    onCheckedChange={(c) => set(r.type, { sms: c === true })}
                    aria-label={`${r.label}: text`}
                  />
                </td>
                {company && (
                  <td className="px-2 py-2 text-center">
                    <Checkbox
                      checked={r.locked}
                      disabled={disabled}
                      onCheckedChange={(c) =>
                        set(r.type, { locked: c === true, inApp: c === true ? true : r.inApp })
                      }
                      aria-label={`${r.label}: in-app required`}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
      <Button
        type="button"
        className="self-start"
        disabled={disabled || !dirty}
        onClick={() =>
          run(
            () =>
              company
                ? saveCompanyNotifications({
                    items: rows.map(({ type, inApp, email, sms, locked }) => ({
                      type,
                      inApp,
                      email,
                      sms,
                      locked,
                    })),
                  })
                : saveMyNotifications({
                    items: rows.map(({ type, inApp, email, sms }) => ({ type, inApp, email, sms })),
                  }),
            {
              success: "Notification settings saved.",
              onOk: () => router.refresh(),
            },
          )
        }
      >
        <Save className="size-4" aria-hidden /> Save
      </Button>
    </div>
  );
}
