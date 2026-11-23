import { describe, it, expect } from 'vitest';
import { claimIntakeReply } from '../intakeMail';
import { formatGermanEUR } from '../../money';

describe('claimIntakeReply', () => {
  it('lists each claim, the total and a link to the claim', () => {
    const reply = claimIntakeReply([
      { fileName: 'a.pdf', vendor: 'Bahn', grossCents: 4120, claimId: 'c1' },
      { fileName: 'b.pdf', vendor: 'Hotel', grossCents: 8900, claimId: 'c2' },
    ], 'https://queen.example');
    expect(reply.subject).toMatch(/^Re: /);
    expect(reply.text).toContain('2 Belege');
    expect(reply.text).toContain(formatGermanEUR(13020));
    expect(reply.text).toContain('https://queen.example/expenses?claim=c1');
    expect(reply.text).toContain('https://queen.example/expenses?claim=c2');
  });

  it('uses the singular for a single claim', () => {
    const reply = claimIntakeReply([{ fileName: 'a.pdf', vendor: '', grossCents: 100, claimId: 'c1' }], 'https://queen.example');
    expect(reply.text).toContain('1 Beleg');
    expect(reply.text).not.toContain('1 Belege');
    // A claim without a read vendor still names the file it came from.
    expect(reply.text).toContain('a.pdf');
  });
});
