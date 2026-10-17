// Standard kategoritre: hovedkategori -> underkategorier.
// Kategori-id på en transaksjon er "hoved/under", f.eks. "bil/drivstoff".

export const TYPER = {
  inntekt: 'Inntekt',
  utgift: 'Utgift',
  noytral: 'Nøytral',
  sparing: 'Sparing',
  overforing: 'Overføring',
};

export const TYPE_FORKLARING = {
  inntekt: 'Teller som inntekt og i netto kontantstrøm',
  utgift: 'Teller som forbruk og i netto kontantstrøm',
  noytral: 'Teller bare i netto kontantstrøm (refusjoner, oppgjør, justeringer)',
  sparing: 'Penger flyttet til investeringer – vises som «herav investert»',
  overforing: 'Teller ikke (interne overføringer, betaling av kortfaktura)',
};

const k = (id, navn, type, under) => ({ id, navn, type, under: under.map(([uid, unavn]) => ({ id: `${id}/${uid}`, navn: unavn })) });

export const STANDARD_KATEGORIER = [
  k('inntekt', 'Inntekter', 'inntekt', [
    ['lonn', 'Lønn'],
    ['sideinntekt', 'Sideinntekt og honorar'],
    ['engang', 'Engangsutbetalinger'],
    ['bonus', 'Bonus og cashback'],
    ['kapital', 'Utbytte og renter'],
    ['annet', 'Annen inntekt'],
  ]),
  k('bolig', 'Bolig', 'utgift', [
    ['husleie', 'Husleie og felleskostnader'],
    ['strom', 'Strøm og oppvarming'],
    ['kommunalt', 'Kommunale avgifter'],
    ['internett', 'Internett og TV'],
    ['vedlikehold', 'Vedlikehold og innbo'],
  ]),
  k('mat', 'Mat og drikke', 'utgift', [
    ['dagligvarer', 'Dagligvarer'],
    ['restaurant', 'Restaurant, uteliv og takeaway'],
    ['kantine', 'Kantine og overtidsmat'],
  ]),
  k('bil', 'Bil og transport', 'utgift', [
    ['drivstoff', 'Drivstoff og lading'],
    ['bompenger', 'Bompenger'],
    ['parkering', 'Parkering'],
    ['vedlikehold', 'Service, dekk og vedlikehold'],
    ['bilvask', 'Bilvask'],
    ['skade', 'Skade og uhell'],
    ['hobby', 'Bilhobby (frivillig)'],
    ['kollektiv', 'Kollektiv og taxi'],
    ['annet', 'Annet bil'],
  ]),
  k('lan', 'Lån', 'utgift', [
    ['studielan', 'Studielån'],
    ['billan', 'Billån'],
    ['boliglan', 'Boliglån'],
    ['annet', 'Andre lån og renter'],
  ]),
  k('forsikring', 'Forsikring', 'utgift', [['forsikring', 'Forsikring']]),
  k('abonnement', 'Abonnementer', 'utgift', [
    ['musikk', 'Musikk og strømming'],
    ['programvare', 'Programvare og AI'],
    ['avis', 'Aviser og magasiner'],
    ['apple', 'Apple og skytjenester'],
    ['annet', 'Andre abonnementer'],
  ]),
  k('reise', 'Reise og ferie', 'utgift', [
    ['reise', 'Reise (fly, hotell, aktiviteter)'],
    ['bilutleie', 'Bilutleie'],
    ['revolut', 'Revolut / reisekonto'],
    ['oppgjor', 'Oppgjør med reisefølge'],
  ]),
  k('personlig', 'Shopping og personlig', 'utgift', [
    ['klaer', 'Klær og sko'],
    ['frisor', 'Frisør og pleie'],
    ['helse', 'Apotek og helse'],
    ['diverse', 'Annen shopping'],
  ]),
  k('fritid', 'Fritid og medlemskap', 'utgift', [
    ['opplevelser', 'Kino og opplevelser'],
    ['medlemskap', 'Medlemskap og kontingenter'],
    ['hobby', 'Hobby og fritid'],
  ]),
  k('skatt', 'Skatt', 'utgift', [
    ['restskatt', 'Restskatt og tidligere års skatt'],
    ['forskudd', 'Tilleggsforskudd'],
  ]),
  k('diverse', 'Diverse', 'utgift', [
    ['gebyrer', 'Gebyrer'],
    ['post', 'Post og pakke'],
    ['annet', 'Annet'],
  ]),
  k('utlegg', 'Utlegg og refusjoner', 'noytral', [
    ['utlegg', 'Utlegg som refunderes'],
    ['refusjon', 'Refusjon mottatt'],
    ['andre', 'Kjøp for andre'],
  ]),
  k('privat', 'Private overføringer', 'noytral', [
    ['vipps', 'Vipps-oppgjør med venner'],
    ['familie', 'Familie og gaver'],
    ['annet', 'Andre private overføringer'],
  ]),
  k('justering', 'Justeringer', 'noytral', [['kort', 'Kort – tidsforskyvning']]),
  k('sparing', 'Sparing og investering', 'sparing', [
    ['innskudd', 'Innskudd aksjer og fond'],
    ['fondsavtale', 'Fondsspareavtale'],
  ]),
  k('overforing', 'Overføringer', 'overforing', [
    ['intern', 'Intern overføring'],
    ['kortoppgjor', 'Betaling av kortfaktura'],
  ]),
];

