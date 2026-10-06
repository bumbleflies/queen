import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';

export function SettingsPage() {
  const me = trpc.me.useQuery();
  const user = me.data?.user;

  return (
    <>
      <header className="page-head">
        <h1>Einstellungen</h1>
      </header>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Konto</h2>
        <div className="grid-form">
          <div>
            <div className="lbl">E-Mail</div>
            <div style={{ marginTop: 4 }}>{user?.email ?? '—'}</div>
          </div>
          <div>
            <div className="lbl">Rolle</div>
            <div style={{ marginTop: 4 }}>{user?.role ?? '—'}</div>
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          queen ist der führende Datensatz für Kunden- und Rechnungsnummern. Bankdaten kommen über
          Firefly III (GLS). Der tägliche Abgleich läuft um 07:30 nach dem 06:00-Import.
        </p>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Links</h2>
        <Link to="/bank">Bankabgleich</Link>
        <Link to="/reports">Berichte</Link>
        <a href="/api/export/invoices.csv">Rechnungen als CSV exportieren</a>
      </section>
    </>
  );
}
