import { z } from 'zod';
import { normaliseServicePeriod } from '../../server/lib/servicePeriod';

/** Hierarchical line position: '1', '1.1', '3.2', ... */
export const positionSchema = z.string().regex(/^\d+(\.\d+)*$/, 'Invalid position');

export const vatRateSchema = z.union([
  z.literal(0),
  z.literal(0.07),
  z.literal(0.16),
  z.literal(0.19),
]);

/**
 * Service period MM.YYYY. Accepts inconsistently padded input ('5.2025')
 * and normalises to '05.2025' via normaliseServicePeriod.
 */
export const servicePeriodSchema = z
  .string()
  .refine(
    (s) => {
      try {
        normaliseServicePeriod(s);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid service period (expected MM.YYYY)' },
  )
  .transform((s) => normaliseServicePeriod(s));

export const invoiceLineSchema = z.object({
  position: positionSchema,
  description: z.string().min(1, 'description is required'),
  quantity: z.number(),
  // Integer cents in the API (no float euros) to avoid float drift.
  unitNetCents: z.number().int(),
  vatRate: vatRateSchema,
  vatNote: z.string().optional(),
  source: z
    .object({
      leagueId: z.number().optional(),
      chosenSource: z.enum(['offer', 'live', 'custom']).optional(),
    })
    .optional(),
});

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export const createDraftSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1, 'title is required'),
  servicePeriod: servicePeriodSchema,
  paymentTermDays: z.number().int().min(0).max(120).optional(),
  invoiceAddress: z.string().min(1).optional(),
  currency: z.literal('EUR').optional(),
});

export const updateDraftSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  invoiceAddress: z.string().min(1).optional(),
  servicePeriod: servicePeriodSchema.optional(),
  paymentTermDays: z.number().int().min(0).max(120).optional(),
});

export const setLinesSchema = z.object({
  id: z.string().min(1),
  lines: z.array(invoiceLineSchema),
});
