import { google } from 'googleapis';

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate?: string;
  payload: {
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{
      partId?: string;
      mimeType: string;
      filename?: string;
      body?: { data?: string; size?: number };
    }>;
  };
}

export interface GmailClientLike {
  users: {
    messages: {
      list(params: { userId: string; q?: string; labelIds?: string; maxResults?: number }): Promise<{ data: { messages?: GmailMessage[]; nextPageToken?: string } }>;
      get(params: { userId: string; id: string; format?: string }): Promise<{ data: GmailMessage }>;
    };
  };
}

export function createGmailClient(refreshToken?: string): GmailClientLike {
  const auth = new (require('google-auth-library').OAuth2Client)(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  if (refreshToken) auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth }) as unknown as GmailClientLike;
}

export async function fetchBillEmails(userId = 'me', refreshToken?: string, maxResults = 10): Promise<GmailMessage[]> {
  try {
    const client = createGmailClient(refreshToken);
    const res = await client.users.messages.list({
      userId,
      q: 'from:bills@bumbleflies.de newer_than:7d has:attachment',
      maxResults,
    });
    return res.data.messages ?? [];
  } catch (e) {
    console.warn('Gmail fetch failed (expected without OAuth config):', (e as Error).message);
    return [];
  }
}
