# ROOLI JA TAVOITE
Olet kokenut AI-, 3D-geometria- ja full stack -insinööri VEO360 AutoTag -hackathon-tiimissä. Teet uuden ominaisuuden **pohjapiirros (Floor plan)**: huoltomies, huoltosuunnittelija ja VEOn asiakasluovutus näkevät koko sähkötilan releet yhdellä silmäyksellä ylhäältä päin. Jokainen rele on oikeassa paikassaan pistepilvestä lasketussa pohjapiirroksessa, ja klikkauksesta pääsee samaan sivupaneeliin ja digitaaliseen kaksoseen kuin muualla sovelluksessa.

Vastaa minulle suomeksi. Kaikki käyttöliittymätekstit englanniksi. Perustele jokainen päätös, nimeä riskit ja anna lähde muodossa `tiedosto:rivi`.

**Miksi tämä vastaa VEOn haasteeseen:** VEO haluaa tagien parantavan "navigation, maintenance planning and operational efficiency". Twin näyttää yhden panoraaman kerrallaan, pohjapiirros koko operaation. Pitchin ketju laajenee: **Scan → Tags → Devices on a floor plan → History → Action.** Samalla se vastaa kysymykseen "62 automaattitagia, montako relettä?". Vastaus on yksi laite = yksi merkki, ei yksi tunnistus = yksi merkki.

# YMPÄRISTÖ JA RAJAT (lue ensin)
- Olen Windowsilla. Käytä PowerShellissä toimivia komentoja.
- Repo: `https://github.com/santeri06/pixel-perfect-replica`. Main on synkronoitu Lovableen. **Älä pushaa mainiin, älä mergeä mainiin, älä force-pushaa.** Tarkistan aamulla.
- Työkansio on `C:\Users\arttu\dev\autotag-floorplan` (luotu skriptillä `setup_floorplan.ps1`), haara `feat/floorplan` on jo olemassa ja seuraa `origin/feat/floorplan`:ia. Kirjaa todellinen HEAD ja mainin HEAD.
- Toinen Claude Code -istunto työskentelee kansiossa `C:\Users\arttu\dev\pixel-perfect-replica` (CV-putki). **Älä koske siihen kansioon lainkaan.** Pistepilvi on kopioitu omaan työkansioosi (alla).
- Riippuvuudet: `bun install --frozen-lockfile`. **`npm install` kaatuu tässä repossa npm-bugiin** (`Cannot read properties of null (reading 'edgesOut')`, johtuu `package.json`:n `overrides`-kentästä). Bunin asennuksen jälkeen `npm run build` ja `npm test` toimivat normaalisti.
- Pythonille oma venv: `cv/floorplan/.venv` (Python 3.12, kuten `cv/README.md`). Älä käytä toisen kloonin venviä.

# LÄHTÖDATA (vain luku)
| Data | Polku | Huom. |
|---|---|---|
| Pistepilvi | `C:\Users\arttu\dev\autotag-floorplan\cv\data\raw\cloud_0.e57` | 2,2 Gt, 18 skannausta ja niiden poosit. `cv/.gitignore` sulkee `data/raw/`-kansion pois gitistä. Varmista `git check-ignore -v cv/data/raw/cloud_0.e57`. **Älä koskaan committaa sitä.** |
| Skannauspisteet | `src/data/panoramas.json` | `scanPointId`, `position` = kameran keskipiste maailmakoordinaateissa (z ylös, metrit, z ≈ 1,45). `public/panoramas/index.json`:ia ei ole repossa; se on gitignoroidussa `cv/outputs/panoramas/`-kansiossa. |
| Panoraamat | `public/panoramas/scan-XX/equirect.jpg` | 4096×2048, kohdistettu samaan ilmansuuntaan, joten northOffsetia ei tarvita. |
| Tunnistukset | `src/data/detections.json` | Kentät: `id, scanPointId, image, assetTypeId, ocrText, confidence, bbox, pitch, yaw, documents`. **Tiedostossa ei ole `status`-kenttää.** Status lasketaan kuten `src/data/detections.ts`: `confidence >= 0.75` → `"auto"`, muuten `"review"`. Selaimessa tulevat lisäksi tilat `"confirmed"` ja `"rejected"`. |
| Laiterekisteri (DEMO) | `src/data/registry.generated.json` | 5 huoltokirjan relettä (`DEMO-REL-01…05`), 3D-sijainti (`position`) ja ankkurit. Generoidaan skriptillä `scripts/build-registry.mjs`. |

Datan määrä tarkistushetkellä (3.10. klo 19.45): 74 tunnistusta, joista 62 automaattisia, 18 skannauspistettä. CV-istunto voi päivittää `detections.json`:n. Lue aina tuorein.

# NYKYTILA, JOHON RAKENNAT (tarkista koodista, älä oleta)
- **Digital Twin:** `src/routes/twin.tsx`. Syvälinkki `/twin?scan=scan-06&detection=d14&from=review` valitsee skannauspisteen, kääntää näkymän tagiin (hfov 60), korostaa sitä noin 3 s ja avaa sivupaneelin.
  - `validateSearch` hyväksyy nyt vain `from: "review"`.
  - Sivupaneelin paluupainike "Back to review queue" tekee history back -siirtymän.
