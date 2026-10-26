import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";
import { type DocuSignConfig, DocuSignProvider } from "@/lib/integrations/esign/docusign";
import { type DropboxSignConfig, DropboxSignProvider } from "@/lib/integrations/esign/dropbox-sign";
import { createBuiltinESignProvider } from "@/lib/integrations/esign/outbox";
import { type ESignProvider } from "@/lib/integrations/esign/types";

export * from "@/lib/integrations/esign/types";
export { createBuiltinESignProvider } from "@/lib/integrations/esign/outbox";
export { DocuSignProvider, type DocuSignConfig } from "@/lib/integrations/esign/docusign";
export { DropboxSignProvider, type DropboxSignConfig } from "@/lib/integrations/esign/dropbox-sign";

export type ESignCredentials = { docusign?: DocuSignConfig; dropbox_sign?: DropboxSignConfig };
export type ESignProviderOptions = ProviderFactoryOptions<ESignCredentials>;

/** E-sign provider for the org. Built-in (BearSign) unless the gate allows DocuSign/Dropbox Sign. */
export function getESignProvider(
  ctx: IntegrationContext,
  options: ESignProviderOptions = {},
): ESignProvider {
  const choice = resolveDomainProvider("esign", options);
  if (!choice.real) return createBuiltinESignProvider(ctx);
  switch (choice.provider) {
    case "docusign":
      return new DocuSignProvider(
        requireRealDeps("docusign", options.fetch, options.credentials?.docusign),
      );
    case "dropbox_sign":
      return new DropboxSignProvider(
        requireRealDeps("dropbox_sign", options.fetch, options.credentials?.dropbox_sign),
      );
    default:
      throw new Error(`No e-sign adapter for "${choice.provider}".`);
  }
}
