// Skatteprognose for lønnstaker: beregnet skatt for året mot forskuddstrekk.
// Satsene kan overstyres under Innstillinger. Kontroller alltid mot skatteetaten.no.

import { formue, verdiPa, sum } from './calc.js';

export const SKATTESATSER = {
  2025: {
    kilde: 'Vedtatt 2025',
    alminnelig: 0.22,
    personfradrag: 108550,
    minstefradrag: { sats: 0.46, maks: 92000, min: 4000 },
    trygdeavgift: { sats: 0.077, grense: 99650, opptrapping: 0.25 },
    trinn: [[217400, 0.017], [306050, 0.04], [697150, 0.137], [942400, 0.167], [1410750, 0.177]],
    formue: { bunnfradrag: 1760000, sats: 0.01, hoyGrense: 20700000, hoySats: 0.011, aksjerabatt: 0.2 },
    oppjustering: 1.72,
    fagforeningMaks: 8250,
    bsu: { sats: 0.1, maks: 27500 },
    ipsMaks: 15000,
    gaverMaks: 25000,
  },
  2026: {
    kilde: 'Statsbudsjettet 2026 etter budsjettforliket',
    alminnelig: 0.22,
    personfradrag: 114540,
    minstefradrag: { sats: 0.46, maks: 95700, min: 4000 },
    trygdeavgift: { sats: 0.076, grense: 99650, opptrapping: 0.25 },
    trinn: [[226100, 0.017], [318300, 0.04], [725050, 0.137], [980100, 0.168], [1467200, 0.178]],
    formue: { bunnfradrag: 1900000, sats: 0.01, hoyGrense: 21500000, hoySats: 0.011, aksjerabatt: 0.2 },
    oppjustering: 1.72,
    fagforeningMaks: 8700,
    bsu: { sats: 0.1, maks: 27500 },
    ipsMaks: 25000,
    gaverMaks: 25000,
    reise: { sats: 1.9, bunn: 12000 },
  },
};

export function satserFor(db, aar) {
  const kjente = Object.keys(SKATTESATSER).map(Number).sort();
  const basis = SKATTESATSER[aar] || SKATTESATSER[kjente.filter((a) => a <= aar).pop() || kjente[0]];
  const overstyr = db.innstillinger?.skattesatser?.[aar];
  return overstyr ? { ...basis, ...overstyr, kilde: 'Egne satser' } : { ...basis, estimert: !SKATTESATSER[aar] };
}

export function trinnskatt(personinntekt, trinn) {
  let skatt = 0;
  for (let i = 0; i < trinn.length; i++) {
    const [fra, sats] = trinn[i];
    const til = trinn[i + 1]?.[0] ?? Infinity;
    if (personinntekt > fra) skatt += (Math.min(personinntekt, til) - fra) * sats;
  }
  return skatt;
}

export function trygdeavgift(personinntekt, t) {
  if (personinntekt <= t.grense) return 0;
  return Math.min(personinntekt * t.sats, (personinntekt - t.grense) * t.opptrapping);
}

const snitt = (a) => (a.length ? sum(a) / a.length : 0);

