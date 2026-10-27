/**
 * Node module hook for maintenance scripts (`pnpm seed:demo`): resolves the
 * app's "@/…" imports and extensionless relative imports to .ts files, so a
 * script can reuse the pure domain code in lib/domain with Node's built-in
 * TypeScript type stripping. Only for scripts; the app uses Next's bundler.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

function candidate(base) {
  for (const p of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const file = candidate(resolvePath(ROOT, specifier.slice(2)));
    if (file) return next(pathToFileURL(file).href, context);
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    const file = candidate(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
    if (file) return next(pathToFileURL(file).href, context);
  }
  return next(specifier, context);
}
