# Vaihe 2: uudelleenkoulutettu malli (v2) vs. nykyinen malli

Vertailu on tehty vain skannauspisteillä 09–17. Pisteitä 00–08 käytettiin v2:n taustoina ja
vaikeina negatiiveina, joten ne eivät ole mukana mittauksessa.

## Suositus

**Kannattaa vaihtaa v2:een**, mutta hyöty on maltillinen: neljä relettä lisää, yksi väärä osuma
vähemmän ja selvästi vähemmän vääriä ehdokkaita ennen varmennusta. Ennen vaihtoa v2 pitää ajaa
kaikille 18 pisteelle (noin 50 min) ja tulos tarkistaa viewerissä.

## Vertailu pisteillä 09–17

"Oikein" tarkoittaa, että kävin jokaisen tunnistuksen läpi kuvasta (`overview_current.jpg`,
`overview_v2.jpg`). Merkittyä vertailuaineistoa ei ole.

| Piste | Nykyinen: tunnistuksia (oikein) | v2: tunnistuksia (oikein) | Muutos |
|---|---|---|---|
| 09 | 4 (4) | 4 (4) | – |
| 10 | 5 (4) | 5 (5) | väärä kilpi poistui, yksi uusi rele |
| 11 | 6 (6) | 6 (6) | – |
| 12 | 6 (6) | 7 (7) | yksi uusi rele |
| 13 | 6 (6) | 6 (6) | – |
| 14 | 2 (2) | 3 (3) | yksi uusi rele |
| 15 | 1 (1) | 2 (2) | yksi uusi rele |
| 16 | 0 | 0 | – |
| 17 | 0 | 0 | – |
| **Yhteensä** | **30 (29)** | **33 (33)** | **+4 relettä, −1 väärä** |

| | Nykyinen | v2 |
|---|---|---|
| Automaattisesti tagatut (≥ 0,75) | 26, kaikki oikein | 28, kaikki oikein |
| Tarkistusjonossa (< 0,75) | 4, joista 3 oikein | 5, kaikki oikein |
| Vääriä osumia | 1 | 0 |
| Tarra "615" luettu | 8 | 5 |
| Ehdokkaita ennen varmennusta | 201 | 53 |
| Varmennuksen hylkäämiä ehdokkaita | 171 | 20 |
| ...joista mallin varmuus ≥ 0,8 | 41 | 0 |

## Mitä tulos kertoo

- **Recall parani vähän.** Kaikki neljä uutta relettä ovat jyrkässä kulmassa näkyviä, eli juuri
  niitä, joita varten perspektiiviä lisättiin. Ne saavat varmuuden 0,70–0,74 ja menevät
  tarkistusjonoon, koska vino rele muistuttaa referenssikuvaa vähemmän.
- **Malli on itsessään paljon tarkempi.** Nykyinen malli ehdottaa 171 väärää kohdetta, joista 41
  korkealla varmuudella, ja varmennus referenssikuvaa vasten karsii ne. v2 ehdottaa vain 20 väärää,
  eikä yhtään korkealla varmuudella. v2 on siis vähemmän riippuvainen käsin viritetystä
  varmennusrajasta, mikä on tärkeää uudessa kohteessa.
- **Tarran luku heikkeni** (8 → 5). Syy on todennäköisesti se, että v2 valitsee releelle eri
  näkymän, josta lähikuva rajataan. Tätä en ole selvittänyt.
- **Pisteet 14 ja 15 jäävät edelleen vajaiksi** (3 ja 2 relettä). Lähes sivusta tai hyvin kaukaa
  näkyvät releet eivät löydy kummallakaan mallilla.

## Varaukset

- Aineisto on pieni: ero on 4 relettä ja 1 väärä osuma yhdeksässä pisteessä.
- Pisteet 09–17 kuvaavat samaa huonetta kuin 00–08, joten taustat ovat samankaltaisia. Tämä ei
  ole testi toisesta kohteesta.
- Varmennuksen raja viritettiin alun perin kaikilla 18 pisteellä. Molemmat mallit ajettiin saman
  putken läpi, joten vertailu on reilu, mutta absoluuttiset luvut ovat optimistisia.
- Kokonais-recall on tuntematon, koska kaikkia näkyviä releitä ei ole merkitty.

## Miten v2 tehtiin

- Taustat: 239 näkymää pisteistä 00–08, joissa ei ole releitä (tarkistettu kuvakoosteista).
- Vaikeat negatiivit: 243 rajausta kohteista, joita nykyinen malli ehdotti pisteissä 00–08 ja
  varmennus hylkäsi (ovenkahvat, jakkarat, kilvet, teipit). Liimataan kuviin ilman merkintää.
- Perspektiivi: rele näytetään sivusta enintään 75° kulmassa.
- 3600 synteettistä kuvaa, YOLOv8n, 10 epochia CPU:lla. Synteettinen validointi: mAP50 0,994,
  mAP50-95 0,886.

```powershell
python build_negatives.py --scans 0-8
python generate_synthetic.py --n 3600 --out data/synthetic_v2 --backgrounds data/backgrounds_v2 --negatives data/negatives_v2 --max-angle 75 --preview outputs_v2/preview_grid.png
python train.py --data data/synthetic_v2 --name train_v2 --weights models/best_v2.pt --outputs outputs_v2 --epochs 10
python infer.py --weights models/best_v2.pt --out outputs_v2 --scans scan-09 scan-10 scan-11 scan-12 scan-13 scan-14 scan-15 scan-16 scan-17
```

Koulutus keskeytyi kerran epochin 9 aikana (kone meni lepotilaan) ja jatkettiin epochin 8
tallennuspisteestä komennolla `train.py ... --resume`.

## Tiedostot

- `detections.json` – v2:n tunnistukset pisteille 09–17
- `overview_v2.jpg`, `overview_current.jpg` – kaikki tunnistukset kuvina (keltainen NEW / LOST =
  vain toisessa mallissa)
- `metrics.png`, `sample_predictions.jpg`, `preview_grid.png` – koulutuskäyrät, ennuste-esimerkit
  ja synteettisen datan esikatselu

Nykyiset tulokset (`cv/outputs/`), `models/best.pt`, frontendin `detections.json` ja main ovat
koskemattomia.
