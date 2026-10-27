import { z } from "zod";
import {
  API_NAME_PATTERN,
  CUSTOM_FIELD_MODULES,
  CUSTOM_FIELD_TYPES,
  OPTION_VALUE_PATTERN,
  RULE_TYPES,
} from "@/lib/domain/custom-fields";

/** Module Manager inputs (Admin → Module Manager) and custom values on records. */

const optionSchema = z.object({
  value: z
    .string()
    .regex(OPTION_VALUE_PATTERN, "Option values use lowercase letters, numbers and _."),
  label: z.string().trim().min(1, "Give each option a label.").max(80),
});

export const customFieldSchema = z
  .object({
    id: z.uuid().optional(),
    module: z.enum(CUSTOM_FIELD_MODULES),
    api_name: z
      .string()
      .regex(API_NAME_PATTERN, "Use lowercase letters, numbers and _ (start with a letter)."),
    label: z.string().trim().min(1, "Give the field a label.").max(80),
    field_type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(optionSchema).max(100).default([]),
    required: z.boolean().default(false),
    help_text: z
      .string()
      .trim()
      .max(300)
      .nullish()
      .transform((v) => v || null),
    show_in_list: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine((v) => !["picklist", "multi_picklist"].includes(v.field_type) || v.options.length > 0, {
    path: ["options"],
    message: "A picklist needs at least one option.",
  })
  .refine((v) => new Set(v.options.map((o) => o.value)).size === v.options.length, {
    path: ["options"],
    message: "Each option needs its own value.",
  });
export type CustomFieldInput = z.input<typeof customFieldSchema>;

export const reorderFieldsSchema = z.object({
  module: z.enum(CUSTOM_FIELD_MODULES),
  ids: z.array(z.uuid()).min(1).max(200),
});

export const validationRuleSchema = z.object({
  id: z.uuid().optional(),
  module: z.enum(CUSTOM_FIELD_MODULES),
  field: z.string().regex(/^(cf:)?[a-z][a-z0-9_]{0,39}$/, "Pick a field."),
  rule_type: z.enum(RULE_TYPES),
  value: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  message: z.string().trim().min(1, "Write the message people see.").max(200),
  active: z.boolean().default(true),
});
export type ValidationRuleInput = z.input<typeof validationRuleSchema>;

export const idSchema = z.object({ id: z.uuid() });

export const layoutSchema = z.object({
  module: z.enum(CUSTOM_FIELD_MODULES),
  sections: z
    .array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), visible: z.boolean() }))
    .max(40),
});

const customInput = z.union([
  z.string().max(5000),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
  z.null(),
]);

export const customValuesSchema = z.object({
  module: z.enum(CUSTOM_FIELD_MODULES),
  record_id: z.uuid(),
  values: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), customInput),
});
export type CustomValuesInput = z.input<typeof customValuesSchema>;
