import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  type InvoiceStatus,
  type InvoiceAction,
} from '../invoiceStateMachine';

const expected: Record<InvoiceStatus, Record<InvoiceAction, boolean>> = {
  draft: {
    update: true,
    setLines: true,
    delete: true,
    markSent: true,
    markPaid: false,
    cancel: false,
  },
  sent: {
    update: false,
    setLines: false,
    delete: false,
    markSent: false,
    markPaid: true,
    cancel: true,
  },
  paid: {
    update: false,
    setLines: false,
    delete: false,
    markSent: false,
    markPaid: false,
    cancel: false,
  },
  canceled: {
    update: false,
    setLines: false,
    delete: false,
    markSent: false,
    markPaid: false,
    cancel: false,
  },
};

const statuses = Object.keys(expected) as InvoiceStatus[];
const actions = Object.keys(expected.draft) as InvoiceAction[];

describe('canTransition', () => {
  for (const status of statuses) {
    for (const action of actions) {
      it(`${status} + ${action} → ${expected[status][action]}`, () => {
        expect(canTransition(status, action)).toBe(expected[status][action]);
      });
    }
  }
});

describe('assertTransition', () => {
  it('does not throw on allowed transitions', () => {
    expect(() => assertTransition('draft', 'markSent')).not.toThrow();
    expect(() => assertTransition('sent', 'markPaid')).not.toThrow();
  });

  it('throws BAD_REQUEST on disallowed transitions', () => {
    for (const status of statuses) {
      for (const action of actions) {
        if (!expected[status][action]) {
          try {
            assertTransition(status, action);
            throw new Error(`expected throw for ${status}+${action} but did not throw`);
          } catch (err: any) {
            // Must surface as BAD_REQUEST with an informative message
            expect(err.code ?? err.message).toMatch(/BAD_REQUEST/);
            expect(String(err.message)).toMatch(/Only draft|markSent|markPaid|cancel|update|setLines|delete/i);
          }
        }
      }
    }
  });
});
