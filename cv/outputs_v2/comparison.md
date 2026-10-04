# Vertailu: nykyinen malli vs. v2 (skannauspisteet 09–17)

Pisteitä 00–08 käytettiin v2:n taustoina ja vaikeina negatiiveina, joten ne eivät ole mukana.
"Oikein" perustuu jokaisen tunnistuksen tarkistukseen kuvasta (`overview_current.jpg`,
`overview_v2.jpg`), ei merkittyyn vertailuaineistoon.

## Per skannauspiste

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

## Yhteenveto

| | Nykyinen | v2 |
|---|---|---|
| Tunnistuksia | 30 | 33 |
| Oikeita releitä | 29 | 33 |
| Vääriä osumia | 1 | 0 |
| Automaattisesti tagatut (≥ 0,75) | 26, kaikki oikein | 28, kaikki oikein |
| Tarkistusjonossa (< 0,75) | 4, joista 3 oikein | 5, kaikki oikein |
| Tarra "615" luettu | 8 | 5 |
| Ehdokkaita ennen varmennusta | 201 | 53 |
| Varmennuksen hylkäämiä ehdokkaita | 171 | 20 |
| ...joista mallin varmuus ≥ 0,8 | 41 | 0 |

Mallit: nykyinen `models/best.pt` (ei versionhallinnassa), v2 `models/best_v2.pt`.
Tausta, varaukset ja komennot: `SUMMARY.md`.
