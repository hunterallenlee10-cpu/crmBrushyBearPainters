import type { DripExitCondition, DripStep } from "./index";

/** The seeded drips (SPEC §11.2 #16). */
export const DEFAULT_DRIPS: readonly {
  key: string;
  name: string;
  description: string;
  steps: DripStep[];
  exitConditions: DripExitCondition[];
}[] = [
  {
    key: "just_planning_nurture",
    name: "Just-planning nurture",
    description:
      "For leads who are just planning or went quiet: three friendly check-ins over two months.",
    steps: [
      { delay_days: 3, channel: "email_or_sms", template_key: "nurture_just_planning_1" },
      { delay_days: 21, channel: "email_or_sms", template_key: "nurture_just_planning_2" },
      { delay_days: 35, channel: "email_or_sms", template_key: "nurture_just_planning_3" },
    ],
    exitConditions: ["replied", "booked", "converted", "lost", "opted_out"],
  },
  {
    key: "exterior_pre_season",
    name: "Exterior pre-season",
    description:
      "Exterior and deck leads: “Exterior dates for this summer are filling up” in February, March and April.",
    steps: [
      { on_date: "02-01", channel: "email_or_sms", template_key: "exterior_preseason_feb" },
      { on_date: "03-01", channel: "email_or_sms", template_key: "exterior_preseason_mar" },
      { on_date: "04-01", channel: "email_or_sms", template_key: "exterior_preseason_apr" },
    ],
    exitConditions: ["replied", "booked", "converted", "lost", "opted_out"],
  },
];
