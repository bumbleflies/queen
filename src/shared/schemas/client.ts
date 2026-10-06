import { z } from 'zod';

export const createClientSchema = z.object({
  customerNumber: z.number().int().positive().optional(),
  name: z.string().min(1, 'name is required'),
  invoiceAddress: z.string().min(1, 'invoiceAddress is required'),
  domain: z.string().trim().optional(),
  defaultPaymentTermDays: z.number().int().min(0).max(120).optional(),
  email: z.string().email().optional(),
  externalRefs: z
    .array(z.object({ system: z.string().min(1), associationId: z.string().min(1) }))
    .optional(),
});

export const updateClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  invoiceAddress: z.string().min(1).optional(),
  domain: z.string().trim().optional(),
  defaultPaymentTermDays: z.number().int().min(0).max(120).optional(),
  email: z.string().email().optional(),
  customerNumber: z.number().int().positive().optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