export function skatteprognose(db, aar) {
  const s = satserFor(db, aar);
  const egne = db.skatt?.[aar] || {};
  const slipper = (db.inntekt?.lonnsslipper || []).filter((l) => l.mnd.startsWith(String(aar))).sort((a, b) => a.mnd.localeCompare(b.mnd));
  const sisteMnd = slipper.length ? Number(slipper[slipper.length - 1].mnd.slice(5, 7)) : 0;
  const gjenstaende = 12 - sisteMnd;
  const bruttoHittil = sum(slipper.map((l) => l.brutto || 0));
  const trekkHittil = -sum(slipper.map((l) => l.skattetrekk || 0)) || 0;
  const siste3 = slipper.slice(-3);
  const snittBrutto = egne.snittBrutto ?? snitt(siste3.map((l) => l.brutto || 0));
  const snittTrekk = snitt(siste3.map((l) => -(l.skattetrekk || 0)));
  // Desember har normalt halv skatt
  const trekkMnd = gjenstaende > 0 ? gjenstaende - 0.5 : 0;
  const bruttoAar = bruttoHittil + snittBrutto * gjenstaende;
  const trekkLonnAar = trekkHittil + snittTrekk * trekkMnd;

  // Renteutgifter: registrert overstyring, ellers saldo × rente for alle lån
  const rentePoster = db.formue.poster.filter((p) => p.side === 'gjeld' && p.rente).map((p) => {
    const v = verdiPa(p, `${aar}-12-31`);
    return { navn: p.navn, renter: (v?.verdi || 0) * p.rente };
  });
  const renteutgifter = egne.renteutgifter ?? sum(rentePoster.map((r) => r.renter));

  // Fagforening: transaksjoner i året som ser ut som fagforeningskontingent
  const fagTrans = db.transaksjoner.filter((t) => (t.betalt || t.dato || '').startsWith(String(aar)) && t.belop < 0 && /forbund|fagforening|\bnito\b|\btekna\b|parat\b|\bdelta\b|negotia|\blo\b/i.test(t.tekst));
  const fagforening = Math.min(s.fagforeningMaks, egne.fagforening ?? (-sum(fagTrans.map((t) => t.belop)) || 0));

  const andreInntekter = egne.andreInntekter || 0;
  const andreTrekk = egne.andreTrekk || 0;
  const renteinntekter = egne.renteinntekter || 0;
  const aksjeinntekt = egne.aksjeinntekt || 0;
  const andreFradrag = egne.andreFradrag || 0;
  const bsuSparing = Math.min(s.bsu.maks, egne.bsu || 0);
  const ips = Math.min(s.ipsMaks ?? 15000, egne.ips || 0);
  const gaver = (egne.gaver || 0) >= 500 ? Math.min(s.gaverMaks ?? 25000, egne.gaver) : 0;

  const personinntekt = bruttoAar + andreInntekter;
  const minstefradrag = Math.min(s.minstefradrag.maks, Math.max(s.minstefradrag.min, personinntekt * s.minstefradrag.sats));
  const alminneligInntekt = personinntekt - minstefradrag - renteutgifter - fagforening - ips - gaver - andreFradrag + renteinntekter + aksjeinntekt * s.oppjustering;
  const skattAlminnelig = Math.max(0, alminneligInntekt - s.personfradrag) * s.alminnelig;
  const trygd = trygdeavgift(personinntekt, s.trygdeavgift);
  const trinn = trinnskatt(personinntekt, s.trinn);

  // Formuesskatt med årets satser
  const f = formue(db, `${aar}-12-31`);
  let skattemessig = 0;
  for (const x of f.eiendeler) {
    if (x.verdi == null) continue;
    const p = x.post;
    if (p.type === 'pensjon') continue;
    let v = p.type === 'kjoretoy' && p.skattemessigVerdi != null ? p.skattemessigVerdi : x.verdi;
    if (['fond', 'aksjer', 'selskap'].includes(p.type)) v *= 1 - s.formue.aksjerabatt;
    if (p.type === 'bolig') v *= 1 - (p.boligRabatt ?? 0.75);
    skattemessig += v;
  }
  const nettoFormue = skattemessig - f.sumGjeld;
  const formuesskatt = Math.max(0, Math.min(nettoFormue, s.formue.hoyGrense) - s.formue.bunnfradrag) * s.formue.sats
    + Math.max(0, nettoFormue - s.formue.hoyGrense) * (s.formue.hoySats - s.formue.sats);

  const bsuFradrag = bsuSparing * s.bsu.sats;
  const sumSkatt = skattAlminnelig + trygd + trinn + formuesskatt - bsuFradrag;
  const trukket = trekkLonnAar + andreTrekk;
  const differanse = sumSkatt - trukket; // positiv = restskatt
  const ekstraTrekkProsent = differanse > 0 && gjenstaende > 0 && snittBrutto > 0 ? differanse / (snittBrutto * gjenstaende) : null;

  return {
    aar, satser: s, egne,
    slipper: slipper.length, sisteMnd, gjenstaende,
    bruttoHittil, trekkHittil, snittBrutto, snittTrekk, bruttoAar, trekkLonnAar,
    rentePoster, renteutgifter, fagforening, fagTrans: fagTrans.length,
    andreInntekter, andreTrekk, renteinntekter, aksjeinntekt, andreFradrag, bsuSparing, ips, gaver,
    personinntekt, minstefradrag, alminneligInntekt, skattAlminnelig, trygd, trinn,
    nettoFormue, formuesskatt, bsuFradrag, sumSkatt, trukket, differanse,
    effektivSats: personinntekt > 0 ? sumSkatt / personinntekt : null,
    ekstraTrekkProsent,
  };
}

