import { createGmailClient, headerValue, sendMail, type OutgoingMail } from '../../services/GmailService';
import { googleAccessForCron } from '../../services/driveForUser';
import { formatGermanEUR } from '../money';

/** Origin of the payout deep link; same setting the intakes use. */
function appUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.QUEEN_APP_URL?.trim() || 'https://queen.bumbleflies.de').replace(/\/+$/, '');
}

export interface PayoutMailInput {
  payout: { number: string; amountCents: number; purpose: string };
  founder: { name: string; loginEmail: string };
  /** The newest claim's Gmail message — its thread gets the reply. */
  newestClaim?: { messageId?: string | null; subject?: string | null } | null;
}

/** The German release mail. `to`/thread are attached by `sendPayoutReleaseMail`. */
export function payoutReleaseMail(
  input: PayoutMailInput,
  origin: string = appUrl(),
): Omit<OutgoingMail, 'to'> {
  const { payout, founder } = input;
  const link = `${origin.replace(/\/+$/, '')}/expenses/payouts/${payout.number}`;
  return {
    subject: `Spesen-Auszahlung ${payout.number}`,
    text: [
      `Hallo ${founder.name},`,
      '',
      `deine Spesen-Auszahlung ist freigegeben: ${payout.purpose}`,
      `Betrag: ${formatGermanEUR(payout.amountCents)}`,
      `Referenz: ${payout.number}`,
      '',
      `Bitte melde dich an und öffne deine Auszahlung: ${link}`,
      'Dort erscheint der QR-Code. In der GLS-App scannen und dort mit TAN bestätigen.',
      'Danach hier nichts weiter tun — die Bankzeile gleicht automatisch aus.',
      '',
    ].join('\n'),
  };
}

/** Thread lookup for a reply. A missing/unreadable original only means a new thread. */
export interface MailThread {
  threadId?: string | null;
  messageIdHeader?: string | null;
}

/**
 * Send the release mail as a reply in the newest claim's thread. Everything
 * that can fail (thread lookup, Gmail send) may be caught by the caller: a mail
 * problem must never un-release a payout.
 */
export async function sendPayoutReleaseMail(args: {
  input: PayoutMailInput;
  send: (mail: OutgoingMail) => Promise<string>;
  lookup?: (messageId: string) => Promise<MailThread>;
  origin?: string;
}): Promise<string> {
  const mail = payoutReleaseMail(args.input, args.origin);
  const messageId = args.input.newestClaim?.messageId?.trim();
  let thread: MailThread = {};
  if (messageId && args.lookup) {
    thread = await args.lookup(messageId).catch(() => ({}));
  }
  return args.send({
    ...mail,
    to: args.input.founder.loginEmail,
    ...(thread.threadId ? { threadId: thread.threadId } : {}),
    ...(thread.messageIdHeader
      ? { inReplyTo: thread.messageIdHeader, references: thread.messageIdHeader }
      : {}),
  });
}

/**
 * Production mailer: the Google credential of the admin who saved the Drive
 * settings, the same one the mail intake uses. Sending needs `gmail.send`.
 */
export async function resolvePayoutMailer(): Promise<(input: PayoutMailInput) => Promise<string>> {
  const access = await googleAccessForCron();
  if (!access) throw new Error('Kein Google-Zugang hinterlegt — bitte in den Einstellungen erneuern');
  const client = createGmailClient(access.refreshToken, access.accessToken);
  return (input) =>
    sendPayoutReleaseMail({
      input,
      send: (mail) => sendMail(client, mail),
      lookup: async (messageId) => {
        const message = await client.users.messages.get({ userId: 'me', id: messageId, format: 'metadata' });
        return {
          threadId: message.data.threadId,
          messageIdHeader: headerValue(message.data, 'Message-ID'),
        };
      },
    });
}
