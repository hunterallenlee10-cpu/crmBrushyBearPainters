/** Types and styles shared by the picklist values editor and its dialog. */

export type PicklistValueRow = {
  id: string;
  value: string;
  label: string;
  category: string | null;
  parentValueId: string | null;
  color: string | null;
  active: boolean;
  isSystem: boolean;
};

export type ParentOption = { id: string; label: string; active: boolean };

/** Native <select> styled like the shadcn inputs (keyboard and screen-reader friendly). */
export const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";
