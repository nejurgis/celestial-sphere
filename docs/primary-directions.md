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
* The same author's blog post on Princess Diana
  (morinus-astrology.com/diana-death): a second chart with dated directions and
  Regiomontanus cusps. It states that the houses are Regiomontanus and mentions
  that "if two points have a close declination, then they merge into one point in
  the direction" (Morin); it gives **no formulas**.

## 1. Status in one paragraph

Against 13 published forecasts at the book's official time (12:15) and 8 at its
rectified time (12:16), 11 of 13 land within ±2 months of the published *month*
(the published resolution) and every row is within 3. Against the blog's Diana
chart, all four Regiomontanus cusps match to 0.2′ and three of four directions
match to the month. Aspects to the Ascendant, to the Sun, Venus, Jupiter,
Mercury and the Moon, and Saturn-as-promissor all fit. **Three rows are not
reproduced** and are listed in [§10](#10-known-discrepancies): two Mars→Mars
aspects (2–3 months early), Diana's Mercury→Mars (4½ years early), and William's
Saturn☍→IC (3 years early). Antiscia are not implemented.

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
years). Instead: the great circle through **the planet's current position** and
**its point of maximum elevation above the ecliptic on the path from the
previous node to the next node**. Implementation (`computeAspectPlane`,
`astro.js:872`):

1. Sample the planet's ecliptic latitude ± a per-body window to find the previous
   and next latitude nodes (sign changes), then the day of maximum |latitude|
   between them. Windows (`NODE_SEARCH_DAYS`): Mercury 250 d, Venus 400, Mars 900,
   Jupiter 2500, Saturn 6000. Coarse stride = window/300 days, refined to 1 day.
2. Plane normal **N = P₀ × P_max** (P₀ = current position, P_max = max-elevation
   point, both on the unit sphere in ecliptic coordinates).
3. Orient N so that increasing phase runs toward **increasing ecliptic longitude**
   at P₀.
4. The aspect point is the point on this circle displaced from the planet by the
   aspect angle **along the circle**: 60/90/120/180°.
   * **sinister = +offset** (toward increasing longitude), **dexter = −offset**.
   * 0° is the planet itself (with its own latitude).
5. Fallbacks: if P₀ ≈ P_max or the latitude is ≈ 0 (the Sun), use an
   inclination-based construction, which for the Sun is the ecliptic itself.

Verified to matter: a 250-day window put Saturn's plane in the wrong place and
made its aspects 20–40 months off.

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

**Motion sense:** westward, i.e. RA of the moving point *decreases*
(`raSign = −1`, `buildDirectionResult`). This only affects the animation, not
the arc.

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
* Placidus mode is legacy (semi-arc, RA advancing) and does **not** match the
  book for planet significators. Kept for comparison.

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
| 6 | Node window | per-planet (Saturn 6000 d) | fixed 250 d | Saturn **20–40 months** | verified |
| 7 | Arc method | Regiomontanus pole + oblique ascension | Placidus semi-arc; Campanus; raw RA; Placidus in zodiaco | for planet significators **4–6 years**; ASC significator: identical to Placidus | verified |
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

Rows the app does not reproduce (all run by `npm run verify:directions`; rows
marked *known miss* there do not fail the check).

| Direction | Source | Expected | App | Note |
|---|---|---|---|---|
| Mars ⚹(dexter) → Mars (12:15) | book | Jan 2007 | Nov 2006 | −2 mo |
| Mars □(dexter) → Mars (12:15) | book | Dec 2014 | Sep 2014 | −3 mo |
| Saturn △(dexter) → Venus (12:15) | book | Mar 2016 | May 2016 | +2 mo |
| Saturn ⚹ → DSC (12:15) | book | Feb 2013 | Apr 2013 | +2 mo |
| **Mercury ☌ Mars** (Diana) | blog | Jan 2017 (55) | 2012-09 | arc 50.5° vs ≈54.7° implied — **4½ yr** |
| **Saturn ☍ → IC** (William) | blog | Aug 1997 | 1994-07 | arc 11.9° vs 15.0° implied — **3 yr** |

**Mars→Mars.** Both are converse directions of a Mars aspect to Mars. The
alternatives tried for the aspect point (zodiacal lat 0, same latitude) are 1–2
years off, so the plane construction is the best available. Candidates: the
exact definition of "previous node"/"maximum elevation" for Mars (its latitude
changes sign several times per swing), or a Mars-specific detail in the source
software.

**Diana's Mercury→Mars.** Mercury has a large latitude (−4.7°). Variants tried,
none of which give 54.7°: Mercury and/or Mars projected to the ecliptic (40.95°,
42.77°, 48.63°), swapping promissor/significator (same arc), plain RA difference
(60.7°). The blog's own wording ("Mercury to Mars") does not say which is
promissor, nor whether it is a conjunction rather than another aspect; the text
I have is a summary, so an aspect-vs-conjunction mix-up is possible.

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

Short answer: the book says it *is* Morin's (Morinus) method, and I cannot
demonstrate a difference from the pages available — but I also cannot prove
equivalence, because I have not read Morin's *Astrologia Gallica* or the source
of any other implementation.

What the book claims its software does (pp. 377–381), and where each stands here:

| Claimed element | Here |
|---|---|
| Mundane conjunction = promissor reaching the significator's circle of position | implemented (§6) |
| Converse directions when the path > 180° (promissor fixed, significator carried) | implemented |
| Morin's circle of aspects | implemented (§4.1) |
| Two antiscia on the 3-D sphere | **not implemented** |
| Naibod key, 0°59′08″ | implemented |
| Directions to house cusps use the cusp's zodiac degree | angles/cusp degrees are used as ecliptic points; only ASC/DSC/MC/IC are wired in as significators |

The book states most programs "do not support the methods of calculating
directions proposed by Morinus", and that the software behind the book does. The
Morinus program (open source, separate from the book's software) exposes a menu
of methods (Placidus semi-arc, Regiomontanus, Campanus, zodiacal/mundane,
several keys); which combination equals the book's I have not checked. That
comparison is the useful next step, and §9 is laid out to make it a row-by-row
diff: run the other implementation on this chart, record each row's arc, and add
it to `scripts/verify-directions.mjs`.

The exact formulas in §6 were reached empirically (matching published dates),
not derived from Morin's text, so a different formulation that agrees on these
rows but differs elsewhere (other latitudes, high declinations, arcs near 180°,
angles on the lower meridian) is possible. The two open blog cases in §10 both
involve extreme geometry (Mercury at −4.7° latitude; a promissor 15° from the
IC) and are the likeliest places to find such a difference. The blog also
remarks that points of close declination "merge into one point in the
direction"; that is a description of a coincident promissor/significator in 3-D
and does not by itself change any arc formula here.

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
