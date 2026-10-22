import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoiceActions, invoiceActionKeys } from '../components/InvoiceActions';

describe('invoiceActionKeys (visibility table)', () => {
  it('draft → edit / delete / send', () => {
    expect(invoiceActionKeys('draft')).toEqual(['edit', 'delete', 'send']);
  });

  it('sent → mark paid / cancel / assign payment', () => {
    expect(invoiceActionKeys('sent')).toEqual(['markPaid', 'cancel', 'assignPayment']);
  });

  it('paid and canceled → read-only', () => {
    expect(invoiceActionKeys('paid')).toEqual([]);
    expect(invoiceActionKeys('paid', 'invoice', false)).toEqual([]);
    expect(invoiceActionKeys('canceled')).toEqual([]);
  });

  it('paid but imported without a payment → assign payment', () => {
    expect(invoiceActionKeys('paid', 'invoice', true)).toEqual(['assignPayment']);
    expect(invoiceActionKeys('paid', 'credit_note', true)).toEqual([]);
  });

  it('credit notes are read-only even while stored as sent', () => {
    expect(invoiceActionKeys('sent', 'credit_note')).toEqual([]);
  });
});

describe('InvoiceActions rendering', () => {
  it('draft shows Bearbeiten / Löschen / Ausstellen & ablegen', () => {
    render(<InvoiceActions status="draft" />);
    expect(screen.getByText('Bearbeiten')).toBeInTheDocument();
    expect(screen.getByText('Entwurf löschen')).toBeInTheDocument();
    expect(screen.getByText('Ausstellen & ablegen')).toBeInTheDocument();
    expect(screen.queryByText('Stornieren')).not.toBeInTheDocument();
  });

  it('sent shows Als bezahlt markieren / Stornieren / Zahlung zuordnen', () => {
    render(<InvoiceActions status="sent" />);
    expect(screen.getByText('Als bezahlt markieren')).toBeInTheDocument();
    expect(screen.getByText('Stornieren')).toBeInTheDocument();
    expect(screen.getByText('Zahlung zuordnen')).toBeInTheDocument();
    expect(screen.queryByText('Bearbeiten')).not.toBeInTheDocument();
  });

  it('paid is read-only', () => {
    render(<InvoiceActions status="paid" />);
    expect(screen.queryByText('Als bezahlt markieren')).not.toBeInTheDocument();
    expect(screen.queryByText('Stornieren')).not.toBeInTheDocument();
    expect(screen.getByText(/Abgeschlossen/)).toBeInTheDocument();
  });

  it('paid without a recorded payment still offers Zahlung zuordnen', () => {
    render(<InvoiceActions status="paid" paymentMissing />);
    expect(screen.getByText('Zahlung zuordnen')).toBeInTheDocument();
    expect(screen.queryByText(/Abgeschlossen/)).not.toBeInTheDocument();
  });

  it('canceled is read-only', () => {
    render(<InvoiceActions status="canceled" />);
    expect(screen.queryByText('Zahlung zuordnen')).not.toBeInTheDocument();
    expect(screen.getByText(/Abgeschlossen/)).toBeInTheDocument();
  });
});
