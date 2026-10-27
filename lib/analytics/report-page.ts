import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { Viewer } from "@/lib/auth/viewer";
import { fromBase64Url, toBase64Url } from "@/lib/lists/filters";
import {
  reportConfigSchema,
  validateReportConfig,
  type ReportConfig,
} from "@/lib/domain/reports/config";
import {
  REPORT_MODULES,
  isReportModuleId,
  type ReportModule,
  type ReportModuleId,
} from "@/lib/domain/reports/modules";
import { templateByKey } from "@/lib/domain/reports/templates";
import { configFor, parseConfig } from "@/lib/analytics/reports";

/**
 * Resolves what a report page (or its CSV) runs: a saved report or template
 * by id, or a new report ("new"), optionally with a draft config from the
 * builder in `?c=` (base64url JSON). Money and cost columns the viewer may
 * not see are dropped before anything is queried.
 */

type Db = SupabaseClient<Database>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedReport = {
  id: string | null;
  name: string;
  description: string;
  module: ReportModule;
  config: ReportConfig;
  /** The saved config (before a draft), for "reset". */
  savedConfig: ReportConfig | null;
  isTemplate: boolean;
  templateKey: string | null;
  mine: boolean;
  shared: boolean;
  draft: boolean;
  problems: string[];
};

export function encodeConfig(c: ReportConfig): string {
  return toBase64Url(JSON.stringify(c));
}

function decodeConfig(raw: string | undefined | null): ReportConfig | null {
  if (!raw) return null;
  try {
    return parseConfig(JSON.parse(fromBase64Url(raw)));
  } catch {
    return null;
  }
}

export function defaultConfig(mod: ReportModule): ReportConfig {
  return reportConfigSchema.parse({
    columns: [...mod.defaultColumns],
    filter: { match: "all", rules: [] },
  });
}

export async function resolveReport(
  db: Db,
  viewer: Viewer,
  id: string,
  sp: Record<string, string | string[] | undefined>,
): Promise<ResolvedReport | null> {
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const draft = decodeConfig(one("c"));
  let base: Omit<ResolvedReport, "config" | "draft" | "problems" | "savedConfig"> & {
    saved: ReportConfig | null;
  };
  if (id === "new") {
    const m = one("module");
    const moduleId: ReportModuleId = isReportModuleId(m) ? m : "jobs";
    const mod = REPORT_MODULES[moduleId];
    base = {
      id: null,
      name: "New report",
      description: "",
      module: mod,
      isTemplate: false,
      templateKey: null,
      mine: true,
      shared: false,
      saved: null,
    };
  } else {
    if (!UUID.test(id)) return null;
    const { data } = await db
      .from("reports")
      .select("id, name, description, module, config, is_template, template_key, owner_id, shared")
      .eq("id", id)
      .maybeSingle();
    if (!data || !isReportModuleId(data.module)) return null;
    const t = data.template_key ? templateByKey(data.template_key) : undefined;
    if (t?.requires && !t.requires.every((p) => viewer.can(p))) return null;
    base = {
      id: data.id,
      name: data.name,
      description: data.description ?? "",
      module: REPORT_MODULES[data.module],
      isTemplate: data.is_template,
      templateKey: data.template_key,
      mine: data.owner_id === viewer.id,
      shared: data.shared,
      saved: parseConfig(data.config),
    };
  }
  if (!viewer.can(base.module.requires)) return null;
  const raw = draft ?? base.saved ?? defaultConfig(base.module);
  const problems = validateReportConfig(base.module, raw).map((p) => p.message);
  const config = configFor(base.module, problems.length ? defaultConfig(base.module) : raw, (p) =>
    viewer.can(p),
  );
  const { saved, ...rest } = base;
  return { ...rest, savedConfig: saved, config, draft: draft !== null, problems };
}
