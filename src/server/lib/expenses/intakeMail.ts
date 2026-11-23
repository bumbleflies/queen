import { formatGermanEUR } from '../money';
import type { OutgoingMail } from '../../services/GmailService';

/** One receipt of a mail, as the confirmation reply lists it. */
export interface ClaimReplyLine {
  fileName: string;
  vendor: string;
  grossCents: number;
  claimId: string;
}

/**
 * The one German confirmation the intake writes into the sender's own thread.
 * It lists what arrived, the total and a deep link per claim, so the founder
 * can check the read and later release the payout after signing in.
 */
export function claimIntakeReply(
  lines: ClaimReplyLine[],
  appUrl: string,
): Omit<OutgoingMail, 'to' | 'threadId'> {
  const total = lines.reduce((sum, line) => sum + line.grossCents, 0);
  const body = lines
    .map((line) => `• ${line.vendor || line.fileName}: ${formatGermanEUR(line.grossCents)} — ${appUrl}/expenses?claim=${line.claimId}`)
    .join('\n');
  const count = lines.length === 1 ? '1 Beleg' : `${lines.length} Belege`;
  return {
    subject: 'Re: Spesen',
    text: `${count} erfasst (${formatGermanEUR(total)}):\n\n${body}\n\nNach dem Login kannst du die Belege prüfen und die Auszahlung freigeben.\n`,
  };
}
