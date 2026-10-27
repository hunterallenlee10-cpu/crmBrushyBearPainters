"use client";

import * as React from "react";

/**
 * Whether the viewer may "Download CSV" (data:export, never while viewing as
 * someone else). Set once by the app shell so every "View data" dialog knows
 * without a round trip; the server action checks again and logs the export.
 */
const ExportContext = React.createContext<{ canExport: boolean }>({ canExport: false });

export function ExportProvider({
  canExport,
  children,
}: {
  canExport: boolean;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => ({ canExport }), [canExport]);
  return <ExportContext.Provider value={value}>{children}</ExportContext.Provider>;
}

export function useCanExport(): boolean {
  return React.useContext(ExportContext).canExport;
}
