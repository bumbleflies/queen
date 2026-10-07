import { describe, expect, it } from 'vitest';
import { filingState } from '../lib/filingState';

describe('filingState', () => {
  it('is none for drafts', () => {
    expect(filingState({ status: 'draft' })).toBe('none');
  });

  it('is none for legacy imports without a Drive file', () => {
    expect(filingState({ status: 'paid', legacy: true })).toBe('none');
  });

  it('is filed once a Drive link exists', () => {
    expect(filingState({ status: 'sent', driveMetadata: { link: 'https://drive/x' } })).toBe('filed');
    expect(filingState({ status: 'paid', legacy: true, driveMetadata: { link: 'https://drive/x' } })).toBe(
      'filed',
    );
  });

  it('is failed when the filing job stored a failure reason', () => {
    expect(filingState({ status: 'sent', driveMetadata: { failureReason: 'boom' } })).toBe('failed');
  });

  it('is pending for issued invoices without link or failure', () => {
    expect(filingState({ status: 'sent' })).toBe('pending');
    expect(filingState({ status: 'canceled', driveMetadata: null })).toBe('pending');
  });
});
