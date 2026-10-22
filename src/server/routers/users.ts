import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { User } from '../models/User';
import { userRoleSchema } from '../../shared/schemas/user';
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteTtlHours,
} from '../lib/inviteToken';

const emailSchema = z.string().trim().email();
const idSchema = z.string().min(1);

/** `<CLIENT_URL>/invite#<token>` — the fragment never reaches a proxy log. */
function inviteUrl(token: string): string {
  const base = (process.env.CLIENT_URL ?? '').replace(/\/+$/, '');
  return `${base}/invite#${token}`;
}

export const usersRouter = router({
  /** Admin roster: who exists, who may still redeem, who has Drive. */
  list: adminProcedure.query(async () => {
    const users = await User.find({}).sort({ email: 1 });
    return users.map((u) => ({
      id: String(u._id),
      email: String(u.get('email')),
      role: u.get('role') === 'admin' ? ('admin' as const) : ('user' as const),
      disabled: u.get('disabled') === true,
      lastLoginAt: (u.get('lastLoginAt') as Date | undefined) ?? null,
      inviteExpiresAt: (u.get('inviteExpiresAt') as Date | undefined) ?? null,
      hasGoogle: Boolean(u.get('googleId')),
      hasDrive: Boolean(u.get('refreshToken')),
    }));
  }),

  /** Issue (or re-issue) a one-time link. The plaintext token is returned once and never stored. */
  invite: adminProcedure
    .input(z.object({ email: emailSchema, role: userRoleSchema.default('user') }))
    .mutation(async ({ input, ctx }) => {
      const token = generateInviteToken();
      const expiresAt = inviteExpiry(new Date());
      const email = input.email.toLowerCase();
      const user = await User.findOneAndUpdate(
        { email },
        {
          $set: {
            email,
            role: input.role,
            inviteTokenHash: hashInviteToken(token),
            inviteExpiresAt: expiresAt,
            invitedBy: ctx.user.sub,
            disabled: false,
          },
        },
        { upsert: true, setDefaultsOnInsert: true, returnDocument: 'after' },
      );
      return { id: String(user._id), url: inviteUrl(token), expiresAt, ttlHours: inviteTtlHours() };
    }),

  revokeInvite: adminProcedure.input(z.object({ id: idSchema })).mutation(async ({ input }) => {
    await User.updateOne({ _id: input.id }, { $unset: { inviteTokenHash: 1, inviteExpiresAt: 1 } });
    return { ok: true as const };
  }),

  setRole: adminProcedure
    .input(z.object({ id: idSchema, role: userRoleSchema }))
    .mutation(async ({ input, ctx }) => {
      if (input.id === ctx.user.sub && input.role !== 'admin') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Der eigene Admin-Zugang kann nicht herabgestuft werden.',
        });
      }
      await User.updateOne({ _id: input.id }, { $set: { role: input.role } });
      return { ok: true as const };
    }),

  /** Disable (never delete — `createdBy` must stay resolvable). Also ends live sessions. */
  setDisabled: adminProcedure
    .input(z.object({ id: idSchema, disabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (input.id === ctx.user.sub && input.disabled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Der eigene Zugang kann nicht deaktiviert werden.',
        });
      }
      await User.updateOne(
        { _id: input.id },
        { $set: { disabled: input.disabled }, $inc: { tokenVersion: 1 } },
      );
      return { ok: true as const };
    }),
});
