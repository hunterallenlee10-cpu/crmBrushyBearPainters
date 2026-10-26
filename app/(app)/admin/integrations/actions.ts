"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import { TEST_SEND_DOMAINS, TEST_SMS_NUMBER } from "@/lib/admin/integration-format";
import { serverEnv } from "@/lib/env";
import { type IntegrationContext } from "@/lib/integrations/core";
import { getEmailProvider } from "@/lib/integrations/email";
import { createSupabaseOutboxSink } from "@/lib/integrations/outbox-sink";
import { getSmsProvider } from "@/lib/integrations/sms_voice";

const testSendSchema = z.object({ domain: z.enum(TEST_SEND_DOMAINS) });

/**
 * Records a test message through the domain's provider factory. Nothing is
 * connected and REAL_PROVIDERS_LOCKED is true, so the factory returns the outbox
 * provider; we also refuse anything else and never pass `fetch`, so a real
 * provider could not make a request even if the gate were wrong.
 */
export const sendSimulatedTest = defineAction({
  name: "integrations.test_send",
  schema: testSendSchema,
  permissions: ["integrations:manage"],
  handler: async ({ domain }, { supabase, viewer, service }) => {
    const connection = check(
      await supabase
        .from("integration_connections")
        .select("status")
        .eq("org_id", viewer.orgId)
        .eq("domain", domain)
        .maybeSingle(),
    );
    const ctx: IntegrationContext = {
      orgId: viewer.orgId,
      actorId: viewer.id,
      sink: createSupabaseOutboxSink(await service()),
    };
    const env = serverEnv();
    const options = { connectionStatus: connection?.status ?? null };
    const notOutbox = new ActionFailure({
      code: "forbidden",
      message: "Test sends only go to the outbox in this build.",
    });

    let outboxId: string | undefined;
    if (domain === "email") {
      const provider = getEmailProvider(ctx, {
        ...options,
        envProvider: env.INTEGRATION_EMAIL_PROVIDER,
      });
      if (provider.provider !== "outbox") throw notOutbox;
      const result = await provider.send({
        to: viewer.email,
        subject: "Test email from Brushy Bear CRM (simulated)",
        html: `<p>Hi ${escapeHtml(viewer.name)},</p><p>This is a test email from Admin → Integrations. It was recorded in the outbox and <strong>not sent</strong>.</p>`,
        text: "This is a test email from Admin → Integrations. It was recorded in the outbox and not sent.",
        messageType: "transactional",
      });
      outboxId = result.outboxId;
    } else {
      const provider = getSmsProvider(ctx, {
        ...options,
        envProvider: env.INTEGRATION_SMS_PROVIDER,
      });
      if (provider.provider !== "outbox") throw notOutbox;
      const result = await provider.send({
        to: TEST_SMS_NUMBER,
        body: "Test text from Brushy Bear CRM (Admin → Integrations). Recorded in the outbox, not sent.",
        messageType: "transactional",
      });
      outboxId = result.outboxId;
    }

    revalidatePath("/admin/integrations");
    return { outboxId: outboxId ?? null };
  },
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
