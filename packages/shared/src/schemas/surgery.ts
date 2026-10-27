import { z } from "zod";
import { idSchema, moneySchema, paginationQuerySchema } from "./common";

const surgeryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");

export const createSurgerySchema = z.object({
  admissionId: idSchema,
  serviceId: idSchema,
  surgeonUserId: idSchema,
  scheduledDate: surgeryDateSchema,
  note: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().uuid(),
});
export type CreateSurgeryInput = z.infer<typeof createSurgerySchema>;

export const surgeryEntryItemSchema = z
  .object({
    kind: z.enum(["MATERIAL", "ANESTHESIA"]),
    serviceId: idSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    quantity: z
      .string()
      .regex(
        /^\d{1,9}(?:\.\d{1,3})?$/,
        "Quantity must have at most 3 decimal places",
      )
      .refine((value) => /[1-9]/.test(value), "Quantity must be positive"),
    unit: z.string().trim().min(1).max(30).optional(),
    unitPrice: moneySchema
      .refine(
        (value) => /^\d{1,12}(?:\.\d{1,2})?$/.test(value),
        "Amount too large",
      )
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine(
    (value) =>
      value.serviceId !== undefined ||
      (value.title !== undefined &&
        value.unit !== undefined &&
        value.unitPrice !== undefined),
    {
      message: "Select a catalogue item or provide its name, unit and price",
      path: ["title"],
    },
  );
export type SurgeryEntryItemInput = z.infer<typeof surgeryEntryItemSchema>;

export const addSurgeryEntriesSchema = z.object({
  idempotencyKey: z.string().uuid(),
  items: z.array(surgeryEntryItemSchema).min(1).max(50),
});
export type AddSurgeryEntriesInput = z.infer<typeof addSurgeryEntriesSchema>;

export const surgeryStaffRoleSchema = z.enum([
  "SURGEON",
  "ANESTHESIOLOGIST",
  "NURSE",
]);
export type SurgeryStaffRole = z.infer<typeof surgeryStaffRoleSchema>;

export const addSurgeryStaffFeesSchema = z.object({
  idempotencyKey: z.string().uuid(),
  items: z
    .array(
      z.object({
        role: surgeryStaffRoleSchema,
        amount: moneySchema
          .refine(
            (value) => /^\d{1,12}(?:\.\d{1,2})?$/.test(value),
            "Amount too large",
          )
          .refine((value) => /[1-9]/.test(value), "Amount must be positive"),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(3)
    .refine(
      (items) => new Set(items.map((item) => item.role)).size === items.length,
      "Each staff role may appear only once",
    ),
});
export type AddSurgeryStaffFeesInput = z.infer<
  typeof addSurgeryStaffFeesSchema
>;

export const surgeryQuerySchema = paginationQuerySchema
  .extend({
    admissionId: idSchema.optional(),
    patientId: idSchema.optional(),
    status: z.enum(["PLANNED", "COMPLETED", "CANCELLED"]).optional(),
    /**
     * active — jarayonda (rejalashtirilgan yoki yakunlangan lekin to‘liq to‘lanmagan)
     * archive — yakunlangan + to‘liq to‘langan, yoki bekor qilingan
     */
    bucket: z.enum(["active", "archive"]).optional(),
    search: z.string().trim().max(120).optional(),
    from: surgeryDateSchema.optional(),
    to: surgeryDateSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "End date must not precede start date",
    path: ["to"],
  });
export type SurgeryQueryInput = z.infer<typeof surgeryQuerySchema>;

export const surgerySelectorQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SurgerySelectorQueryInput = z.infer<
  typeof surgerySelectorQuerySchema
>;
