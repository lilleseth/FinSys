// Flere år: hvilket år en transaksjon hører til, budsjett per år og låste (avsluttede) år.
// Et år regnes etter betalingsdato, som i kontantstrømmen og i datafilene (transaksjoner-ÅÅÅÅ).

export const aarFor = (t) => (t.betalt || t.dato || '').slice(0, 4);

export function aarsinfo(db, aar) {
  return db.aarsavslutning?.[String(aar)] || null;
}

export function erLastAar(db, aar) {
  return !!aar && !!db.aarsavslutning?.[String(aar)]?.last;
}

export const erLastDato = (db, dato) => !!dato && erLastAar(db, dato.slice(0, 4));
export const erLastTransaksjon = (db, t) => erLastAar(db, aarFor(t));

export function lasteAar(db) {
  return Object.entries(db.aarsavslutning || {}).filter(([, v]) => v.last).map(([a]) => a).sort();
}

export const lastMelding = (aar) => `${aar} er avsluttet og låst. Lås opp året under Rapport → År hvis du må endre noe.`;

// Budsjett for et år: eget budsjett, ellers videreført fra nærmeste tidligere år.
export function budsjettFor(db, aar) {
  const b = db.budsjett || {};
  const per = b.perAar || {};
  if (per[String(aar)]) return per[String(aar)];
  const tidligere = Object.keys(per).filter((a) => a < String(aar)).sort().pop();
  if (tidligere) return per[tidligere];
  return b.poster || {};
}

// 'eget' | 'videreført' (fra et tidligere år) | 'ingen'
export function budsjettKilde(db, aar) {
  const per = db.budsjett?.perAar || {};
  if (per[String(aar)] && Object.keys(per[String(aar)]).length) return { type: 'eget' };
  const tidligere = Object.keys(per).filter((a) => a < String(aar) && Object.keys(per[a]).length).sort().pop();
  if (tidligere) return { type: 'videreført', fra: tidligere };
  if (Object.keys(db.budsjett?.poster || {}).length) return { type: 'videreført', fra: null };
  return { type: 'ingen' };
}

// Flytter et gammelt felles budsjett over til budsjett per år (kjøres ved oppstart)
export function oppgraderBudsjett(db, aar) {
  db.budsjett ||= {};
  db.budsjett.poster ||= {};
  if (!db.budsjett.perAar) {
    db.budsjett.perAar = {};
    if (Object.keys(db.budsjett.poster).length) db.budsjett.perAar[String(aar)] = { ...db.budsjett.poster };
  }
}
