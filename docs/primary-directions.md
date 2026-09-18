# Primary directions — technical specification

What this app computes for its "Regiomontanus" primary directions, every choice
behind it, how it was checked, and where other methods can differ. The point of
this document is comparison: each decision that changes a date is listed in
[§9](#9-decision-points--how-other-methods-differ) with the choice we made, the
evidence for it, and how far the date moves if you choose otherwise.

Code lives in `src/astro.js`. Verification: `npm run verify:directions`
(`scripts/verify-directions.mjs`).

Reference material (the "book" and "blog" below):

* *Predictive Astrology Textbook*, ch. 3, pp. 377–389 — Example №35, birth
  1976-11-29 12:15 UTC+3, 37°37′E 55°45′N (rectified to 12:16).
* The author's own method articles (alexeyborealis.com/blog): *Primary Direction
  in Placidus System* (the arc equation and a worked Churchill example), *Mundane
  Position in the Placidus System* (the mundane-position equations) and *A Circle
  of Mundane Aspects* (Morin's aspect plane, with its equations). These are the
  only places the author states formulas; §§4.1, 6, 6b follow them.
* The same author's blog post on Queen Elizabeth II
  (morinus-astrology.com/thematic-directions): six dated directions, several to
  the 5th-house cusp, plus cusps — the cleanest test set (all six reproduced).
* The same author's blog post on Princess Diana
  (morinus-astrology.com/diana-death): a second chart with dated directions and
  Regiomontanus cusps. It states that the houses are Regiomontanus and mentions
  that "if two points have a close declination, then they merge into one point in
  the direction" (Morin); it gives **no formulas**.

## 1. Status in one paragraph

Against 13 published forecasts at the book's official time (12:15) and 8 at its
rectified time (12:16), every row is within **1 month** of the published month
(the published resolution). Queen Elizabeth II's six dated directions (incl.
three to the 5th-house cusp) match to the month, and all Regiomontanus cusps of
four blog charts match to under 1′. Diana's Saturn☍→Mercury, Jupiter☍→Mercury
and Sun□→Jupiter match. The **Placidus** mode reproduces the author's worked
example exactly (Churchill: mundane position 233°42′, arc 24°25′, September
1899). **Two rows are not reproduced** — Diana's Mercury→Mars (4½ years early)
and William's Saturn☍→IC (3 years early); neither involves an aspect plane
([§10](#10-known-discrepancies)). Antiscia are not implemented.

## 2. Conventions and inputs

| Item | Choice |
|---|---|
| Birth time | Civil time + UTC offset → UT. The chart uses **UT**, there is no local-mean-time correction; longitude enters only through sidereal time. |
| Positions | Geocentric, apparent (light-time + aberration), via `astronomy-engine`. |
| Ecliptic | **True ecliptic of date** (`Astronomy.Ecliptic`, true obliquity, nutation included). Longitudes are tropical. |
| Equator | True equator of date. |
| Sidereal time | Apparent (`Astronomy.SiderealTime`). ΔT handled inside `astronomy-engine`. |
| Observer | Only latitude/longitude, elevation 0. **Not** used for planet positions in directions (see §5). |
| Zodiac/houses | Tropical; Regiomontanus houses are display-only and do not enter direction arcs. |

## 3. The four angles

Closed form from RAMC and true obliquity ε (`computeSkyState`, `src/astro.js:226`):

```
RAMC = apparent sidereal time·15 + east longitude
MC   = atan2( sin RAMC , cos RAMC · cos ε )
ASC  = atan2( cos RAMC , −( sin RAMC · cos ε + tan φ · sin ε ) )   (rising branch: azimuth 0–180°)
IC = MC+180°, DSC = ASC+180°
```

Geometric (unrefracted) horizon. Each angle is then pushed through the normal
ecliptic→equator→horizon pipeline to get RA/Dec (angles sit on the ecliptic,
latitude 0).

**House cusps** (`computeRegiomontanusHouses`) are display-only but are also exact
now: each house circle contains the horizon's North point and the equatorial
division point at RAMC+30°·k, and the cusp is where that plane meets the true
ecliptic (`n·e₁ cos λ + n·e₂ sin λ = 0`). The earlier version placed the division
point through the *refracted* horizon and interpolated on a 0.5° grid, which put
intermediate cusps up to ~6′ off (checked against the blog's Diana cusps:
22°44′, 16°50′, 13°03′, 29°03′ — now matched to 0.2′).

Two earlier defects here mattered for directions: the ecliptic→equator step used
the J2000 ecliptic (≈0.34° error in 1976, growing with distance from 2000), and
MC/IC were read off a 2.5° sample grid (up to ±1.25°). Both are fixed; the
formulas above are exact to the precision of the inputs.

## 4. Promissors and significators

A *point* is an RA/Dec pair (of date). Kinds:

* **Planet, natal** — geocentric RA/Dec (`geocentricEquatorialOf`, `astro.js:377`),
  **including its ecliptic latitude**.
* **Angle** — ecliptic longitude at latitude 0.
* **Aspect point of a planet** — see §4.1.
* **Same planet, own aspect** — allowed (Sun ⚹ → Sun). Plain self-conjunction is not.

### 4.1 Aspect points: Morinus's "circle of aspects"

Book, pp. 378–379. Aspects are *not* cast on the ecliptic (that would be
"zodiacal directions with the planet's latitude", which the book says is off by
years). Instead a plane is built from the planet's apparent motion: it "passes
through two points — the planet's current position and the point of maximum
elevation above the ecliptic on the planetary path from the past to the next
node". Implementation (`computeAspectPlane`, `astro.js`):

1. Sample the planet's ecliptic latitude ± a per-body window to find the previous
   and next latitude nodes (sign changes), then the maximum |latitude| between
   them and the day/longitude where it occurs (**P_max**). Windows
   (`NODE_SEARCH_DAYS`): Mercury 250 d, Venus 400, Mars 900, Jupiter 2500, Saturn
   6000. Coarse stride = window/300 days, refined to 1 day.
2. The plane passes through the planet's current position P₀ and has an
   **inclination to the ecliptic equal to that maximum latitude**.
3. Two mirror-image planes have that inclination through P₀ (ascending vs
   descending side). Choose the one whose **own highest point falls at P_max's
   longitude** — i.e. where the planet really peaked.
4. The aspect point is the point on this circle displaced from the planet by the
   aspect angle **along the circle**: 60/90/120/180°.
   * **sinister = +offset** (toward increasing longitude), **dexter = −offset**;
     the plane is oriented so this holds.
   * 0° is the planet itself (with its own latitude).
5. If the planet is *at* its maximum (P_max = P₀), the branch is chosen by its
   short-term motion. The Sun (latitude ≈ 0) gives the ecliptic itself.

The author's *Circle of Mundane Aspects* article confirms this reading: Morin
"finds the local extremum of the planet's path [between two consecutive nodes] …
He uses the latitude of this local extremum as an inclination of the circle of
aspects", and the plane "passes through the planet at a given time" and follows
its current motion. The article's equations, with `k = +1` if the planet moves
*toward* its maximum in time and `−1` if away:

```
λ′ = arcsin( sin δ_P / sin δ_max ) + k·Aspect
AE = arcsin( tan δ_P / tan δ_max )      AG = arctan( cos δ_max · tan λ′ )
δ  = arcsin( sin λ′ · sin δ_max )       λ  = λ_P + k·(AG − AE)
```

(sinister = +Aspect, dexter = −Aspect). Implemented geometrically; the mirror plane
is chosen by where the maximum falls in longitude (`'inclination'`, default) or, as
in his equations, by the sign of k (`ASPECT_PLANE_MODE = 'morin-k'`). The two give
identical results on every dataset here — they can only differ for a retrograde
planet — so the default is kept.

**Why not "the great circle through P₀ and P_max"** (`ASPECT_PLANE_MODE = 'two-point'`,
kept for comparison)? It is the literal reading of "passes through two points",
but it tilts the plane by `atan(tan(lat_max)/sin Δλ)` where Δλ is the longitude
gap between P₀ and P_max — 15° instead of 8.4° for Elizabeth II's Venus (32° gap),
putting the sextile point at latitude −12.9° instead of −7.1°. The book-implied
point (solved for from her two Venus dates) is at −7.1°, matching the
inclination reading. Across all datasets the inclination reading is exact where the
two-point reading is 1–3 months off (Mars, Saturn) or years off (Elizabeth's Venus).

Two more things that mattered: a 250-day window put Saturn's plane in the wrong
place (20–40 months off), and choosing between the mirror planes by the planet's
instantaneous motion direction failed for planets at a station (Saturn in the
book's chart moves 0.003°/day) — see step 3.

## 5. Which positions directions use

Direction arcs use **geocentric** RA/Dec, not topocentric. With a topocentric
Moon (parallax up to ~1°) Sun→Moon and Venus→Moon came out ~16–19 months off the
book. Drawing on the sphere still uses topocentric altitude/azimuth.

## 6. The arc (Regiomontanus, in mundo)

`computeRegiomontanusDirection` → `regiomontanusArcs` / `regiomontanusPoleDeg`
(`astro.js:476–540`). The book's description (p.377): "keep the significator's
horizon stationary and allow the promissor to reach that line" — the
significator's **circle of position**, the great circle through the N and S
points of the horizon and the point itself.

For each point X with hour angle H and declination δ:

1. Its circle of position crosses the equator at hour angle **A**
   (solved in horizon coordinates: circle normal = N-axis × X, crossing =
   normal × pole-axis).
2. **Pole height** `tan(p) = tan(φ) · |sin A|`
   (φ = geographic latitude; an angle on the horizon gives p = φ, a point on the
   meridian gives p = 0).
3. **Oblique ascension under that pole**: `OA = RA ∓ AD`, `AD = asin(tan δ · tan p)`,
   minus for a point east of the meridian (H < 0), plus for west. Both points use the
   *same* pole and the *same* side, that of the point whose pole is used.

Arcs:

```
direct   = OA(promissor) − OA(significator)        pole & side of the SIGNIFICATOR
converse = OA(significator) − OA(promissor)        pole & side of the PROMISSOR
```
(mod 360°.) **Direct** carries the promissor west (hour angle increasing) onto
the significator's circle. **Converse** holds the promissor and its circle fixed
and carries the significator (book p.378: "leave the promissor and its circle of
position stationary and move the significator along with the sphere"; a house
cusp is directed by its zodiac degree).

**Which one is reported:** direct, unless the direct arc exceeds 180°, then
converse (book p.378). Verified to give the reported rows; the shorter-of-two
rule I first tried gives identical results on every checked row but is not what
the book says.

For an ASC/DSC significator the pole is φ itself, so a direct arc to the
Ascendant reduces to plain oblique-ascension difference. This is the only place
Regiomontanus and the Placidus semi-arc method coincide; they diverge for
planet significators (Placidus was off by 4–6 years on the Jupiter/Mars/Sun
rows).

**The author's own statement of this** (Placidus-direction article): with M the
significator's *mundane position* (for Regiomontanus, the RA where its circle of
position crosses the equator),

```
RA_end = arcsin( tan D_P · tan φ · cos(OA_ASC − M) ) + M
Arc    = RA_P − RA_end
```

and "it matches the formula for the Regiomontanus house system and is generally
universal … only the value of the mundane position changes depending on the chosen
system". Here `cos(OA_ASC − M) = |sin A|` (OA_ASC = RAMC + 90°), so this **is** the
pole/oblique-ascension arc above written in one line — direct case, the
significator's M. Years are stated as `arc × 1.0147` (Naibod); `÷ 0.985556` is the
same to 0.002 y.

**Motion sense:** westward, i.e. RA of the moving point *decreases*
(`raSign = −1`, `buildDirectionResult`). This only affects the animation, not
the arc.

## 6b. Placidus mode (`computePlacidusDirection`)

Same skeleton, different mundane position. From the author's *Mundane Position in
the Placidus System*:

```
R        = MD / SA                  meridian distance ÷ semi-arc
                                    (upper MD & diurnal SA above the horizon, lower & nocturnal below)
RA_M     = RAMC (or IC) ± 90° · R
SA_diurnal = 90° + AD ,  SA_nocturnal = 90° − AD ,  AD = asin(tan φ tan δ)
```

**Direct** carries the promissor west along its parallel until *its* mundane
position equals the significator's; **converse** carries the significator onto the
promissor's. Converse when direct > 180° (as for Regiomontanus). Implemented in
`placidusMundanePosition` / `placidusArcToMP`.

Check: Churchill (1874-11-30 01:30 UT, 1°21′W 51°51′N), Sun → Mercury. The source
gives the mundane position of Mercury as 233°42′ and the arc as 24°25′ →
24.78 y → September 1899. The app: 233.696° (233°42′), 24.423° (24°25′), age 24.78,
**1899-09-11**. The same pair in the Regiomontanus system is 25.62° → Nov 1900 (the
author says Regiomontanus fits his events "very accurately"; he became an MP in
Oct 1900 and was captured in autumn 1899).

For an ASC/DSC significator Placidus and Regiomontanus coincide (both reduce to
oblique ascension); they diverge for everything else. The previous Placidus mode
here advanced RA (wrong sense) and chose the shorter of direct/converse; it was
replaced.

Caveat: the Placidus mode has been checked against **one** published example. The
Regiomontanus mode has ~50 rows.

## 7. Arc → date

```
years = arc° / 0.985556          (Naibod: 0°59′08″ per year, book p.381)
date  = birth + years · 365.2422 days     (tropical year)
```

* The key is used **as printed in the book**. `360/365.2422 = 0.98565°` gives
  identical dates to within a day or two at age 40 (≤0.1%), but the book value is
  the specified one.
* 1° ≈ 1.0147 years. There is **no** secondary-progression / true-solar-arc key;
  Ptolemy (1°/yr) would shift a 42-year arc by ~7 months.

## 8. What is not implemented

* **Antiscia** (book p.379: two per planet on the 3-D sphere — the intersections
  of the planet's diurnal arc with the ecliptic).
* **Solar/lunar returns.** The book says explicitly (p.387) that directions are
  "only needed to indicate the year of the event to cast the appropriate solar
  return chart for further details" — its own directions have ±2 months mean
  error. Day-level timing comes from returns, not from directions.
* Fixed stars, parallels, declination aspects, rectification tools.
* The "bound crossings" rows of the table still use the older RA-advance model
  (`computeDirection`, +RA), not this arc. It is a different question (a point's
  path across Egyptian bounds) but is worth reconciling.
* Placidus is implemented from the author's equations (§6b) but checked against a
  single worked example.

## 9. Decision points — how other methods differ

Where two implementations of "primary directions" typically diverge. `Δ` is
what I measured or can bound; "verified" means a book row selected between
alternatives.

| # | Decision | Our choice | Alternatives | Effect on a date | Evidence |
|---|---|---|---|---|---|
| 1 | Birth time | as given, to the second | rectified | **1 min ≈ 20–95 days** (ASC directions most sensitive); 1 s ≈ 1–2 days; 1′ of longitude ≈ 1–6 d; 1′ of latitude ≈ 5–7 d | book p.382 says the same |
| 2 | Ecliptic frame | true ecliptic of date | J2000 / mean | ≈0.34° in 1976 → **~4 months** | verified (bug fixed) |
| 3 | Angles | closed form, geometric horizon | sampled, refracted horizon | up to ~1–2° → **1–2 years** | fixed |
| 4 | Position type | geocentric | topocentric | Moon: **~1.5 years**; others small | verified |
| 5 | Aspect construction | Morinus circle of aspects (§4.1) | zodiacal lat 0; zodiacal keeping the planet's latitude; Ptolemy | **1–2 years** (Venus ⚹→ASC: 2000-10 vs 1998-03 vs 2002-03) | verified — only Morinus fits |
| 5b | Plane construction | inclination = max latitude, branch by peak location | great circle through planet and P_max ("two-point"); branch by motion direction | Elizabeth's Venus **1.5–8 years**; Mars 2–3 mo; Saturn 1–2 mo | verified (all datasets) |
| 6 | Node window | per-planet (Saturn 6000 d) | fixed 250 d | Saturn **20–40 months** | verified |
| 7 | Arc method | Regiomontanus pole + oblique ascension | Placidus (now also implemented, §6b); Campanus; raw RA | for planet significators **4–6 years** (e.g. Sun△→Jupiter in Example 35: Placidus 29.6° vs Regiomontanus 24.9°); ASC significator: identical | verified against 50+ Regiomontanus rows; Placidus vs 1 |
| 8 | Pole formula | `tan p = tan φ · |sin A|` (A = circle's equator crossing) | Placidus pole; other Regiomontanus derivations | tested several: Regiomontanus is the only one matching all rows | verified |
| 9 | Direct vs converse | direct unless > 180°, then converse | shorter of the two; converse only | none on the checked rows | book p.378 |
| 10 | Time key | Naibod 0.985556°/yr | Ptolemy 1°; 360/365.25; true solar arc | Ptolemy **~7 mo** at 42 y; other Naibod variants ≤ 1–2 d | book p.381 |
| 11 | Year length in date conversion | 365.2422 d | 365.25 | ≈ 0.001 y ≈ 0.3 d | negligible |
| 12 | Sinister/dexter | + / − offset in longitude | book may label reverse for some rows | none once the right point is chosen; swapping picks the wrong aspect point | rows fit as labelled |
| 13 | Aspect of a planet to itself | included | excluded | adds rows only | book has e.g. Sun ⚹ → Sun |
| 14 | Antiscia | not implemented | 2 per planet (book) | adds promissors only | — |

Practical reading of #1: a direction to the Ascendant moves ~3 months for a
one-minute change of birth time. This is why the book rectifies, and why day-level
claims from directions alone are not supportable from these numbers (a second of
uncertainty is already 1–2 days).

## 10. Known discrepancies

Rows the app does not reproduce (run by `npm run verify:directions`; rows marked
*known miss* there do not fail the check). The previously listed Mars→Mars,
Saturn→Venus and Saturn→DSC residuals (2–3 months) are gone since the plane
construction was corrected (§4.1); all book rows are now within 1 month.

| Direction | Source | Expected | App | Note |
|---|---|---|---|---|
| **Mercury ☌ Mars** (Diana) | blog | Jan 2017 (55) | 2012-09 | arc 50.5° vs ≈54.7° implied — **4½ yr** |
| **Saturn ☍ → IC** (William) | blog | Aug 1997 | 1994-07 | arc 11.9° vs 15.0° implied — **3 yr** |

Neither uses an aspect plane (a conjunction, and an opposition, which is the
antipode of the planet), so they are unaffected by §4.1.

**Diana's Mercury→Mars.** Mercury has a large latitude (−4.7°). Variants tried,
none of which give 54.7°: Mercury and/or Mars projected to the ecliptic (40.95°,
42.77°, 48.63°), swapping promissor/significator (same arc), plain RA difference
(60.7°). The blog says "Mercury/Sun/Jupiter directed toward Mars" and "Mars directed
towards Mercury/Sun/Jupiter or the Ascendant" (conjunctions), lists the result as
"Mercury to Mars — 55 years old, January 2017", and gives no arc or degrees. The
other 2017-adjacent rows (e.g. Venus ☍ Mars 2017-12, Mercury ⚹ Jupiter 2017-05)
do not obviously correspond either, so the label may be loose.

**William's Saturn☍→IC.** The exact intersection of the IC's parallel with the
Saturn-opposition point's circle of position is at 11.86° (verified by root
finding, independent of the pole formula). The blog's August 1997 corresponds to
15.0°, which is precisely the *plain RA difference* (Saturn☍ RA 15.28°, IC RA
30.24°) — i.e. the promissor carried *backward* to the meridian by the shortest
path, which the book (p.378) calls a mistaken method. The same "plain meridian
distance" reading is contradicted by Borealis's Saturn⚹→MC row (RA difference
48.1° vs book 25.7°, our value 25.6°). So either the blog's William figure was
produced differently (e.g. a different opposition point for a retrograde,
latitude-carrying Saturn) or Morin/the author treat angles on the *lower*
meridian differently. Open.

Also unexplained: the user-supplied "Sun ⚹ 7° Libra → Sun: Oct 2008" (app: Feb
2009). It is not in the book's tables; it may be a transcription slip. And the
user-supplied "ASC △ Venus: Apr 2018" is Apr **2019** at 12:16 (the book's
Table 3.10 implies Apr 2019), so that was a typo.

## 11. Does this differ from Morinus?

Short answer: the author presents his method as Morin's (Morinus'), and every
element he describes or gives equations for is now implemented and reproduces his
published numbers. I still cannot certify equivalence with *Morin's own* text
(*Astrologia Gallica*) or with the open-source Morinus program, which I have not
read.

What the author states, and where each stands here:

| Element (source) | Here |
|---|---|
| Mundane conjunction = promissor reaching the significator's circle of position (book p.377) | implemented (§6); his equation is the same arc |
| Converse when the path > 180° (promissor fixed, significator carried) (p.378) | implemented |
| Morin's circle of aspects — inclination = the latitude of the local extremum between consecutive nodes, plane through the planet, orientation from its motion (p.378; *Circle of Mundane Aspects*) | implemented (§4.1); his equations agree with the geometry, `'morin-k'` mode reproduces his k rule |
| Naibod key 0°59′08″ (arc × 1.0147) (p.381; *Placidus direction*) | implemented |
| Houses: Regiomontanus for the forecasts (blog charts) | cusps reproduced to <1′ on four charts |
| Directions to a house cusp = its zodiac degree (p.378) | implemented; verified with the 5th-house cusp in Elizabeth II's chart |
| Placidus mundane position and arc (*Placidus direction*, *Mundane position*) | implemented (§6b), one worked example |
| Two antiscia on the 3-D sphere (p.379) | **not implemented** |

**What would distinguish "Morin" from an implementation that merely matches these
rows:** the formulas above are the author's; the only step that was fitted rather
than taken from his text is the *choice of plane construction* (§4.1 — first
tried as "two points", corrected by comparing with dated events, then confirmed by
his own article's wording). Everything else was either stated by him or is forced
by the data. That leaves two places to look if another implementation disagrees:
the two open discrepancies in §10 (Mercury at −4.7° latitude; a promissor 15° from
the IC), and situations the test charts do not exercise (southern latitudes,
polar-ish declinations, arcs near 180°, retrograde planets whose maximum lies
behind them — `'morin-k'` vs `'inclination'`).

The Morinus program exposes a menu of methods (Placidus semi-arc, Regiomontanus,
Campanus, zodiacal/mundane, several keys); which combination equals the author's
is unchecked. §9 is laid out for a row-by-row diff, and
`scripts/verify-directions.mjs` accepts any dataset.

## 12. Running and extending the verification

```
npm run verify:directions
```

Prints, for 12:15 and 12:16 local, each published forecast against the app's,
the arc in degrees, direct/converse, and the deviation in months; exits non-zero
if any row is more than 3 months off. To compare another chart or another
person's dates, add a `DATASET` entry (birth UTC, coordinates, and rows of
`[promissor, aspect glyph, sinister|dexter, significator, expected-month…]`).

Things worth adding when new data arrives: the arc in **degrees** for each row
(month-rounded dates hide ~0.1° of error), rows near the 180° converse switch,
a southern-hemisphere and a low-latitude chart, and any row whose promissor is a
planet with its aspect plane near a node.
