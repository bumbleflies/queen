import { z } from 'zod';

export const userRoleSchema = z.enum(['admin', 'user']);

export const userSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: userRoleSchema,
  googleId: z.string().optional(),
  allowed: z.boolean(),
});

export type UserSchema = z.infer<typeof userSchema>;