- **Pannellum-katselin:** `src/components/PanoramaViewer.tsx`. Siinä on `focus`-prop ja CSS-luokat `.veo-pin`, `.veo-high` (vihreä), `.veo-mid` (oranssi), `.veo-confirmed` (sininen) ja `.veo-focus` (`src/styles.css`).
- **Sivupaneeli:** `src/components/AssetSheet.tsx` (prop `backToReview`). Se näyttää:
  - laitteen rekisteristä
  - huoltokirjan (`src/components/MaintenanceLog.tsx`)
  - variantin mukaiset manuaalit
  - painikkeen "Create support ticket"
- **Tunnistus → laite:** `src/lib/resolveInstance.ts`. Ajetaan kerran latauksessa `src/lib/store.tsx`:ssä, joka asettaa `Detection.instanceId`:n. Toleranssi on 5°, ja epäselvää osumaa ei linkitetä.
- **Huoltotila:** `deviceStatus()` (`src/data/maintenance.ts`) ja `useMaintenanceFile()` (`src/lib/useMaintenance.ts`).
- **Tila:** `src/lib/store.tsx` (React context). Review Queuen päätökset (confirmed/rejected) elävät siellä.
- **Navigaatio:** `src/components/AppShell.tsx`, `nav`-taulukko. Santeri muokkaa tätä Lovablessa, joten tee mahdollisimman pieni muutos.
- **Kolmiomittaus:** `scripts/build-registry.mjs` sisältää funktiot `clusterDetections()`, `leastSquaresPoint()`, `dirFromYawPitch()` ja `angularDistDeg()`. Käytä niitä vertailukohtana ja varamenetelmänä. **Älä muuta tämän skriptin käyttäytymistä.**

# KOORDINAATISTO (vahvistettu tähän asti, varmista loput itse)
- Maailma: z ylös, metrit. Kaikki skannaukset ja panoraamat ovat samassa maailmakoordinaatistossa.
- Suunta yaw/pitch asteina, Pannellum-konventio (`cv/geometry.py`, `dir_to_yaw_pitch` / `yaw_pitch_to_dirs`):
  - **yaw 0 = maailman +Y, positiivinen oikealle (+X), pitch positiivinen ylös**
  - `dir = (sin(yaw)·cos(pitch), cos(yaw)·cos(pitch), sin(pitch))`
  - `yaw = atan2(dx, dy)`, `pitch = asin(dz / |d|)`
- Equirect-kuvan pikseli (sama kuin `AssetSheet`:n `useCrop`): `u = (yaw/360 + 0.5)·W`, `v = (0.5 − pitch/180)·H`.
- Tämä on vahvistettu kahdella tavalla:
  - eri skannauspisteiden säteet leikkaavat millimetrien tarkkuudella
  - CI:n e2e-testissä syvälinkki keskittää tagin näkymän keskelle 0 px:n tarkkuudella
- **Varmistamatta:** onko E57:n pistepilven koordinaatisto täsmälleen sama kuin kuvien poosien. Vaihe A3 varmistaa tämän ennen kuin mitään lasketaan.
- Skannausindeksiä ei voi suoraan yhdistää `scanPointId`:hen. `scan-00…17` on numeroitu kuvien käännösjärjestyksessä (`cv/geometry.py`, `load_poses`). **Yhdistä skannaus skannauspisteeseen lähimmän translaation perusteella**, älä indeksillä.

# VERTAILUARVOT (kolmiomittaus nykydatalla, laskettu `clusterDetections()`:llä)
Käytä näitä vain järkevyystarkistukseen. **Älä kopioi niitä tulokseksi.** Oikea tulos lasketaan pistepilvestä.

| Ryhmä | x | y | z | Näkymiä | Auto | Rekisteri |
|---|---|---|---|---|---|---|
| Seinärivi, rele 1 | −5,70 | −5,86 | 1,85 | 8 | 7 | DEMO-REL-01 |
| Seinärivi, rele 2 | −5,72 | −4,79 | 1,85 | 10 | 8 | – |
| Seinärivi, rele 3 | −5,72 | −3,78 | 1,84 | 12 | 11 | DEMO-REL-02 |
| Seinärivi, rele 4 | −5,72 | −2,79 | 1,84 | 11 | 11 | DEMO-REL-03 |
| Seinärivi, rele 5 | −5,72 | −1,79 | 1,84 | 10 | 10 | DEMO-REL-04 |
| Vastapäätä, alempi | −2,75 | −5,93 | 1,43 | 9 | 9 | DEMO-REL-05 |
| Vastapäätä, ylempi | −2,74 | −5,93 | 1,73 | 9 | 6 | – |
| Vain review | −0,70 | −8,55 | 1,97 | 2 | 0 | – (todennäköisesti väärä osuma) |
| + 3 yhden näkymän review-tunnistusta | – | – | – | 1 | 0 | – |

Odotettu rakenne: **7 relettä, joilla on automaattitunnistus** (5 releen rivi 1 m välein, 2 päällekkäin vastapäätä), 1 epäilyttävä ryhmä ja 3 yksittäistä tunnistusta.

**Sudenkuoppa:** päällekkäiset releet ovat vain noin **0,30 m** päässä toisistaan pystysuunnassa. Yhdistämissäde 0,3 m yhdistäisi ne virheellisesti yhdeksi laitteeksi. Katso A6.

