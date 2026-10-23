import { google } from 'googleapis';
import { TRPCError } from '@trpc/server';
import { getGoogleAccessTokenForUser, type GoogleAccess } from './AuthService';
import { createOAuth2Client } from './DriveService';
import type { DriveFilesLike } from './receiptsDrive';
import { Setting } from '../models/Setting';
import { User } from '../models/User';

/** Drive v3 client acting as the logged-in user (their stored refresh token). */
export async function driveForUser(userId: string): Promise<DriveFilesLike> {
  const { accessToken, refreshToken } = await getGoogleAccessTokenForUser(userId);
  return driveForAccess({ accessToken, refreshToken });
}

function driveForAccess({ accessToken, refreshToken }: GoogleAccess): DriveFilesLike {
  const auth = createOAuth2Client(refreshToken);
  auth.setCredentials({ refresh_token: refreshToken, access_token: accessToken });
  return google.drive({ version: 'v3', auth }) as unknown as DriveFilesLike;
}

/**
 * Google credentials for a user acting on Drive. A user without a stored refresh
 * token (an invited accountant who never signed in with Google) acts as the admin
 * who last saved the Drive settings — the same credential `driveForCron` uses.
 * Deliberately not a try/catch fallback: if the user's own token exists but fails,
 * that is their error, not an invitation to impersonate someone else.
 */
export async function driveAccessForActor(userId: string): Promise<GoogleAccess> {
  const user = await User.findById(userId).select('refreshToken');
  if (user?.get('refreshToken')) {
    return getGoogleAccessTokenForUser(userId);
  }
  const fallbackUserId = (await Setting.findOne({ key: 'drive' }))?.updatedBy;
  if (!fallbackUserId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Kein Google-Laufwerk verbunden — bitte in den Einstellungen die Drive-Ordner speichern.',
    });
  }
  try {
    return await getGoogleAccessTokenForUser(fallbackUserId);
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Der hinterlegte Google-Laufwerk-Zugang ist abgelaufen — bitte in den Einstellungen neu verbinden.',
    });
  }
}

/** Drive client for whoever triggers the action, borrowing credentials when they have none. */
export async function driveForActor(userId: string): Promise<DriveFilesLike> {
  return driveForAccess(await driveAccessForActor(userId));
}

/**
 * Drive client for jobs without a logged-in user (the daily reconcile): acts as
 * the admin who last saved the Drive folder settings (`Setting{ key: 'drive' }.updatedBy`).
 * Null when nobody saved them or the client cannot be built (e.g. no refresh token).
 */
export async function driveForCron(): Promise<DriveFilesLike | null> {
  const doc = await Setting.findOne({ key: 'drive' });
  const userId = doc?.updatedBy;
  if (!userId) return null;
  try {
    return await driveForUser(userId);
  } catch {
    return null;
  }
}
