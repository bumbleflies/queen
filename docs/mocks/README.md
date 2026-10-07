# UI mocks

Interactive UI mocks for queen, exported from the Claude design canvas "queen UI mock" (2026-10-06). All client names, addresses and amounts are fictional.

The files are Design Component pages (`.dc.html`). They need the canvas runtime (`support.js`) and do not render standalone in a browser. The React client (plan Task 8) is built from them; they remain the reference for layout, copy, states and interactions. New screens (e.g. Buchhaltung) follow the same tokens and responsive rules. `canvas.json` holds the board layout.

| File | Screen | Covers |
|------|--------|--------|
| `Main.dc.html` | Dashboard | KPIs (open, overdue, paid YTD, drafts), Firefly import + reconcile status, due/overdue list |
| `Invoices.dc.html` | Rechnungen | status filter chips incl. Storno, search, client/year filter, gross sum |
| `InvoiceDetail.dc.html` | Rechnung (ausgestellt) | frozen address, Verwendungszweck, hierarchical positions, VAT breakdown, payments, history, Storno → credit-note dialog |
| `InvoiceEdit.dc.html` | Entwurf bearbeiten | line editor (add/remove, negative discount lines, per-line VAT, 0 % exemption note), live totals per rate, "Ausstellen & ablegen" |
| `Bank.dc.html` | Bankabgleich | unmatched queue with reason + suggestions, assign/ignore, matched/ignored tabs |
| `MobileInvoices.dc.html` | Mobil – Rechnungen | card list, filter chips, bottom tab bar, FAB |
| `MobileInvoice.dc.html` | Mobil – Rechnung | copy Verwendungszweck, collapsible positions, action sheet |
| `MobileBank.dc.html` | Mobil – Zahlung zuordnen | one-tap assign/ignore |

Mobile rules shown in the desktop pages (below 760 px): sidebar becomes a horizontally scrolling top bar, tables (`table.resp`) become labelled cards, touch targets ≥ 44 px.

Design tokens used: ground `#F4F3EF`, surface `#FFFFFF`, ink `#1B1B1F`, muted `#5E5D66`, link `#1F4E8C`, accent (honey) `#E0A100`; fonts IBM Plex Sans + IBM Plex Mono (tabular numbers). Status colours: draft gray, sent blue, overdue amber, paid green, partial purple, canceled red.
