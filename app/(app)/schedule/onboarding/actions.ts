"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError } from "@/lib/actions/errors";
import { BOARD_LANES } from "@/lib/domain/onboarding/board";
import { advanceJobStage } from "@/lib/jobs/stage";

/**
 * Board drops (SPEC §8.7). The only drop that changes a stage is Needs
 * Onboarding → Ready to Schedule, and it goes through advanceJobStage(), which
 * re-runs the onboarding checks and refuses with the gate's reasons.
 */
export const moveOnBoard = defineAction({
  name: "board.move",
  permissions: ["jobs:advance_stage"],
  schema: z.object({ jobId: z.uuid(), to: z.enum(BOARD_LANES) }),
  handler: async (v, ctx) => {
    if (v.to !== "ready") {
      throw new ActionFailure(actionError("validation", "Open the job to move it there."));
    }
    const result = await advanceJobStage({ jobId: v.jobId, toStage: "ready_to_schedule" }, ctx);
    revalidatePath("/schedule/onboarding");
    revalidatePath(`/jobs/${v.jobId}`);
    return result;
  },
});
