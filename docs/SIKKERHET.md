# Sikkerhet i FinSys

Kort oversikt over hvordan dataene beskyttes, hva som er testet, og hva du selv må gjøre.
Ingen løsning er hundre prosent sikker, men målet er at dataene skal være trygge selv om én
del (GitHub-repoet, tokenen eller en enhet) kommer på avveie.

## Hvordan dataene beskyttes

| Lag | Beskyttelse |
|---|---|
| Data i GitHub | Alt krypteres i nettleseren med AES-256-GCM **før** det sendes. GitHub ser bare uleselige `.enc`-filer. |
| Nøkler | En tilfeldig datanøkkel krypterer alt. Den pakkes inn med passordet (PBKDF2-SHA256, 600 000 runder) og med en gjenopprettingsnøkkel (160 bit tilfeldighet). |
| Integritet | Hver fil er bundet til filstien sin. Ombyttede, endrede eller eldre filer uten binding avvises. |
| Token | Lagres kryptert med datanøkkelen i nettleseren. Uten passord (eller husket nøkkel) kan den ikke brukes. Bare finkornede tokens godtas. |
| Enheten | «Husk meg» lagrer nøkkelen som ikke-eksporterbar nøkkel i nettleseren. Uten «husk meg» låses appen etter 15 minutter uten aktivitet og når fanen lukkes. |
| Nettleseren | Streng innholdssikkerhetspolicy (CSP): bare appens egne skript og kun nettverkskall til `api.github.com`. Ingen eksterne biblioteker lastes fra nett (pdf.js ligger i repoet). Brukerdata settes aldri inn som HTML. |
| Passordstyrke | Nye passord sjekkes lokalt mot vanlige passord, navn, ord, årstall, datoer, tastaturmønstre, gjentakelser og brukernavnet. Måleren viser omtrent hvor lenge en angriper må gjette, og passord som kan knekkes på under ett døgn med 1 000 grafikkort avvises. «Foreslå et sterkt passord» lager seks tilfeldige ord (ca. 60 bit). |
| Innramming | Appen nekter å vises inne i andre nettsider. |
| Installert app | Service workeren mellomlagrer bare appens egne filer (HTML/CSS/JS/ikoner) for offline-start. Kall til `api.github.com` og dataene dine går aldri gjennom den. Ny appversjon hentes alltid først når du er på nett. |
| Metadata | Commit-meldinger i data-repoet inneholder ikke filnavn eller beløp. |

**Passordbytte** pakker inn datanøkkelen på nytt. **Nøkkelrotasjon** (Innstillinger → Avansert)
lager en ny datanøkkel og krypterer alt på nytt. Bruk det hvis et gammelt passord eller en
gjenopprettingsnøkkel kan være lekket, siden gamle versjoner ligger i git-historikken.

## Testet

Automatiske tester i nettleseren (mot en simulert GitHub) bekrefter blant annet:
- oppgradering fra eldre format uten tap av data, og at tokenen deretter ikke ligger i klartekst
- at ingen GitHub-kall skjer før passordet er skrevet når appen er låst
- at feil passord, svake passord, klassiske tokens og offentlige data-repoer avvises
- gjenoppretting med gjenopprettingsnøkkel, passordbytte og at gamle passord/nøkler slutter å virke
- at ombyttede filer og filer uten integritetsbinding avvises
- nøkkelrotasjon, også når den avbrytes midt i, og at en annen enhet tilpasser seg
- automatisk låsing etter 15 minutter og at appen ikke kan rammes inn

## Det du selv må gjøre

Den største risikoen er **GitHub-kontoen din**: den som overtar den, kan endre appkoden og
fange passordet neste gang du låser opp.

1. **Slå på tofaktorinnlogging på GitHub** (Settings → Password and authentication). Viktigst av alt.
2. Bruk et sterkt, unikt passord på GitHub og på e-postkontoen som kan nullstille det.
3. Lagre FinSys-passordet i en passordbehandler. Oppbevar **gjenopprettingsnøkkelen et annet sted**
   (f.eks. utskrevet hjemme), ikke i data-repoet.
4. Bruk «Husk meg» bare på egne enheter med skjermlås og diskkryptering (standard på iPhone/Android;
   slå på BitLocker/FileVault på PC/Mac).
5. Hold nettleseren oppdatert og vær forsiktig med nettleserutvidelser som kan «lese og endre data
   på alle nettsteder» – de kan i prinsippet lese det som vises på skjermen.
6. Gi tokenen utløpsdato (f.eks. 1 år) og skriv datoen inn under Innstillinger → «Token utløper», så
   får du påminnelse tre uker før. Mister du en enhet: slett tokenen på GitHub, lag ny, og
   vurder nøkkelrotasjon.
7. Ukrypterte sikkerhetskopier (JSON) bør oppbevares trygt og slettes når de ikke trengs.
   Data-repoet er allerede en kryptert sikkerhetskopi med full historikk.
8. Sjekk av og til at **Enforce HTTPS** er på under Settings → Pages (standard for github.io).

## Kjente begrensninger

- En husket nøkkel på en ulåst enhet gir tilgang – akkurat som en innlogget nettbank.
- Den som har både tilgang til data-repoet og et gammelt passord, kan lese versjoner fra før
  passordet ble byttet. Nøkkelrotasjon fjerner denne risikoen for nye data.
- Filnavn i data-repoet (`transaksjoner-2026.enc`), filstørrelser og tidspunkt for lagring er synlige
  for den som har tilgang til repoet, men ikke innholdet.
- Stilark tillater innebygde stiler (`style-src 'unsafe-inline'`) fordi grafene trenger det. Skript gjør det ikke.
