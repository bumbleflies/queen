import { google } from 'googleapis';
import { getGoogleAccessTokenForUser } from './AuthService';
import { createOAuth2Client } from './DriveService';
import type { DriveFilesLike } from './receiptsDrive';
import { Setting } from '../models/Setting';

/** Drive v3 client acting as the logged-in user (their stored refresh token). */
export async function driveForUser(userId: string): Promise<DriveFilesLike> {
  const { accessToken, refreshToken } = await getGoogleAccessTokenForUser(userId);
  const auth = createOAuth2Client(refreshToken);
  auth.setCredentials({ refresh_token: refreshToken, access_token: accessToken });
  return google.drive({ version: 'v3', auth }) as unknown as DriveFilesLike;
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
