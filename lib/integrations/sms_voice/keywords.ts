import { type InboundKeyword } from "@/lib/integrations/sms_voice/types";

/**
 * Inbound keyword handler stub (SPEC §13.2). Carriers treat a message that is
 * just the keyword (case-insensitive, surrounding whitespace/punctuation
 * ignored) as the instruction. REVOKE and OPTOUT are included as opt-outs
 * because honouring more opt-out words is the safe side of compliance.
 */
const OPT_OUT = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
]);
const OPT_IN = new Set(["START", "UNSTOP"]);
const HELP = new Set(["HELP", "INFO"]);

function normalise(text: string): string {
  return text
    .trim()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .toUpperCase();
}

export function classifyInboundKeyword(text: string): InboundKeyword | null {
  const word = normalise(text);
  if (OPT_OUT.has(word)) return "opt_out";
  if (OPT_IN.has(word)) return "opt_in";
  if (HELP.has(word)) return "help";
  return null;
}

export function isOptOutKeyword(text: string): boolean {
  return classifyInboundKeyword(text) === "opt_out";
}

export function isOptInKeyword(text: string): boolean {
  return classifyInboundKeyword(text) === "opt_in";
}