# EHDOTTOMAT SÄÄNNÖT
1. **Älä muokkaa:**
   - `/cv`-kansion olemassa olevia tiedostoja (`cv/floorplan/` on uusi kansio)
   - `src/data/detections.json`
   - `src/data/panoramas.json`
   - `public/panoramas/**`
   - `src/data/registry.generated.json`
   - `scripts/build-registry.mjs`
2. **Uudet tiedostot vain näihin paikkoihin:**
   - `cv/floorplan/*`
   - `public/floorplan/*`
   - `src/data/floorplan.json`
   - uusi route ja uudet komponentit
   - pienet, perustellut muutokset näihin: `AppShell.tsx` (1 nav-rivi), `AssetSheet.tsx`, `twin.tsx` (`from`-parametri), `styles.css` ja testit
3. **Älä keksi sijainteja.** Jos laskenta ei ole luotettavaa:
   - kerro, mitä yritit ja miksi se ei riittänyt
   - **älä pushaa arvattua dataa**
   - UI pushataan silti, ja se näyttää tyhjän tilan ilman floorplan.jsonia (B10)
4. **Jokaisella P0-tehtävällä on hyväksymiskriteeri.** Tehtävä on valmis vasta, kun kriteeri on todennettu.
5. **Pidä `floorplan.png` alle 1 Mt** ja `floorplan.json` alle 100 kt.
6. **Jos jokin ei selviä tiedostoista, kirjaa se avoimeksi kysymykseksi.** Älä arvaa.
7. **Committaa jokaisen vaiheen jälkeen erikseen.** Ennen pushia: `git fetch` + `git merge origin/main` (EI rebase). Jos tulee konflikteja, säilytä Santerin muutokset (myös englanninkieliset tekstit) ja lisää omasi niiden päälle.

# VAIHE 0 – LÄHTÖTILANNE
1. `cd C:\Users\arttu\dev\autotag-floorplan; git switch feat/floorplan; git pull`, kirjaa HEAD. Aja `bun install --frozen-lockfile; bun run build; bun run test` ja kirjaa tulos lähtötasoksi.
2. Avaa `cloud_0.e57` pye57:llä ja tulosta seuraavat. Älä vielä lue pisteitä.
   - skannausten määrä
   - jokaisen skannauksen pisteiden määrä
   - onko RGB-värejä tai intensiteettiä
   - headerin translaatio ja rotaatio
3. Vertaa skannausten translaatioita `panoramas.json`:n `position`-arvoihin: lähimmän parin etäisyys jokaiselle. **Hyväksyntä: jokaiselle 18 skannaukselle löytyy yksikäsitteinen pari alle 0,10 m:n päästä.** Muussa tapauksessa pysähdy ja raportoi.

# VAIHE A – DATA (Python, kansio `cv/floorplan/`)
Tiedostot:
- `cv/floorplan/build_floorplan.py` (pääskripti)
- `cv/floorplan/geom.py` (konventiot ja säteet)
- `cv/floorplan/requirements.txt` (lisäriippuvuudet, esim. `scipy`, `pillow`; `pye57` ja `numpy` kuten `cv/requirements.txt`)
- `cv/floorplan/.gitignore`: `.venv/`, `cache/`, `*.npz`

Saat importata funktioita olemassa olevasta `cv/geometry.py`:stä, mutta älä muokkaa sitä.

## A1. Ajettavuus
```powershell
cd C:\Users\arttu\dev\autotag-floorplan\cv\floorplan
py -3.12 -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r ..\requirements.txt -r requirements.txt
python build_floorplan.py --e57 ..\data\raw\cloud_0.e57
```
Lisää valitsimet `--voxel 0.04`, `--width 1600` ja `--cache` (tallentaa harvennetun pilven `cache/cloud_voxel.npz`:ään, jotta uudelleenajo on nopea).

## A2. Lataus ja harvennus (muisti!)
- Lue skannaus kerrallaan: `read_scan(i, ignore_missing_fields=True, colors=<jos on>)`. Tarkista, että `transform=True` palauttaa maailmakoordinaatit. Vertaa skannauksen pisteiden keskiarvoa ja translaatiota järkevyyden vuoksi.
- Muunna heti float32-muotoon ja harvenna voxeliin 3–5 cm: `keys = floor(xyz/voxel)` → `np.unique(..., return_index=True)`. Säilytä väri, jos sellainen on. Vapauta raakadata ennen seuraavaa skannausta (`del`, `gc.collect()`).
- Jos yksi skannaus ei mahdu muistiin, lue se osissa tai harvenna rivi- tai sarakeindekseillä ja kirjaa se.
- Raportoi: pisteitä ennen ja jälkeen harvennuksen sekä muistin huippukäyttö.

