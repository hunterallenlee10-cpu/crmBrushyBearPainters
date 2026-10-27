"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ResolveDialog } from "@/components/attention/resolve-dialog";
import { resolveAttentionItem } from "@/app/(app)/attention/actions";

export function ResolveButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Resolve
      </Button>
      <ResolveDialog
        open={open}
        onOpenChange={setOpen}
        itemTitle={title}
        onResolve={async (note) => {
          const r = await resolveAttentionItem({ id, note });
          if (!r.ok) return r.error.message;
          router.refresh();
          return null;
        }}
      />
    </>
  );
}