// Sjekkliste over fradrag og muligheter for året. gevinst = omtrentlig lavere skatt i kr.
const GAVE_ORG = /redd barna|røde kors|rode kors|kirkens bymisjon|leger uten grenser|kreftforeningen|unicef|sos[- ]barnebyer|amnesty|wwf|norsk folkehjelp|frelsesarmeen|blå kors|bla kors|plan norge|care norge|nasjonalforeningen|redningsselskapet|kirkens nødhjelp|kirkens nodhjelp|fransiskushjelpen|hjerte ?lunge|ung ?kreft|unicef|naturvernforbundet|dyrevern|dyrebeskyttelsen/i;

export function skattesjekkliste(db, aar) {
  const t = skatteprognose(db, aar);
  const s = t.satser;
  const egne = db.skatt?.[aar] || {};
  const ut = [];
  const legg = (id, status, tittel, tekst, gevinst = null) => ut.push({ id, status, tittel, tekst, gevinst });
  const iAar = (x) => (x.betalt || x.dato || '').startsWith(String(aar));
  const kr0 = (v) => Math.round(v).toLocaleString('nb-NO');

  // IPS
  const ipsMaks = s.ipsMaks ?? 15000;
  const ipsPost = db.formue.poster.some((p) => /\bips\b|individuell pensjon/i.test(p.navn));
  const ips = egne.ips || 0;
  if (ips >= ipsMaks) legg('ips', 'ok', 'IPS', `Fullt innskudd (${kr0(ipsMaks)} kr) gir ca. ${kr0(ipsMaks * s.alminnelig)} kr lavere skatt.`);
  else legg('ips', 'mulighet', 'IPS – individuell pensjonssparing', `Innskudd opptil ${kr0(ipsMaks)} kr i året gir fradrag med ${Math.round(s.alminnelig * 100)} %.${ips ? ` Registrert i år: ${kr0(ips)} kr.` : ''} ${ipsPost ? '' : 'Du ser ikke ut til å ha IPS. '}Pengene er bundet til du er 62 år – best for langsiktig sparing du ellers ville hatt.`, (ipsMaks - ips) * s.alminnelig);

  // BSU
  const bsuPost = db.formue.poster.find((p) => p.type === 'bsu');
  const bsuSaldo = bsuPost ? verdiPa(bsuPost)?.verdi || 0 : 0;
  if (bsuPost) {
    const bsu = egne.bsu;
    if (bsuSaldo >= 300000) legg('bsu', 'ok', 'BSU', 'BSU-kontoen har nådd taket på 300 000 kr.');
    else if (bsu == null) legg('bsu', 'mulighet', 'BSU', `Sparing opptil ${kr0(s.bsu.maks)} kr i året gir ${Math.round(s.bsu.sats * 100)} % skattefradrag (maks ${kr0(s.bsu.maks * s.bsu.sats)} kr), til og med året du fyller 33. Registrer årets innskudd under «Egne justeringer», så regnes det med.`, s.bsu.maks * s.bsu.sats);
    else if (bsu < s.bsu.maks) legg('bsu', 'mulighet', 'BSU', `Du har satt inn ${kr0(bsu)} kr i år. Setter du inn ${kr0(s.bsu.maks - bsu)} kr til før nyttår, får du ${kr0((s.bsu.maks - bsu) * s.bsu.sats)} kr mer i fradrag.`, (s.bsu.maks - bsu) * s.bsu.sats);
    else legg('bsu', 'ok', 'BSU', `Fullt innskudd – ${kr0(s.bsu.maks * s.bsu.sats)} kr i fradrag.`);
  }

  // Fagforening
  if (t.fagforening > 0) legg('fagforening', t.fagforening >= s.fagforeningMaks ? 'ok' : 'info', 'Fagforeningskontingent', `${kr0(t.fagforening)} kr ${t.fagTrans ? 'funnet i transaksjonene' : 'registrert'} (maks ${kr0(s.fagforeningMaks)} kr) – fradraget kommer vanligvis automatisk fra forbundet.`);
  else legg('fagforening', 'info', 'Fagforeningskontingent', `Ingen kontingent funnet. Er du medlem, gir inntil ${kr0(s.fagforeningMaks)} kr fradrag (ca. ${kr0(s.fagforeningMaks * s.alminnelig)} kr lavere skatt). Sjekk at det står i skattemeldingen.`);

  // Gaver
  const gaveTrans = db.transaksjoner.filter((x) => iAar(x) && x.belop < 0 && GAVE_ORG.test(x.tekst));
  const gaver = egne.gaver ?? -gaveTrans.reduce((a, x) => a + x.belop, 0);
  const gaverMaks = s.gaverMaks ?? 25000;
  if (gaver >= 500) legg('gaver', 'ok', 'Gaver til frivillige organisasjoner', `${kr0(gaver)} kr i gaver i år gir ca. ${kr0(Math.min(gaver, gaverMaks) * s.alminnelig)} kr lavere skatt. Organisasjonen må ha fødselsnummeret ditt for å rapportere gaven.`);
  else legg('gaver', 'info', 'Gaver til frivillige organisasjoner', `Gaver på minst 500 kr per år til godkjente organisasjoner gir fradrag (maks ${kr0(gaverMaks)} kr). Oppgi fødselsnummer til organisasjonen.`);

  // Rentefradrag
  if (t.renteutgifter > 0) legg('renter', 'ok', 'Rentefradrag', `Renter på ca. ${kr0(t.renteutgifter)} kr gir ca. ${kr0(t.renteutgifter * s.alminnelig)} kr lavere skatt. Fylles ut automatisk fra långiverne.`);

  // Reisefradrag
  if (s.reise) {
    const km = s.reise.bunn / (s.reise.sats * 230 * 2);
    legg('reise', 'info', 'Reisefradrag hjem–jobb', `Reiser du mer enn ca. ${Math.round(km)} km hver vei til jobben (230 arbeidsdager), får du fradrag: ${String(s.reise.sats).replace('.', ',')} kr per km over ${kr0(s.reise.bunn)} kr i året.`);
  }

  // Aksjesparekonto og tap
  const ask = db.formue.poster.filter((p) => p.side === 'eiendel' && /\bask\b|aksjesparekonto/i.test(p.gruppe || ''));
  const utbytte = (db.formue.utbytte || []).filter((u) => String(u.aar) === String(aar) && /\bask\b/i.test(u.gruppe || '')).reduce((a, u) => a + u.belop, 0);
  if (ask.length) legg('ask', 'info', 'Aksjesparekonto', `Gevinst og utbytte i ASK skattes først ved uttak av mer enn innskuddet${utbytte ? ` – utbyttet på ${kr0(utbytte)} kr i år er derfor ikke skattepliktig nå` : ''}. Skjermingsfradraget beregnes automatisk.`);
  const utenforAsk = db.formue.poster.filter((p) => p.side === 'eiendel' && p.type === 'aksjer' && !/\bask\b|aksjesparekonto/i.test(p.gruppe || ''));
  if (utenforAsk.length) legg('tap', 'info', 'Tap på aksjer utenfor ASK', `Har du aksjer med tap utenfor aksjesparekonto (${[...new Set(utenforAsk.map((p) => p.gruppe))].join(', ')}), gir salg før nyttår fradrag med ${String(Math.round(s.alminnelig * s.oppjustering * 1000) / 10).replace('.', ',')} %. Innenfor ASK gir tap ingen effekt før uttak.`);
  const krypto = db.formue.poster.filter((p) => p.type === 'krypto' && p.beholdning?.length);
  for (const p of krypto) {
    const verdi = p.beholdning.reduce((a, x) => a + (x.antall || 0) * (x.kurs || 0), 0);
    const kost = p.beholdning.reduce((a, x) => a + (x.kostpris || 0), 0);
    if (kost && verdi < kost) legg(`krypto-${p.id}`, 'mulighet', `Krypto: urealisert tap i ${p.navn}`, `Tapet på ${kr0(kost - verdi)} kr gir fradrag (22 %) hvis du selger eller veksler før nyttår.`, (kost - verdi) * 0.22);
  }

  // Formuesskatt
  if (t.formuesskatt > 0) legg('formue', 'info', 'Formuesskatt', `Anslått formuesskatt ${kr0(t.formuesskatt)} kr. Aksjer og fond verdsettes til ${Math.round((1 - s.formue.aksjerabatt) * 100)} %, gjeld trekkes fra.`);
  else legg('formue', 'ok', 'Formuesskatt', `Skattemessig nettoformue (ca. ${kr0(t.nettoFormue)} kr) er under bunnfradraget på ${kr0(s.formue.bunnfradrag)} kr – ingen formuesskatt.`);

  // Restskatt
  if (t.differanse > 1000) legg('restskatt', 'mulighet', 'Restskatt', `Anslått restskatt ${kr0(t.differanse)} kr. Betaler du tilleggsforskudd innen 31. mai ${aar + 1}, slipper du rentetillegg.`);

  const rekkefolge = { mulighet: 0, info: 1, ok: 2 };
  return ut.sort((a, b) => rekkefolge[a.status] - rekkefolge[b.status] || (b.gevinst || 0) - (a.gevinst || 0));
}
