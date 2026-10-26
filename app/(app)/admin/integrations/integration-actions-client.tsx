"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Loader2, Lock, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CONNECT_LOCKED_REASON, type TestSendDomain } from "@/lib/admin/integration-format";
import { sendSimulatedTest } from "./actions";

export type ConfigureProps = {
  domainKey: string;
  name: string;
  purpose: string;
  providerInUse: string;
  realProviders: readonly string[];
  setupSteps: readonly string[];
  envVars: readonly string[];
};

/** "Configure" → setup checklist, env vars and a Connect button that stays off in this build. */
export function ConfigureSheet(props: ConfigureProps) {
  const reasonId = `connect-locked-${props.domainKey}`;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Configure ${props.name}`}>
          <ListChecks aria-hidden /> Configure
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-10">
          <SheetTitle>Set up {props.name}</SheetTitle>
          <SheetDescription>{props.purpose}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">In use now</dt>
            <dd>{props.providerInUse}</dd>
            <dt className="text-muted-foreground">Can connect to</dt>
            <dd>{props.realProviders.join(", ")}</dd>
          </dl>
          <section aria-labelledby={`steps-${props.domainKey}`}>
            <h3 id={`steps-${props.domainKey}`} className="mb-2 text-sm font-semibold">
              Setup checklist
            </h3>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm marker:text-muted-foreground">
              {props.setupSteps.map((step) => (
                <li key={step} className="pl-1">
                  {step}
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby={`env-${props.domainKey}`}>
            <h3 id={`env-${props.domainKey}`} className="mb-1 text-sm font-semibold">
              Environment variables
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Set these in the hosting provider, never in the code. Every key is listed (commented
              out) in .env.example.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {props.envVars.map((v) => (
                <li key={v}>
                  <code className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {v}
                  </code>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <SheetFooter className="border-t">
          <Button disabled aria-describedby={reasonId} className="w-full sm:w-auto sm:self-start">
            <Lock aria-hidden /> Connect
          </Button>
          <p id={reasonId} className="text-xs text-muted-foreground">
            {CONNECT_LOCKED_REASON}
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const SUCCESS: Record<TestSendDomain, string> = {
  email: "Test email recorded in the outbox. Nothing was sent.",
  sms_voice: "Test text recorded in the outbox. Nothing was sent.",
};

/** Records a simulated test message for Email or SMS, then refreshes the outbox list. */
export function TestSendButton({ domain, name }: { domain: TestSendDomain; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await sendSimulatedTest({ domain });
      if (result.ok) {
        toast.success(SUCCESS[domain]);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={pending}
      aria-label={`Send a test (simulated) for ${name}`}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
      Send a test (simulated)
    </Button>
  );
}