## A3. KONVENTIOTARKISTUS (portti: älä jatka ennen kuin tämä menee läpi)
Tarkista kolme skannauspistettä eri puolilta huonetta, esim. `scan-01`, `scan-07` ja `scan-12`:
1. Laske pistepilven pisteille yaw/pitch skannauspisteen `position`:sta yllä olevilla kaavoilla. Ota vain pisteet 0,4–8 m:n etäisyydeltä.
2. Renderöi niistä 2048×1024-equirect: väri, jos sellainen on, muuten syvyys harmaasävynä. Käytä lähintä pistettä per pikseli (z-buffer).
3. Sekoita kuva 50/50 tiedoston `public/panoramas/scan-XX/equirect.jpg` (skaalattu 2048×1024:ään) kanssa ja tallenna `cv/floorplan/check_reprojection_scan-XX.png`.
4. Mittaa kohdistus: reunakuvien (Sobel) ristikorrelaatio yaw-suunnassa ja pitch-suunnassa.
   - **Hyväksyntä: siirtymä alle 0,5° molempiin suuntiin, eikä kuva ole peilikuva.**
   - Jos kuva on peilattu tai siirtynyt vakiokulman verran, korjaa konventio `geom.py`:ssä, dokumentoi korjaus ja aja tarkistus uudelleen.
5. Lisätarkistus: ota 5 tunnistusta (eri skannauspisteistä) ja piirrä niiden yaw/pitch-kohta reprojektiokuvaan. Merkin pitää osua releen etupaneeliin.

## A4. Lattia ja pohjapiirroskuva
1. **Lattian korkeus:** z-histogrammi (1 cm:n bin). Lattia on alin tiheä huippu.
   - Tarkista: kameran korkeus lattiasta (`position.z − floor`) on jokaisella skannauspisteellä välillä 1,0–1,8 m. Muuten raportoi.
2. **Rajat (bounds):** lattiakerroksen pisteiden 0,5.–99,5. persentiili + 0,3 m marginaali.
   - Varmista, että kaikki skannauspisteet ja laitteet mahtuvat rajojen sisään. Leikkaa ikkunoiden ja ovien läpi näkyvät kaukaiset pisteet pois.
3. **Kerrokset:**
   - *Lattia/kulkualue:* pisteet välillä lattia ± 0,05 m → vaalea `rgba(148,163,184,0.35)`. Kertoo huoneen muodon ja kulkualueen.
   - *Esteet:* pisteet välillä lattia + 0,3 … lattia + 2,0 m → tumma `#3a4150`. Pikseli on varattu, jos siihen osuu vähintään 3 pistettä; säädä kohinan mukaan ja dokumentoi.
   - Siivoa: morfologinen avaus 1 px, valinnainen dilaatio 1 px. Läpinäkyvä tausta.
4. **Resoluutio ja suunta:**
   - Leveys noin 1600 px, `metersPerPixel = (xMax − xMin)/1600`.
   - **Kuvan x oikealle = maailman +X, kuvan y alas = maailman −Y**, eli +Y ja yaw 0 osoittavat kartalla ylös.
   - `px = (x − xMin)/mpp`, `py = (yMax − y)/mpp`.
5. Tallenna `public/floorplan/floorplan.png`. Käytä palettikvantisointia (esim. 16 väriä) ja `optimize=True`. **Alle 1 Mt.**

## A5. Releiden 3D-sijainti (säteen ensimmäinen osuma pistepilveen)
Jokaiselle tunnistukselle, myös review-tunnistuksille:
1. **Säde:** origo = skannauspisteen `position` (sama piste, josta yaw/pitch on laskettu), suunta = `dir(yaw, pitch)`.
2. **Ehdokkaat:** KD-puu (`scipy.spatial.cKDTree`) harvennetusta pilvestä. Näytteistä säde 2–3 cm:n välein välillä t = 0,4…10 m. Kerää pisteet, joiden kohtisuora etäisyys säteestä on alle `max(0.03, t·tan(0.6°))`.
3. **Ensimmäinen osuma:** pienin t, jonka ympärillä (±5 cm säteen suunnassa) on vähintään 8 pistettä. Osuma = näiden pisteiden mediaani. Tallenna myös:
   - `t` (etäisyys)
   - `support` (pisteiden määrä)
   - `spread` (hajonta)
4. **Järkevyys:** osuman pitää olla skannerin edessä ja etäisyyden 0,4–8 m.
   - Releen etupaneelin korkeus lattiasta on tyypillisesti 1,2–2,0 m, mutta älä hylkää tällä perusteella; liputa poikkeama.
5. **Varamenetelmä:** jos osumaa ei synny (heijastava paneeli, puuttuvat pisteet, säde menee raosta):
   - käytä kolmiomittausta saman laitteen muiden tunnistusten kanssa: sama logiikka kuin `clusterDetections()`:ssä (säteiden lähin kohta, aukko alle 5 cm, kulma vähintään 10°, pienimmän neliösumman piste)
   - merkitse `method: "triangulation"`
   - jos tunnistus on yksittäinen eikä osu, merkitse se sijainnittomaksi (`unlocated`). **Älä arvaa etäisyyttä.**
6. **Ristiintarkistus:** jos laitteella on sekä raycast- että kolmiomittaussijainti, laske niiden etäisyys.
   - **Hyväksyntä: mediaani alle 0,10 m.** Jos ero on suurempi, selvitä ennen jatkamista, kumpi on väärässä.

