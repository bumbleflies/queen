import { google } from 'googleapis';
import { getGoogleAccessTokenForUser } from './AuthService';
import { createOAuth2Client } from './DriveService';
import type { DriveFilesLike } from './receiptsDrive';

/** Drive v3 client acting as the logged-in user (their stored refresh token). */
export async function driveForUser(userId: string): Promise<DriveFilesLike> {
  const { accessToken, refreshToken } = await getGoogleAccessTokenForUser(userId);
  const auth = createOAuth2Client(refreshToken);
  auth.setCredentials({ refresh_token: refreshToken, access_token: accessToken });
  return google.drive({ version: 'v3', auth }) as unknown as DriveFilesLike;
}