export const UKATEGORISERT = { id: '', navn: 'Ukategorisert' };

export function kategoriIndeks(kategorier) {
  const sub = new Map();
  const hoved = new Map();
  for (const h of kategorier) {
    hoved.set(h.id, h);
    for (const u of h.under) sub.set(u.id, { ...u, hoved: h });
  }
  return {
    sub,
    hoved,
    hent: (id) => sub.get(id) || null,
    hovedFor: (id) => sub.get(id)?.hoved || null,
    type: (id) => sub.get(id)?.hoved.type || 'utgift',
    navn: (id) => {
      const s = sub.get(id);
      return s ? `${s.hoved.navn} › ${s.navn}` : UKATEGORISERT.navn;
    },
  };
}

// Kobling fra kategoriene i regnearket (kategori, underkategori) til nytt tre.
// Underkategorier som beskriver en tur blir etiketter i stedet.
export function mapGammelKategori(kat, under, belop) {
  const u = (under || '').toLowerCase();
  const has = (s) => u.includes(s);
  const k = (kat || '').toLowerCase();
  if (k.includes('utleggsrefusjon')) return 'utlegg/refusjon';
  if (k.includes('reell inntekt')) return 'inntekt/engang';
  switch (kat) {
    case 'Nettolønn': return 'inntekt/lonn';
    case 'Dagligvarer': return has('refusjon') ? 'utlegg/refusjon' : 'mat/dagligvarer';
    case 'Mat/uteliv':
      if (has('kantine') || has('overtidsmat')) return 'mat/kantine';
      if (has('kino')) return 'fritid/opplevelser';
      return 'mat/restaurant';
    case 'Bilhold nødvendig':
      if (has('refundert')) return belop > 0 ? 'utlegg/refusjon' : 'utlegg/utlegg';
      if (has('drivstoff') || has('lading')) return 'bil/drivstoff';
      if (has('parkering')) return 'bil/parkering';
      if (has('bilvask')) return 'bil/bilvask';
      if (has('skade')) return 'bil/skade';
      if (has('kjøp for') || u === 'vipps') return 'utlegg/andre';
      if (has('dekk') || has('eu-kontroll') || has('olje') || has('deler') || has('jekk')) return 'bil/vedlikehold';
      return 'bil/annet';
    case 'Bilhold frivillig': return 'bil/hobby';
    case 'Bompenger': return 'bil/bompenger';
    case 'Billån': return 'lan/billan';
    case 'Studielån': return 'lan/studielan';
    case 'Forsikring': return 'forsikring/forsikring';
    case 'Abonnementer':
      if (has('refus') || has('refundert')) return belop > 0 ? 'utlegg/refusjon' : 'utlegg/utlegg';
      if (has('apple')) return 'abonnement/apple';
      if (has('musikk')) return 'abonnement/musikk';
      if (has('programvare')) return 'abonnement/programvare';
      if (has('avis')) return 'abonnement/avis';
      return 'abonnement/annet';
    case 'Reise/ferie': return has('bilutleie') ? 'reise/bilutleie' : 'reise/reise';
    case 'Revolut': return has('oppgjør') ? 'reise/oppgjor' : 'reise/revolut';
    case 'Shopping':
      if (has('frisør')) return 'personlig/frisor';
      if (has('klær')) return 'personlig/klaer';
      return 'personlig/diverse';
    case 'Annet, kort':
      if (has('apotek')) return 'personlig/helse';
      if (has('kino')) return 'fritid/opplevelser';
      if (has('fritid')) return 'fritid/hobby';
      if (has('post')) return 'diverse/post';
      return 'diverse/annet';
    case 'Annen inntekt/utgift':
      if (has('gebyr')) return 'diverse/gebyrer';
      if (/\S-oppgjør/.test(u)) return 'reise/oppgjor'; // «<reisemål>-oppgjør»
      if (has('tur') || has('reise') || has('fly')) return 'reise/reise';
      if (has('revolut')) return 'reise/revolut';
      if (has('trumf') || has('bonus')) return 'inntekt/bonus';
      if (has('refusjon drivstoff')) return 'bil/drivstoff';
      if (has('privat')) return 'privat/annet';
      return belop > 0 ? 'inntekt/annet' : 'diverse/annet';
    case 'Vipps fra venner': return has('skade') ? 'bil/skade' : 'privat/vipps';
    case 'Familie': return 'privat/familie';
    case 'Kontingenter': return 'fritid/medlemskap';
    case 'Restskatt': return 'skatt/restskatt';
    case 'Kort – tidsforskyvning': return 'justering/kort';
    case 'Eksterne investeringer': return has('fond') ? 'sparing/fondsavtale' : 'sparing/innskudd';
    case 'Intern overføring': return 'overforing/intern';
    case 'Kortoppgjør': return 'overforing/kortoppgjor';
    // Ukjente kategorier: inntekter blir sideinntekt, utgifter står ukategorisert
    default: return belop > 0 && kat ? 'inntekt/sideinntekt' : '';
  }
}

// Underkategorier fra regnearket som beskriver noe annet enn kategorien (tur, refusjon fra hvem osv.)
export function etiketterFraGammel(kat, under) {
  if (!under) return [];
  const u = under.toLowerCase();
  if (/tur|oppgjør|reise/.test(u)) return [under.replace(/,.*$/, '').trim()];
  if (/refunder|refusjon fra/.test(u)) return ['Refunderes'];
  return [];
}