## A6. Samojen releiden yhdistäminen (yksi laite = yksi `deviceId`)
1. **Klusteroi osumapisteet 3D:ssä:** DBSCAN-tyyppisesti tai union-find. **eps = 0,15 m, EI 0,3 m**, koska päällekkäiset releet ovat noin 0,30 m:n päässä toisistaan.
2. **Cannot-link:** kaksi tunnistusta *samasta kuvasta* (sama `scanPointId` ja `image`), joiden kulmaetäisyys on yli 3°, ovat aina eri laitteita.
3. **Sama laite päällekkäisistä näkymistä:** saman skannauspisteen tunnistukset alle 3°:n kulmaetäisyydellä yhdistetään (näkymät menevät päällekkäin).
4. **Laitteen sijainti:** jäsenten osumapisteiden mediaani. `positionSpread` = jäsenten etäisyyksien mediaani keskipisteestä.
5. **Status (offline):** `"auto"`, jos yksikin jäsen on automaattinen (`confidence >= 0.75`), muuten `"review"`. Selain päivittää tämän elävillä päätöksillä (B2).
6. **`bestDetectionId`:** suurimman varmuuden jäsen. Tasatilanteessa lähin skannauspiste.
7. **Pysyvät ID:t:** jos `src/data/floorplan.json` on jo olemassa, sovita uudet laitteet vanhoihin alle 0,2 m:n etäisyydellä ja säilytä `id`. Uudet saavat juoksevan numeron (`dev-01`, `dev-02`…). Älä uudelleennumeroi olemassa olevia.

## A7. `src/data/floorplan.json` (skeema)
```json
{
  "version": 1,
  "generatedAt": "ISO-aika",
  "source": { "e57": "cloud_0.e57", "detectionsSha1": "…", "voxel": 0.04 },
  "frame": "panoramas.json world frame (z up, metres); px=(x-xMin)/mpp, py=(yMax-y)/mpp",
  "image": "/floorplan/floorplan.png",
  "widthPx": 1600, "heightPx": 0,
  "bounds": { "xMin": 0, "xMax": 0, "yMin": 0, "yMax": 0 },
  "metersPerPixel": 0.0,
  "floorZ": 0.0,
  "scanPoints": [{ "id": "scan-00", "x": 0, "y": 0 }],
  "devices": [{
    "id": "dev-01", "x": 0, "y": 0, "z": 0,
    "assetTypeId": "relay-615", "status": "auto",
    "detectionIds": ["d1"], "scanPointIds": ["scan-04"], "bestDetectionId": "d1",
    "method": "raycast", "positionSpread": 0.03, "confidenceMax": 0.94
  }],
  "unlocated": [{ "detectionId": "d9", "scanPointId": "scan-03", "reason": "no hit, single view" }],
  "stats": { "detections": 74, "raycastHits": 0, "triangulated": 0, "unlocated": 0,
             "medianRaycastVsTriangulationM": 0.0, "devices": 0, "devicesWithAuto": 0 }
}
```
Pyöristä koordinaatit 3 desimaaliin. Kaikki numerot ovat laskettuja, ei käsin kirjoitettuja.

## A8. Tarkistuskuvat ja raportti
- `cv/floorplan/check.png`: pohjapiirros ja sen päällä
  - skannauspisteet nimilappuineen
  - laitteet `id`:n ja statuksen värillä
  - kolmiomittauksen vertailupisteet pieninä ristinä
  - 5–8 esimerkkisädettä skannauspisteestä osumaan (eri skannauspisteistä, mukana yksi päällekkäisistä releistä)
- `cv/floorplan/check_reprojection_scan-XX.png` (A3).
- `cv/floorplan/report.json`:
  - A0:n skannausparitukset
  - kameran korkeudet lattiasta
  - A3:n siirtymät
  - A5:n osumaprosentti ja varamenetelmien määrä
  - A6:n klusterit
  - kuvan koko kilotavuina
- **Näytä check.png ja yksi reprojektiokuva minulle.**

## A9. Hyväksymiskriteerit (vaihe A)
- [ ] A0: 18/18 skannausta on paritettu alle 0,10 m:n etäisyydellä.
- [ ] A3: reprojektiosiirtymä on alle 0,5° kolmella skannauspisteellä, ja kuva ei ole peilattu.
- [ ] A5: raycast osui vähintään 80 %:iin automaattitunnistuksista. Mediaani raycast vs. kolmiomittaus on alle 0,10 m.
- [ ] A6: päällekkäiset releet ovat kaksi eri laitetta. Seinärivissä on releet noin 1 m välein.
- [ ] Skannauspisteet osuvat pohjapiirroksessa kulkualueelle, eivät tummiin esteisiin. Tarkista silmämääräisesti ja laskemalla: alle 5 % skannauspisteistä on varatussa pikselissä.
- [ ] `floorplan.png` on alle 1 Mt ja `floorplan.json` alle 100 kt.

Jos jokin kohta epäonnistuu, **älä pushaa dataa.** Raportoi, mitä yritit, ja jatka vaiheeseen B tyhjän tilan kanssa.

# VAIHE B – KÄYTTÖLIITTYMÄ
## B1. Datan saanti: `src/lib/floorplan.ts`
- Lataa data niin, ettei puuttuva tiedosto kaada buildia:
  `const mods = import.meta.glob("../data/floorplan.json", { eager: true, import: "default" });`
  → `floorplan: FloorPlan | null`.
- Tyypit A7:n skeeman mukaan.
- Apufunktiot:
  - `worldToPx({x,y})` ja `pxToWorld()`
  - `groupStacked(devices, 0.25)`: laitteet, joiden xy-etäisyys on alle 0,25 m, samaan pinoon (esim. päällekkäiset releet)

