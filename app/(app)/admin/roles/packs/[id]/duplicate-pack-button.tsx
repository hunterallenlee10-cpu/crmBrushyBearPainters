"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { duplicatePack } from "../../actions";

export function DuplicatePackButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      variant="cta"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await duplicatePack({ id });
          if (!result.ok) {
            toast.error(result.error.message);
            return;
          }
          toast.success("Copied. This custom pack is yours to edit.");
          router.push(`/admin/roles/packs/${result.data.id}`);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Copy aria-hidden />}
      Duplicate as custom pack
    </Button>
  );
}
