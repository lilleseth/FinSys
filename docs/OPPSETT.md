# Oppsett av FinSys – steg for steg

Du trenger bare en nettleser og GitHub-kontoen din. Det tar ca. 10 minutter.

Systemet består av to repoer:

| Repo | Innhold | Synlighet |
|---|---|---|
| `FinSys` (dette) | Selve appen – ingen økonomidata | Offentlig (kreves for gratis GitHub Pages) |
| `finsys-data` | Dine data, kryptert | **Privat** |

---

## 1. Publiser appen med GitHub Pages

1. Gå til **github.com/lilleseth/FinSys** → **Settings** → **General**.
   Sjekk at repoet er **Public** (nederst under *Danger Zone* → *Change visibility*).
   Appkoden inneholder ingen data, så dette er trygt. Har du GitHub Pro, kan repoet være privat.
2. Gå til **Settings** → **Pages**.
3. Under **Build and deployment** → **Source**: velg **Deploy from a branch**.
4. Under **Branch**: velg **main** og **/ (root)**, og trykk **Save**.
5. Etter 1–2 minutter ligger appen på **https://lilleseth.github.io/FinSys/**.

## 2. Lag det private data-repoet

1. Trykk **+** øverst til høyre på github.com → **New repository**.
2. **Repository name**: `finsys-data`
3. Velg **Private**.
4. Kryss av for **Add a README file** (repoet må ha minst én fil).
5. Trykk **Create repository**.

## 3. Lag en tilgangstoken

Tokenen gir appen lov til å lese og skrive **bare** i `finsys-data`.

1. Klikk på profilbildet ditt øverst til høyre → **Settings**.
2. Helt nederst i menyen til venstre: **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. Fyll inn:
   - **Token name**: `FinSys`
   - **Expiration**: f.eks. 1 år (du får e-post før den går ut)
   - **Repository access**: **Only select repositories** → velg `finsys-data`
   - **Permissions** → **Repository permissions** → **Contents**: **Read and write**
     (*Metadata: Read-only* settes automatisk)
5. Trykk **Generate token** og **kopier tokenen** (starter med `github_pat_`).
   Du får bare se den én gang – lagre den i passordbehandleren din.

## 4. Koble til og importer

1. Åpne **https://lilleseth.github.io/FinSys/**.
2. Fyll inn GitHub-brukernavn (`lilleseth`), repo-navn (`finsys-data`) og tokenen.
3. Velg et **passord** (minst 12 tegn, gjerne flere ord). Lagre det i passordbehandleren.
   Du får deretter en **gjenopprettingsnøkkel** – lagre den et annet trygt sted.
4. Gå til **Innstillinger** → **Velg regneark (.xlsx)** og velg `privatokonomi_oversikt.xlsx`.
5. Trykk **Importer**. Etter noen sekunder står det *Lagret* øverst til høyre.

## 5. Bruke FinSys på mobil eller en annen PC

Åpne samme adresse, fyll inn brukernavn, repo og token, og lås opp med passordet.
Kryss av for «Husk meg på denne enheten» bare på egne enheter med skjermlås. Uten avkrysning
låses appen etter 15 minutter uten aktivitet.

**Som app:** På iPhone/iPad (Safari) trykker du Del → «Legg til på Hjem-skjerm». På Android (Chrome)
velger du meny → «Installer app». På PC/Mac (Chrome/Edge) bruker du installer-ikonet i adressefeltet.
Se også Innstillinger → «Installer som app».

**Årsskiftet:** I januar importerer du det siste for desember, fryser formuen per 31.12 (Formue → «Frys måned»)
og avslutter året under Rapport → År → «Avslutt og lås». Lag så budsjett for det nye året under Budsjett
(«Fra faktisk forbruk i fjor»). Under Rapport → Sammenlign ser du årene mot hverandre.

**Token-utløp:** Skriv tokenens utløpsdato inn under Innstillinger → Datalager («Token utløper»), så
minner oversikten deg på å lage en ny tre uker før.

---

## Sikkerhet – kort forklart

- Alt krypteres i nettleseren (AES-256) **før** det sendes til GitHub. Verken GitHub eller andre kan
  lese innholdet uten passordet.
- Når du oppretter hvelvet, får du en **gjenopprettingsnøkkel**. Lagre den et trygt sted – med den
  kan du velge nytt passord hvis du glemmer det gamle.
- Tokenen lagres kryptert i nettleseren og kan bare brukes etter at du har skrevet passordet.
- **Slå på tofaktorinnlogging på GitHub-kontoen.** Det er det viktigste du kan gjøre.
- Se [SIKKERHET.md](SIKKERHET.md) for detaljer og en sjekkliste.

## Vanlige feil

| Melding | Løsning |
|---|---|
| «Tokenen er ugyldig eller utløpt» | Lag ny token (steg 3) og koble til på nytt |
| «Fant ikke repoet» | Sjekk stavemåte, og at tokenen har tilgang til `finsys-data` |
| «Repoet … er offentlig» | Gjør `finsys-data` privat: *Settings → General → Danger Zone* |
| «Filen er endret et annet sted» | Du har gjort endringer på to enheter samtidig. Last inn siden på nytt |
| «Bruk en finkornet token» | Tokenen er en klassisk token (`ghp_`). Lag en finkornet token (steg 3) |
| «Feil passord» etter passordbytte på en annen enhet | Prøv det forrige passordet én gang, eller «Bytt datalager» og koble til på nytt |
