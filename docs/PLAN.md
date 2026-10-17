# FinSys – plan

Webbasert privatøkonomisystem som viderefører regnearket «Privatøkonomisk oversikt 2026».

## Arkitektur

| Del | Løsning |
|---|---|
| App | Statisk HTML/CSS/JavaScript uten byggesteg, servert fra GitHub Pages (dette repoet) |
| Data | Eget **privat** GitHub-repo (f.eks. `finsys-data`), lest og skrevet via GitHub API med en finkornet token |
| Kryptering | Alt krypteres i nettleseren med AES-256-GCM og en tilfeldig datanøkkel, pakket inn med passord (PBKDF2 600 000 runder) og gjenopprettingsnøkkel. Se SIKKERHET.md |
| AI | Claude API kalt direkte fra nettleseren med brukerens egen API-nøkkel (fase 4) |
| Avhengigheter | Kun pdf.js (Mozilla, lagt i `vendor/`, lastes bare ved PDF-import). Grafer, Excel-lesing og kryptering er skrevet i appen selv |

Lagringslaget er utskiftbart (`js/storage/`). I tillegg til GitHub finnes en lokal modus
(nettleserens IndexedDB) for testing og demo.

### Filer i data-repoet

```
finsys.json                     ukryptert: format, salt og innpakkede nøkler (ingen økonomidata)
data/oppsett.enc                kontoer, kategorier, innstillinger
data/transaksjoner-ÅÅÅÅ.enc     én fil per år (etter betalingsdato)
data/formue.enc                 eiendeler, gjeld, verdihistorikk, månedlige øyeblikksbilder
data/inntekt.enc                lønnsslipper
data/notater.enc                notater og huskeliste
data/dokumenter.enc             dokumentregister (tittel, type, dato, søketekst, koblinger)
dokumenter/d-….enc              selve dokumentfilene, kryptert
```

Hver lagring blir en commit, så all historikk kan spores og gjenopprettes.

## Datamodell (kort)

- **Transaksjon**: konto, kjøpsdato, betalingsdato, forfall, tekst, beløp, kategori, etiketter, notat, kilde
- **Kategori**: hovedkategori (type: inntekt / utgift / nøytral / sparing / overføring) med underkategorier
- **Konto**: brukskonto, sparekonto, BSU, kredittkort …
- **Formuespost**: eiendel eller gjeld, type, gruppe (f.eks. «Pareto ASK»), rente, skatteinfo og datert verdihistorikk
- **Øyeblikksbilde**: frosne månedsverdier (formueshistorikk)
- **Lønnsslipp**, **notat**, **budsjett** (fase 2), **dokument** (fase 3)

### Kategorityper

| Type | Teller i | Eksempel |
|---|---|---|
| inntekt | inntekt, netto kontantstrøm | Lønn, sideinntekt |
| utgift | forbruk, netto kontantstrøm | Mat, bil, abonnementer |
| nøytral | kun netto kontantstrøm | Utlegg som refunderes, Vipps-oppgjør, kort-tidsforskyvning |
| sparing | «herav investert» | Innskudd til Pareto/Nordnet |
| overføring | ingenting | Interne overføringer, betaling av kortfaktura |

Netto kontantstrøm per betalingsmåned tilsvarer radene 8–30 i Kontantstrøm-arket.

## Faser

1. **Fundament** *(ferdig)*: innlogging/kryptering, GitHub-lagring, import av regnearket,
   transaksjoner, kontantstrøm (kjøps- og betalingsmåned), formue og gjeld, formuesskatt, dashboard, notater
2. **Import og budsjett** *(ferdig)*: import av Nordea-CSV, kortfakturaer i PDF (Nordea Premium, DNB,
   Trumf) og generell CSV/Excel med kolonnevalg; kontroll mot fakturasum; duplikatkontroll (dato+beløp
   og referansenummer); automatisk kategorisering (egne regler → historikk → kjente brukersteder →
   betalingstype → valuta); avstemming mot registrert kontosaldo; budsjett per kategori med varsler
3. **Dokumentarkiv** *(ferdig, uten AI)*: opplasting av PDF/bilder/CSV (kryptert, egne filer i
   `dokumenter/`), automatisk komprimering av store bilder, tekstuttrekk fra PDF for søk, gjetting av
   type og dato, forhåndsvisning, kobling til transaksjoner (også finn på beløp) og formuesposter,
   automatisk arkivering av importerte bankfiler
3b. **Tolking av dokumenter uten AI** *(ferdig, generell)*: «Hent tall fra dokumentet» for lønnsslipp,
   lån, porteføljerapport og skatteoppgjør. Leter etter nøkkelord (bruttolønn, forskuddstrekk, utbetalt,
   restgjeld, nominell rente, terminbeløp, markedsverdi, beregnet skatt, restskatt …) og viser tallene i et
   kontrollskjema før de lagres. Tolkerne finjusteres når vi har ekte eksempler av hvert dokument.
   Manuell registrering av lønnsslipp under Kontantstrøm
3c. **Månedsrapport** *(ferdig)*: nøkkeltall mot forrige måned og 6-måneders snitt, automatisk skrevet
   oppsummering, kategorier, avvik, største poster, nye steder, budsjett, formue og gjeld, lønn,
   huskeliste og datagrunnlag. Lagres som PDF via nettleserens utskrift (A4, alltid lys)