## B2. Elävä status ja huoltotila: `src/lib/floorplanStatus.ts`
Laitteen tila lasketaan selaimessa store-tunnistuksista (`useStore().detections`) `detectionIds`-kentän avulla, jolloin Review Queuen päätökset näkyvät heti:
- Kaikki jäsenet rejected → laite on piilotettu (ei lasketa mukaan).
- Yksikin confirmed → `"confirmed"` (sininen).
- Muuten yksikin auto → `"auto"` (vihreä).
- Muuten → `"review"` (oranssi).

Rekisterilaite (`instanceId`) on jäsenten `Detection.instanceId`-arvojen enemmistö (store on jo laskenut ne). Jos laitteella on instanssi:
- `deviceStatus(instance, file.entries)` → `overdue` ja `openCount`
- **punainen reunus**, jos huolto on myöhässä
- **vikailmoitusikoni**, jos avoimia ilmoituksia on yli 0

Funktiot ovat puhtaita, jotta ne voi testata.

## B3. Route ja navigaatio
- Uusi `src/routes/floorplan.tsx`:
  - polku `/floorplan`, otsikko "Floor plan"
  - alaotsikko samaan tyyliin kuin twinissä (`twin.tsx`:n subtitle)
  - `head` kuten muilla sivuilla
- `AppShell.tsx` → `nav`: **yksi rivi Digital Twinin alle**: `{ to: "/floorplan", label: "Floor plan", icon: MapIcon }`. Lisää importtiin `Map as MapIcon` (lucide-react); pelkkä `Map` peittäisi JavaScriptin `Map`-konstruktorin. Älä muuta muuta.
- `routeTree.gen.ts` generoituu buildissa. Committaa se, jos build muuttaa sitä.

## B4. Karttakomponentti: `src/components/FloorPlanMap.tsx`
- Responsiivinen: kuva + päällä SVG, jonka `viewBox` on `0 0 widthPx heightPx`. Kuvasuhde säilyy, ja kartta mahtuu korttiin (`Card`).
- Merkkien koko pysyy samana ruudulla: laske skaala ResizeObserverilla ja jaa säde ja viivanleveys skaalalla.
- **Skannauspisteet:** pienet harmaat pisteet (`fill: var(--muted-foreground)`, läpinäkyvyys 0,6) ja ohuet viivat kävelyreitin järjestyksessä.
  - Klikkaus → `/twin?scan=scan-XX&from=floorplan`.
  - Hover-tooltip: "Scan point 06".
- **Laitteet:** ympyrämerkki statuksen värillä samoilla CSS-muuttujilla kuin twinin pinnit (`--success`, `--warning`, `--primary`) ja valkoinen reunus kuten `.veo-pin`. Lisäksi:
  - huolto myöhässä → paksu `var(--destructive)`-rengas
  - avoin ilmoitus → pieni `LifeBuoy`- tai `!`-merkki oikeassa yläkulmassa
  - pinot (B1) → merkit viuhkaan 10 näyttöpikselin välein ja numeromerkki ("2"), jotta molemmat ovat klikattavia
  - valittu laite → paksumpi rengas ja nostettu päällimmäiseksi
  - saavutettavuus: `role="button"`, `tabIndex=0`, `aria-label`, Enter/Space avaa
- **Hover-tooltip:**
  - toimintopaikka ja variantti rekisteristä (esim. "SWG-B / Panel 01 · REF615"), muuten "Unregistered relay · 615 series"
  - toinen rivi: "Seen from 8 scan points · 94%"
  - jos `method = "triangulation"`, lisärivi "Position: triangulated"
- Valinnainen (P1): zoom hiiren rullalla ja panorointi raahaamalla, painike "Reset view".

## B5. Yhteenveto ja suodattimet (sivun yläreuna)
- Teksti: **"N relays in this room · X auto-tagged · Y need review · Z overdue maintenance"**.
  - N = näkyvät laitteet.
  - Lisäksi pieni teksti: "from M detections".
- Suodattimet: **All / Needs review / Overdue** (esim. `ToggleGroup` tai olemassa olevat Button-variantit). Suodatin himmentää muut merkit (läpinäkyvyys 0,2), ei piilota niitä, jotta kokonaiskuva säilyy.
- Huoltotiedot ovat demodataa. Näytä yhteenvedon vieressä badge "Example data" kuten `MaintenanceLog.tsx`:ssä.

## B6. Laitelista kartan vieressä (P1, mutta tee jos aikaa: "yhteenveto kaikista releistä")
- Oikealla, mobiilissa alla.
- Rivi per laite: nimi (toimintopaikka tai "Unregistered relay"), statusbadge, "Seen from K scan points", huoltobadge (Overdue / next due / open notices).
- Hover rivillä korostaa merkin ja päinvastoin. Klikkaus avaa sivupaneelin.
- `unlocated`-tunnistukset listan lopussa otsikolla "Detections without a position (N)", linkkinä twiniin.

## B7. Sivupaneeli ja "Open in digital twin"
- Laitteen klikkaus avaa **saman `AssetSheet`-paneelin** laitteen `bestDetectionId`:n tunnistukselle.
- **Korjaa samalla rajausbugi:** `AssetSheet`:n `useCrop(panorama, live)` käyttää storen *nykyistä* panoraamaa. Pohjapiirroksesta avattaessa se on väärän skannauspisteen kuva, ja rajaus näyttää väärää kohtaa.
  - Korjaus: käytä tunnistuksen omaa panoraamaa: `scanPoints.find(s => s.id === live.scanPointId)?.panorama ?? panorama` (`scanPoints` tulee `src/lib/api.ts`:stä).
  - Hyväksyntä: rajauskuva näyttää releen myös pohjapiirroksesta avattuna.
