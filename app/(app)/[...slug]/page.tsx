import { notFound } from "next/navigation";

/**
 * Unknown paths inside the signed-in app get the app's own "Page not found"
 * (inside the shell). Every page in the navigation has a real route, and real
 * routes take precedence over this catch-all.
 */
export default function UnknownAppPath(): never {
  notFound();
}