4. **AI** *(utsatt – valgfritt senere)*: tolking av PDF-er og kvitteringer (lønnsslipp, lånebrev, meglerrapport, kortfaktura),
   kategoriforslag, månedlig kommentar, spørsmål i fritekst, råd om gjeld og investeringer
5. **Planlegging og skatt** *(ferdig)*: egen side «Planlegging» med
   - *Prognose*: 3–24 måneder ut fra faste poster + snittforbruk (eller budsjett) + planlagte engangsposter,
     varsel når saldoen går under valgt minstesaldo
   - *Faste utgifter*: gjentakende trekk og inntekter funnet automatisk, kostnad per måned/år, prisøkninger
     og stoppede abonnementer
   - *Gjeldsplan*: nedbetalingstid og renter per lån, +1/+2 prosentpoeng rente, effekt av ekstra innbetaling,
     «nedbetale eller investere?»
   - *Skatt*: skatteprognose for året (satser 2025/2026, kan overstyres), restskatt/tilgode, råd om
     tilleggsforskudd og trekkprosent, egne justeringer, sammenligning med faktisk skatteoppgjør
   - *Sparemål*: mål med frist, fremdrift fra kontoer/poster eller manuelt, nødvendig sparing per måned
   - Avkastning per investeringskonto (innskutt mot verdi) under Formue og gjeld
   - Årsrapport med skattemeldingssjekkliste (Rapport → År), lagres som PDF
   - Påminnelser på oversikten (import, frys måned, utdaterte saldoer, budsjett, prisøkning, restskatt,
     skattemelding, likviditet, tokenutløp, huskeliste) – kan skjules i 30 dager
   - Installerbar app (PWA) med offline-start; bare appens egne filer mellomlagres
6. **Husholdning, bolig og eksport** *(ferdig)*:
   - *Felles husholdning*: felles kategorier/kontoer eller enkelttransaksjoner, fast fordeling eller etter
     inntekt, den andres utlegg, oppgjør (manuelt eller merket transaksjon) og løpende saldo per måned
   - *Boliglån og kjøpsevne* (Planlegging): maks lån etter gjeldsgrad (5 × inntekt), egenkapital (10 %) og
     stresstest (+3 pp), månedskostnad og sjekkliste for valgt boligpris
   - *Bilkostnad* (Planlegging): drift fra transaksjoner, renter på billån, forsikring og verditap – per år,
     måned og km (km-stand registreres)
   - *Nettoformue-milepæler* (Sparemål): når neste milepæler nås med dagens trend og med sparing + avkastning;
     sparemål kan kobles til nettoformuen
   - *Krypto*: beholdning med antall, kurs og kostpris per mynt, urealisert gevinst og skatt
   - *Garanti og reklamasjon* på kvitteringer, oversikt under Dokumenter og påminnelse før utløp
   - *Eksport*: regneark (.xlsx med sju ark), CSV fra transaksjonslisten og kalenderfil (.ics)
   - *Ukeoppsummering* på oversikten og som rapport (Rapport → Uke)

7. **Innsikt** *(ferdig)*:
   - *Formueendring*: hvor økningen kom fra – bank, innskudd, nedbetaling, avkastning (etter kreditt), pensjon,
     kjøretøy og annet – per periode mellom frosne måneder
   - *Belåning*: belåningsverdi, margin og hvor mye markedet kan falle per depot; scenarier −10 til −50 % med
     beløp som må skytes inn; belåningsgrad per verdipapir kan registreres
   - *Skjulte kostnader*: gebyrer, renter etter fradrag, termingebyr, valutapåslag på kort, fondskostnader og kurtasje
   - *Uvanlige transaksjoner*: mulige dobbeltbelastninger, uvanlig store beløp, nye faste trekk, prisøkninger,
     gebyrer og manglende refusjoner
   - *Utlegg og refusjoner* (egen side): utestående per motpart, refusjoner fordelt på eldste utlegg, startdato og
     startsaldo per motpart, påminnelse etter 30 dager
   - *Skattesjekkliste* (Planlegging → Skatt): IPS, BSU, fagforening, gaver, rentefradrag, reisefradrag, ASK,
     tap utenfor ASK, krypto, formuesskatt og restskatt – med anslått skattebesparelse

## Forslag til videre utvidelser

| Forslag | Nytte |
|---|---|
| Eksakte tolkere per dokument | Lønnsslipp, Lånekassen, Nordea Finans, Pareto/Nordnet, skatteoppgjør – krever ett eksempel av hvert |
| Ekte avkastning mot indeks | Tidsvektet avkastning per konto mot OSEBX/verdensindeks |
| «Hva om»-simulator | Lønnsøkning, ny bil, jobbskifte, rente – effekt på kontantstrøm og formue |
| Robusthet ved inntektsbortfall | Hvor mange måneder du klarer deg uten lønn |
| Pensjons- og FIRE-prognose | Når kan du bli økonomisk uavhengig med dagens sparerate og forventet avkastning? |
| Delt husholdning med egen innlogging | Den andre personen får egen tilgang til et felles, kryptert husholdningsregnskap |
| Import fra kryptobørs | Beholdning og kostpris rett fra Firi/Coinbase-eksport |
| AI (valgfritt senere) | Tolking av alle PDF-er og kvitteringsbilder, kommentarer og spørsmål i fritekst |
