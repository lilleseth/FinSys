# FinSys

Personlig økonomisystem i nettleseren: kontantstrøm, transaksjoner, budsjett, formue og gjeld,
formuesskatt, formueshistorikk, import av kontoutskrifter/kortfakturaer, dokumentarkiv med uttrekk av tall,
planlegging (prognose, faste utgifter, gjeldsplan, skatteprognose, sparemål og nettoformue-milepæler,
boliglån/kjøpsevne, bilkostnad), innsikt (formueendring, belåning, skjulte kostnader, avvik), utlegg og
refusjoner, skattesjekkliste, flere år med budsjett per år, årsavslutning og sammenligning, felles husholdning, krypto, garantier, uke-, måneds- og årsrapport (PDF),
eksport til regneark og kalender, påminnelser og notater. Kan installeres som app. Viderefører regnearket «Privatøkonomisk oversikt».

- **App:** https://lilleseth.github.io/FinSys/ (etter at GitHub Pages er slått på)
- **Oppsett:** [docs/OPPSETT.md](docs/OPPSETT.md)
- **Plan og arkitektur:** [docs/PLAN.md](docs/PLAN.md)
- **Sikkerhet:** [docs/SIKKERHET.md](docs/SIKKERHET.md)

Dataene lagres kryptert (AES-256-GCM) i et eget privat GitHub-repo. Dette repoet inneholder
bare appkoden – ingen økonomidata.

## Teknisk

Ren HTML/CSS/JavaScript (ES-moduler) uten byggesteg. Eneste tredjepartskode er pdf.js i `vendor/`.
For å kjøre lokalt: start en statisk webserver i rotmappen, f.eks. `python3 -m http.server`,
og åpne http://localhost:8000. Velg «Prøv uten GitHub» for å teste med lagring i nettleseren.

```
index.html            inngang
manifest.webmanifest  app-manifest (installerbar app)
sw.js                 service worker – mellomlagrer bare appens egne filer
ikoner/               app-ikoner
css/app.css           stil (lys/mørk modus)
js/main.js            oppstart, tilkobling, opplåsing, navigasjon
js/vault.js           kryptering og oppdeling av data i filer
js/crypto.js          AES-GCM / PBKDF2
js/storage/           GitHub- og lokal lagring
js/model/             kategorier, beregninger, regler, prognose, faste poster, gjeld, skatt,
                      påminnelser, rapporter og uttrekk av tall fra dokumenter
js/import/            Excel-/CSV-/PDF-lesing, bankformater, duplikatkontroll
js/views/             sidene
js/charts.js          SVG-grafer
```