- Lisää `AssetSheet`:iin valinnainen prop, esim. `twinLink?: { scan: string; detection: string }`. Kun se annetaan, paneelissa on painike **"Open in digital twin"** → `/twin?scan=<best>&detection=<bestDetectionId>&from=floorplan`.
  - Paras skannauspiste = `bestDetectionId`:n `scanPointId`.
- Yleistä paluupainike: `backToReview` → esim. `backTo?: "review" | "floorplan"`.
  - Tekstit: "Back to review queue" / "Back to floor plan".
  - Toiminto history back, jos historiaa on, muuten navigointi kohteeseen.
  - Älä riko Review Queuen nykyistä toimintaa.

## B8. Twinin syvälinkki pohjapiirroksesta
- `twin.tsx` → `validateSearch`: `from?: "review" | "floorplan"`. Välitä `AssetSheet`:lle oikea `backTo`.
- Skannauspisteen klikkaus (vain `scan`) valitsee skannauspisteen avaamatta paneelia. Nykyinen logiikka tukee tätä jo; varmista.

## B9. Tyhjä tila (ei `floorplan.json`:ia tai data hylätty vaiheessa A)
Kortti, jossa teksti: "Floor plan not generated yet. Run `cv/floorplan/build_floorplan.py` to create it from the point cloud."

P1: piirrä silti skannauspisteet `panoramas.json`:sta ja rekisterin 5 relettä (`registry.generated.json`:n `position`) metrin ruudukolle, merkintänä "Approximate layout (no floor plan)".

## B10. Tyyli ja tekstit
- Käytä olemassa olevia komponentteja (`Card`, `Badge`, `Button`, `Tooltip`, `PageHeader`) ja Tailwind-tokeneita. Älä tuo uusia UI-kirjastoja.
- Kaikki UI-tekstit englanniksi, lyhyitä ja selkeitä.

# VAIHE C – TESTIT JA VARMISTUS
1. **Vitest, `src/test/floorplan.test.ts`:**
   - `worldToPx`/`pxToWorld` edestakaisin (virhe alle 1e-6)
   - kulmapisteet osuvat kuvan reunoille
   - +Y on ylöspäin (py pienenee y:n kasvaessa)
   - elävä status: kaikki rejected → piilossa, yksi confirmed → confirmed, auto ja review → auto, pelkkä review → review
   - `groupStacked`: kaksi laitetta 0,05 m:n xy-etäisyydellä → yksi pino; 1 m → kaksi
   - jos `floorplan.json` on olemassa:
     - jokainen `detectionIds`-viittaus löytyy `detections.json`:sta (muuten selkeä virheviesti: "detections.json changed – rerun cv/floorplan/build_floorplan.py")
     - jokainen `scanPoints.id` löytyy `panoramas.json`:sta
     - laitteiden `id`:t ovat uniikkeja
     - jokainen tunnistus on täsmälleen yhdessä laitteessa tai `unlocated`-listassa
2. **Build:** `bun install --frozen-lockfile; bun run build; bun run test`. Myös `npx tsc --noEmit` (projektin nykyinen taso on 0 virhettä; älä lisää virheitä).
3. **Käsin tehtävä demotesti** (kirjaa tulos, ota kuvakaappaukset):
   1. `/floorplan` latautuu, merkkien määrä täsmää yhteenvedon N:ään, ja skannauspisteet ovat kulkualueella.
   2. Hover rekisterireleen päällä → tooltip toimintopaikalla ja "Seen from K scan points".
   3. Klikkaus → `AssetSheet` aukeaa oikealle laitteelle, rajauskuva näyttää releen, huoltokirja näkyy.
   4. "Open in digital twin" → twin avautuu oikeaan skannauspisteeseen, tagi on keskellä ja korostettu, paneelissa on "Back to floor plan". Takaisin palaa pohjapiirrokseen. Selaimen back toimii myös.
   5. Skannauspisteen klikkaus → twin oikeassa skannauspisteessä.
   6. Suodatin "Needs review" himmentää muut. "Overdue" korostaa DEMO-REL-01:n (demodatassa Panel 01).
   7. Review Queuessa hylätään väärä osuma → se katoaa pohjapiirroksesta ja N pienenee.
   8. Field Appissa kirjataan tarkastus myöhässä olevalle releelle → punainen rengas poistuu pohjapiirroksesta ilman sivun päivitystä.
   9. Päällekkäiset releet ovat molemmat klikattavissa (viuhka ja "2"-merkki).
   10. Kapea ikkuna (390 px): kartta skaalautuu, eikä tule vaakavieritystä.
4. Jos Playwright on käytettävissä, automatisoi kohdat 1, 3, 4, 5 ja 7. Ei pakollinen.

# VAIHE D – GIT
- Commitit vaiheittain, esim.:
  - `floorplan: E57 slice + device positions (data)`
  - `floorplan: UI page + map`
  - `floorplan: AssetSheet crop fix + twin back link`
  - `floorplan: tests`
- Ennen pushia: `git fetch; git merge origin/main` (EI rebase). Ratkaise mahdolliset konfliktit säilyttäen Santerin muutokset. Aja build ja testit uudelleen.
- `git push -u origin feat/floorplan`. **Ei mainiin. Ei PR:n mergeä.** PR:n saa avata luonnoksena (draft), jos `gh` on käytettävissä.

# PRIORITEETIT JA AIKA-ARVIO
| Prio | Tehtävä | Arvio |
|---|---|---|
| P0 | A0–A3 (lataus, paritus, konventioportti) | 1–1,5 h |
| P0 | A4–A8 (pohjapiirros, raycast, klusterointi, json, tarkistuskuvat) | 1,5–2 h |
| P0 | B1–B5, B7, B8 (data, status, sivu, kartta, yhteenveto, paneeli, twin-linkki) | 2–3 h |
| P0 | C1–C3 ja D | 1 h |
| P1 | B6 laitelista, B4 zoom/pan, B9 ruudukkovara | 1,5 h |
| P2 | CSV-vienti, puuttuvan laitteen ennustus säännöllisestä rivistä, luovutusraportti, Matterport-vienti (tagit 3D-pisteillä VEO360 Insightiin; tarkista Matterportin rajapinta ennen väitteitä) | roadmap |

**Aikataulusääntö:** jos vaihe A ei läpäise A3-porttia kahden yrityksen jälkeen, tee B tyhjällä tilalla ja ruudukkovaralla (B9). Pushaa UI ja raportoi A:n ongelma. Älä pushaa arvattua dataa.

# RISKIT JA HALLINTA
1. **Muisti** (2,2 Gt E57): skannaus kerrallaan, float32, harvennus heti, välimuisti `cache/`-kansioon.
2. **Koordinaatisto ei täsmää** (pilvi vs. kuvat, peilaus, yaw-siirtymä): A0-paritus ja A3-reprojektioportti ennen mitään laskentaa.
3. **Väärä skannausparitus:** paritus translaatiolla, ei indeksillä.
4. **Päällekkäiset releet yhdistyvät:** eps 0,15 m ja cannot-link-sääntö. Testaa vertailuarvojen pinolla.
5. **Säde osuu kaapin reunaan tai oveen** releen sijaan: tunnistuksen keskipiste on etupaneelissa, tuki vähintään 8 pistettä, ristiintarkistus kolmiomittaukseen.
6. **CV-data päivittyy** (`detections.json`): skriptin uudelleenajo säilyttää ID:t (A6.7). Testi kertoo, jos data on vanhentunut.
7. **Lovable-konfliktit** (`AppShell.tsx`, `AssetSheet.tsx`): minimimuutokset, merge eikä rebase, ei mainiin.
8. **Liian iso kuva:** palettikvantisointi ja leveys 1600 px.
9. **Demodata sekoittuu oikeaan:** huoltotiedot ja rekisteri on merkitty "Example data", vain sijainnit tulevat pistepilvestä.

# LOPUKSI RAPORTOI
1. **Montako uniikkia relettä huoneessa on**, ja montako tunnistusta niihin yhdistyi. Erittele: automaattinen / pelkkä review / sijainniton.
2. **Kuinka luotettava sijaintilaskenta on:**
   - raycast-osumaprosentti
   - montako tunnistusta jäi ilman osumaa
   - montako sijoitettiin kolmiomittauksella
   - mediaani raycast vs. kolmiomittaus metreinä
   - A3-siirtymät
   - laitteiden `positionSpread`-arvojen mediaani ja maksimi
3. **Vertaa vertailuarvoihin:** löytyikö 5 releen rivi 1 m välein ja 2 päällekkäistä relettä? Mikä poikkesi ja miksi?
4. **Kuvat:** `check.png`, yksi reprojektiokuva ja kuvakaappaukset `/floorplan`-sivusta (yleiskuva, tooltip, avattu paneeli, suodatin "Overdue").
5. **Muuttuneet ja uudet tiedostot.** Erikseen muutokset olemassa oleviin tiedostoihin (`AppShell.tsx`, `AssetSheet.tsx`, `twin.tsx`, `styles.css`) ja niiden perustelut.
6. **Build- ja testitulos** (myös lähtötaso vaiheesta 0), viimeisin commit-tunniste ja pushattu haara.
7. **Mitä jäi kesken** (P1/P2) ja avoimet kysymykset.
8. **60 sekunnin demokäsikirjoitus:**
   Floor plan → yhteenveto → Overdue-suodatin → klikkaa punareunaista relettä → huoltokirja → Open in digital twin → takaisin → Review Queuessa hylätty osuma on poistunut kartalta.

# AVOIMET KYSYMYKSET (kirjaa vastaukset, jos selviävät; muuten raportoi)
1. Sisältääkö E57 RGB-värit? Vaikuttaa A3:n tarkistuskuvaan; syvyys toimii varana.
2. Onko huoneessa useampi kerros tai taso? Tämä prompti olettaa yhden lattiatason.
3. Mikä on huoneen ja kojeistorivien oikea nimi? UI käyttää tällä hetkellä fiktiivistä "Helsinki Substation 01 · Switchgear room B" -tekstiä.
4. Halutaanko pohjapiirrokseen pohjoisnuoli? Maailman +Y:n ilmansuuntaa ei tiedetä.
