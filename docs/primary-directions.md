# Primary directions — how the calculator works

Internal reference. One method, no settings: Regiomontanus primary directions
with Morin's circle of aspects and the Naibod key, as described by the author of
the *Predictive Astrology Textbook* (Alexey Borealis) and reproduced against his
published dates. Code: `src/astro.js`. Check: `npm run verify:directions`.

## 1. The pipeline

```
birth (local time, UTC offset, lat, lon)
  → UT
  → natal RA/Dec of every point (planet, angle, aspect point, house cusp)
  → arc in degrees between promissor and significator
  → years = arc / 0.985556          (Naibod: 0°59′08″ per year)
  → date  = birth + years · 365.2422 days
```

Everything is geocentric, true ecliptic and equator of date, apparent sidereal
time, geometric horizon (`astronomy-engine` does the ephemeris).

## 2. Points

| Point | How |
|---|---|
| Planet | geocentric RA/Dec **with its own latitude**. (Topocentric would move the Moon ~1°, i.e. ~1.5 yr.) |
| ASC / MC | closed form from RAMC and true obliquity ε: `MC = atan2(sin RAMC, cos RAMC·cos ε)`, `ASC = atan2(cos RAMC, −(sin RAMC·cos ε + tan φ·sin ε))`; IC, DSC are the opposites. On the ecliptic (latitude 0). |
| House cusp `C n` | Regiomontanus: the house circle through the horizon's North point and the equator point at RAMC + 30°·k meets the ecliptic. Used as a *zodiac degree* (latitude 0). Solved in closed form. |
| Aspect point of a planet | Morin's circle of aspects (§3). |
| Conjunction | the planet itself. |

A planet's own aspect to itself (e.g. Sun ⚹ → Sun) is a valid direction; its
self-conjunction is not.

## 3. Aspect points — Morin's circle of aspects

Aspects are not cast on the ecliptic, they are cast on a plane built from the
planet's apparent path:

1. Find the planet's previous and next latitude node (sign changes of ecliptic
   latitude) and the **maximum |latitude|** between them. Search windows are per
   planet — Mercury 250 d, Venus 400, Mars 900, Jupiter 2500, Saturn 6000
   (`NODE_SEARCH_DAYS`); a fixed 250 d gave Saturn a wrong plane.
2. The plane passes through the planet's current position and is **inclined to the
   ecliptic by that maximum latitude**.
3. Two mirror planes have that inclination through the planet (ascending or
   descending side). Take the one whose own highest point falls at the longitude
   where the planet actually peaked. (If it is at its peak now: use its motion.)
4. The aspect point is the point on this plane 60° / 90° / 120° / 180° away *along
   the plane*. **Sinister = +offset (toward increasing longitude), dexter =
   −offset.** The Sun's latitude is ≈ 0, so its plane is the ecliptic.

Dead ends, for the record: the great circle through the planet and its
maximum-latitude point ("two points") gives an aspect point at latitude −12.9°
where the source dates imply −7.1° (Elizabeth II's Venus); choosing the mirror plane
by instantaneous motion fails for a planet at a station.

## 4. The arc — circle of position

Each point X (hour angle H, declination δ) sits on a **circle of position**: the
great circle through the North and South points of the horizon and X. It crosses
the equator at hour angle **A**. Its pole height is

```
tan p = tan φ · |sin A|        (φ = geographic latitude)
```

(p = φ for a point on the horizon, 0 on the meridian). Under that pole, oblique
ascension is `OA = RA ∓ AD`, `AD = asin(tan δ · tan p)`; minus for a point east of
the meridian, plus for west. Then, mod 360°:

```
direct   = OA(promissor)   − OA(significator)    significator's pole and side
converse = OA(significator) − OA(promissor)      promissor's pole and side
```

**Direct** carries the promissor west onto the significator's circle. **Converse**
holds the promissor's circle fixed and carries the significator to it. The
calculator reports **direct, unless it exceeds 180°, then converse** (book p.378).

This is the author's own formula (his Placidus article: `Arc = RA_P − arcsin(tan D_P
· tan φ · cos(OA_ASC − M)) − M`, "the same for any house system, only the mundane
position M changes"): `cos(OA_ASC − M)` is `|sin A|`. Verified independently by
solving the exact circle intersection numerically.

For ASC/DSC the pole is φ, so the arc to the ASC is plain oblique ascension.
Primary motion is westward; the animated marker's RA therefore decreases.

## 5. Verification

`npm run verify:directions` compares against everything published that I could
find. Tolerance 3 months (the publications give a month).

| Source | Rows | Result |
|---|---|---|
| Textbook Ex. 35, Tables 3.9/3.10 (12:15 and 12:16) | 13 + 8 | all within 1 month |
| Queen Elizabeth II (thematic-directions post) | 6, incl. 3 to the 5th-house cusp | all within 1 month; 8 cusps < 1′ |
| Diana (blog) | 3 of 4; 4 cusps < 1′ | Saturn☍→Mercury, Jupiter☍→Mercury, Sun□→Jupiter ✓ |
| William (blog) | 0 of 1 | shortest-path converse, §6 |
| Original list (author's tool at 12:16) | 8 of 9 | Apr 2018 is 2019 in the book's own tables; "Sun ⚹ → Sun Oct 2008" matches **Sun ⚹ → MC 2008-10-13** |

Sensitivity to know when comparing: **1 minute of birth time = 20–95 days** (ASC
directions most), 1 second ≈ 1–2 days, 1′ of latitude ≈ 5–7 days. The author
himself says directions give the *year*; the day comes from solar/lunar returns
(not implemented).

## 6. Known gaps

- **Two blog rows follow the other converse convention** (resolved, §13):
  Diana's Mercury ☌ Mars (blog Jan 2017; ours 2012-09) and William's Saturn ☍ → IC
  (blog Aug 1997; ours 1994-07). Both are exactly reproduced by the *shortest-path*
  ("modern") converse — arc measured under the **significator's** pole, the way the
  Morinus freeware does it (54.69° → Dec 2016; 14.96° → Aug 1997). The book's own
  tables and Elizabeth II's directions all follow the traditional converse we use
  (promissor's pole), and the book (p.378) calls the shortest-path method a mistake.
  We keep the traditional one; these two rows stay marked as known misses.
- **Ages** in the author's tool (3.8 / 23.3 / 31.7 / 41.9) don't equal
  arc/Naibod for its own dates; dates are right, the age column is unexplained.
- **Antiscia** (two per planet, book p.379): not implemented (definition in §10).
- The "bound changes" table rows still use an older, simpler RA-advance model.

## 7. Placidus (tried, removed)

Implemented from the author's *Mundane Position in the Placidus System* and
reproduced his Churchill example exactly (Sun → Mercury: mundane position 233°42′,
arc 24°25′, 24.78 y, September 1899), then removed to keep one method. To restore:
`RA_M = RAMC(or IC) ± 90°·MD/SA`, with `SA_diurnal = 90° + AD`, `SA_nocturnal =
90° − AD`, `AD = asin(tan φ tan δ)`; direct = carry the promissor along its parallel
until its mundane position equals the significator's. Placidus and Regiomontanus
agree for ASC/DSC significators and differ by years for planets (Ex. 35 Sun △ →
Jupiter: 29.6° vs 24.9°; the book's dates follow Regiomontanus).

## 8. Comparing another method

Add a `DATASET` entry to `scripts/verify-directions.mjs`
(`[promissor, glyph, sinister|dexter, significator, expected 'YYYY-MM' …]`, `C5`
= 5th-house cusp) and run it. The choices that move a date, with measured size:

| Choice | Ours | Effect if different |
|---|---|---|
| Ecliptic frame | true, of date | J2000: ~4 months |
| Angles | closed form, geometric horizon | sampled/refracted: 1–2 years |
| Planet positions | geocentric | topocentric Moon: ~1.5 years |
| Aspect plane | inclination = max latitude, branch by peak | two-point / motion test: 1.5–8 years |
| Node window | per planet | fixed 250 d: Saturn 20–40 months |
| Arc | Regiomontanus poles + OA | Placidus: 4–6 years for planets |
| Converse | direct unless > 180° | shorter-of-two: same on all tested rows |
| Key | Naibod 0.985556°/yr | Ptolemy 1°/yr: ~7 months at 42 y |

## 9. Why we ended up with these choices

Every choice below was made by comparing against the author's published dates,
not by taste. Format: what looked reasonable → what it broke → what fixed it.

**Angles in closed form, geometric horizon (not sampled, not refracted).**
The app first found the ASC where the *refracted* altitude of a sampled ecliptic
crosses zero and snapped the MC to the nearest 2.5° sample. Refraction lifts the
horizon by ~0.6°, which at 55°N shifts the ASC by ~1.8° of longitude; the sampling
put the MC up to 1.25° off (it read exactly 7°30′ Sag when it is 6°50′). A direction
to the ASC moves ~1 year per degree, so this alone was worth 1–2 years. Astrological
angles are geometric (unrefracted), and the formulas are exact, so we use them.
Confirmed by the published charts: MC 6°36′ Sag at 12:15, ASC 0°20′ Aqu at 12:16.

**True ecliptic of date (not J2000).** `astronomy-engine` has two ecliptics:
planet longitudes come out in the true ecliptic of date, but the ecliptic→equator
step used the J2000 one. In 1976 that is 0.34° of precession (~4 months of arc),
growing with distance from 2000, so ASC/MC/cusps/aspect points were shifted
relative to the planets. Every published chart has planets *and* angles, so a
mismatch shows up immediately as a wrong ASC. Everything now uses the true
ecliptic of date.

**Geocentric positions for directions (not topocentric).** Drawing the sky needs
topocentric positions (parallax changes where a body appears). But the source's
Moon directions were 16–19 months earlier than ours until we switched: the Moon's
parallax is up to ~1°, i.e. ~1 year of arc, and the author's software plainly works
in geocentric coordinates (Sun → Moon: Oct 1990 exact, Venus → Moon: Feb 2006
exact, once geocentric). For the Sun and planets the difference is negligible,
which is why it only showed up on Moon rows.

**Circle-of-position arc (not raw RA, not Placidus).** The first version measured
the arc as an RA difference, which treats the ASC as a fixed RA point; it was years
off. Placidus semi-arcs match the ASC rows exactly (the ASC lies on the horizon,
where all systems agree) but were 4–6 years off for planet significators
(Sun △ → Jupiter: 29.6° vs the source's 24.9°). Only the Regiomontanus circle of
position — each point on the great circle through the horizon's N/S points, arcs
measured as oblique ascension under that circle's pole — reproduced the planet
rows, and it is the author's own equation. Placidus was later implemented from his
articles and matched his Churchill example, but his Regiomontanus dates are the
ones we want, so it was removed.

**Converse when direct > 180°.** Directions to the ASC by a planet already above
the horizon would need ~360° direct. The book (p.378) says to hold the promissor
fixed and carry the significator instead. We first picked "the shorter arc"; it
gives the same dates on all tested rows, but the book's rule is stated, so we use it.

**Morin's aspect plane: inclination = maximum latitude, branch by where the peak
falls.** The first construction ("the great circle through the planet and its
max-latitude point", the literal reading of the book) tilted the plane too much
when the planet was near its node: Elizabeth II's Venus (32° of longitude from its
peak) got a 15° plane instead of 8.4°, so its sextile point sat at latitude −12.9°
where the published dates imply −7.1°. The author's own article says the extremum's
latitude *is* the inclination, and that reproduces both Venus rows exactly. Choosing
between the two mirror-image planes by the planet's instantaneous motion failed for
a planet at a station (Saturn moves 0.003°/day in the book's chart); using where
the peak actually occurred fixed Saturn.

**Per-planet node search windows.** The first search looked ±250 days for the
neighbouring latitude nodes. Fine for Venus, but a planet's latitude swing lasts
about half its period — years for Saturn — so Saturn's plane was built from the wrong
swing and its aspects were 20–40 months off. Windows now scale with the planet.

**Naibod key 0°59′08″, `365.2422` days.** The book states the key. The value
`360/365.2422` is within 0.1% of it; the printed value is used so the arithmetic
matches his (1° ≈ 1.0147 years). Ptolemy's 1°/year would shift a 42-year arc by
about 7 months; the author reports Naibod as the most accurate.

**Cusps by closed-form house circles.** Cusps aren't needed for ASC/MC directions
but are for the 5th-house-cusp rows (Elizabeth II) and for display. The earlier
sampled version placed the division point through the refracted horizon and
interpolated on a 0.5° grid: 4–6′ errors. Solved exactly they match four
published charts to under 1′.

**12:15 vs 12:16.** The book's chart is 12:15 (official) and its rectified time
is 12:16; one minute moves an ASC direction by ~3 months, other rows by 1–2. Both are
now reproduced, so the site works for either; we use whatever time the user enters.

**One method, no switches.** Earlier builds exposed Regiomontanus/Placidus for
directions and two aspect-plane constructions. Only one of each reproduces the
published dates, so the alternatives were removed rather than left as options that
give worse answers. Their formulas and measured effects are recorded in §7–§8.

**What we did not "fix".** The two blog rows that don't reproduce (§6) were left
alone: no tested variant improves them without breaking rows that do match, so we
would be fitting noise. They are marked as known misses in the verification script.

## 10. Morin's own text (Astrologia Gallica Book 22, Holden's translation)

Read after the method was built; it confirms it rather than changing it. Page
numbers are the translation's. The PDF is in the user's library, not the repo.

**Confirmed.**
- **The arc.** Appendix 5 (pp.151–153, Holden's Regiomontanus formulae): pole of
  Point 1's circle of position, oblique ascension of both points under that pole,
  `Arc = OA2 − OA1`; latitude included ("mundane", Morin's preference) or not
  ("zodiacal"); western-half points via `OD = RA + AD`; MC → `Arc = RA2 − RAMC`;
  ASC → `OA2 − RAMC − 90°`; an intermediate cusp = its longitude at latitude 0.
  Its worked example (Mars → Jupiter, Hemminga chart, RAMC 165°24′, φ 53°N) gives
  pole 47°21′ and arc 25°46′; the app reproduces every intermediate value and the
  arc (25.768°) — now a hard check in `verify-directions.mjs`. The equations there
  (`G, H, A, P, CP`) are the same pole as `tan p = tan φ·|sin A|`.
- **One rule, not two** (Section I ch.7, pp.14–17): "the following terminus, by
  the motion of the primum mobile, is carried to the circle of position of the
  preceding terminus", ascensions taken under the *preceding* terminus's pole. That
  is our direct / converse pair: the point that stays put supplies the pole. Morin
  says direct and converse of the same pair are one concourse with one effect, so a
  single row per pair is right.
- **Aspect plane** (Section II ch.2–3, pp.32–35; Book 16 ch.9, Appendix 2,
  pp.127–130): the circle of aspects is inclined to the ecliptic by "the maximum
  latitude the planet can attain in the northern or southern part in which it is
  situated"; the planet's distance from the node follows from
  `tan(max lat) : tan(lat) = 1 : sin(arc)`; sinister aspects are counted 30°/60°/
  90°… along the circle from there, **dexter aspects are the antipodes of the
  sinister ones with latitude reversed**. Bianchini's instantaneous-latitude
  circle is explicitly rejected (the planet would run toward the ecliptic on it
  while actually moving away). All as implemented in §3.
- **Naibod** (Section III ch.3, pp.56–58): 59′08″ per year (1° ≈ 1 y 5 d 8 h),
  preferred to Ptolemy's 1°/y, Tycho's true daily solar RA motion ("deviates too
  much … after the 30th year", 54′–67′) and Kepler's true daily solar motion.
- **Regiomontanus, not Placidus** (Holden's preface p.xii; ch.8 example, pp.25–26):
  Morin used Regiomontanus houses and directions; his example compares his
  66°52′ with the Ptolemaic/Placidian proportional-semi-arc result 64°07′ and calls
  the difference a difference of method.

**Two useful cautions from the text.**
- The node position is extremely sensitive to the latitudes used (Holden's note to
  the Venus example: 1′ of latitude moves the arc-from-node by 43′). Aspect points
  of a planet near a node are therefore only as good as its ephemeris latitude —
  this is where small residuals against published dates are most likely to hide.
- Morin often notes that the direction *without* latitude usually differs in time
  from the one with; he treats both as possibly acting, but trusts the one with
  latitude more. The calculator is mundane only.

**Antiscia — defined, checked, not yet in the calculator.** Section II ch.5 (p.45):
antiscia are efficacious promittors (never significators); a planet with latitude
has **two**, the ecliptic points (latitude 0) at the planet's own declination
(`sin L = sin δ / sin ε`, and `180° − L`). Test on the textbook's Hitler example
(1889-04-20 18:30 LMT Braunau, 48°16′N 13°02′E → 17:38 UT): Venus δ = 22.906°, its
antiscia are at 17°57′ Gemini and 12°03′ Cancer, and the first directed to Saturn
gives 55.68° → **Oct 1945** (textbook: "September 1945", though it places that
point at 11° Gemini, which does not match the declination rule — likely a typo).
Adding them as promissors would be small; left out to keep the table basic.

**Still unexplained.** Nothing in Morin's text bears on the two blog rows in §6
(Mercury ☌ Mars for Diana; Saturn ☍ → IC for William): he has no special rule for
the IC, and his single-rule statement gives our value for William's row.

## 11. Gansten, *Annual Predictive Techniques* (Wessex Astrologer, 2020)

Not a source for our method (it teaches **Ptolemaic proportional semi-arcs**, and says
it does not describe position-circle methods), but useful context. Page numbers are
from its index; the PDF is in the user's library, not the repo.

- **Same mechanics for the angles** (App. II): MC → `MD = RA_promissor − RAMC`; IC →
  the MC to the opposite point; ASC → `HD = OA_promissor − (RAMC + 90°)`,
  `AD = asin(tan δ tan φ)`. Identical to §4 for angles.
- **Direct and converse are both done with the primary motion** (pp.34–37); only
  software labels mean "forwards/backwards in time". Same reading as Morin (§10).
  Traditional wording: the *significator* is directed to the *promissor*.
- **House system and direction system are independent** (p.37). Directions here are
  Regiomontanus regardless of the house choice in the 2D chart.
- **Where he differs from our choices** (recorded so we don't re-litigate):
  - *Lunar parallax*: he uses the **topocentric** Moon ("far more accurate results",
    ≈1° ≈ 1 year for a Moon near the horizon; pp.70–71). The Ex. 35 Moon rows match the
    author's tool only with the **geocentric** Moon (§9), so we follow the tool.
  - *Key*: he uses Ptolemy's 1°/yr; Naibod (Morin's, ours) is his "second most
    common". He agrees with Morin that no key removes the spread of events before
    and after perfection.
- **Software settings guide** (App. III, Morinus program): method = Placidus
  (semi-arc, Ptolemaic) / Regiomontanus / "Placidus under the pole"; Campanus ≡
  Regiomontanus for directions; zodiacal vs mundane aspects; "use latitude of
  significator"; key; parallax. A checklist for comparing another program's output
  with ours.
- **Worked semi-arc example** (App. II, Presley, Sun → ☍ Jupiter with latitude,
  arc 25°00′) is a test case if a Ptolemaic mode is ever restored (§7).
- **Solar returns** (ch.5): tropical year 365.2422 d vs sidereal 365.2564 d (~20 min
  longer); early authors used a fixed constant. For timing *within* a year he relies
  mainly on real-time transits, not directions — relevant only if returns are ever
  added; nothing in the direction calculator depends on it.

## 12. Louis, *Primary Directions in Astrology: A Primer* (2013)

An explainer built around Robert Nagy's freeware **Morinus** program (an independent
implementation; not the same thing as Borealis's software). Prefers Ptolemaic
semi-arcs with latitude, so it is context, not a source for our method.

- **Angles**: "consensus" — ASC by oblique ascension, MC by right ascension (ch.10).
  Same as §4.
- **Regiomontanus vs Ptolemy** (ch.10): circle-of-position directions for
  planet-to-planet "often differ from Ptolemy's calculations by two or three years"
  — the same divergence measured in §8 (4–6 years for the worst rows). He notes
  Morin and Lilly used Regiomontanus with excellent results.
- **Converse = role swap, motion unchanged** (ch.9): "A still moves to B by primary
  motion, but the roles … have exchanged". Same reading as Morin and Gansten.
- **Mundane (with latitude) vs zodiacal** (ch.4): Morin preferred mundane; a
  zodiacal direction of the same pair usually falls at a different date (his Shirley
  Temple example: 14.498° vs 15.709°, 15 months apart) and Morin treats the two as a
  *range*. We compute mundane only.
- **Keys** (ch.4): Ptolemy 1°; Naibod 0°59′08″ = 360/365.2422 = 1.01456 years per
  degree (ours is the book's 0°59′08″ = 1.01465; ≈1 day at age 40); Tycho's and
  Placidus's variable keys "less reliable in practice"; his own experimental
  midpoint key 0°59′34″. Morin and Lilly found Naibod closest to events.
- **Lunar parallax** (ch.4): "a difference of a year or two" for Moon directions;
  he does not say which is right (Gansten prefers topocentric; the target author's
  tool is geocentric — see §11, §9).
- **Precision is a myth** (epilogue): "Precise hits are actually quite rare.
  Originally primary directions were used to determine the approximate year."
  Consistent with the 1-minute-of-birth-time sensitivity in §5.
- **What could be done with it**: the Morinus program can print direction tables
  (Regiomontanus, mundane, with latitude, chosen key). Running it on the Example 35
  chart would give an independent implementation to diff against ours, particularly
  for the two rows in §6 that no source explains.

## 13. The Morinus freeware (Nagy), read from its source

The user's copy (`Morinus.app`, 2012, Python 2.7 / wxPython, GPLv3) can't run on the
current macOS, but its modules sit in `Resources/lib/python2.7/site-packages.zip` as
`.pyo`. Decompiled with `uncompyle6` in a throwaway venv (nothing copied into this
repo; GPL source was only read for comparison). Files: `regiomontanpd`,
`regiocampbasepd`, `primdirs`, `planets`, `antiscia`. Findings:

- **Same arc core as ours.** `arc = W_prom − W_sig`, with
  `W_prom = RA ∓ asin(tan δ_prom · tan POLE_sig)` and the east/west side taken from the
  **significator** (`plsig.eastern`); POLE and W of a point come from its own circle
  of position (its `getZD` is the standard Regiomontanus zenith-distance recipe).
  For house cusps it uses `POLE = asin(sin φ · sin ZD)` with ZD from the cusp's
  meridian distance. Consistent with Holden's Appendix 5 and with §4.
- **Converse is the "modern" one** (`PrimDirs.create`): `arc = W_prom − W_sig`;
  negative → `|arc|` marked converse; `> 180°` → `360° − arc`, flipped. So even a
  converse arc is measured under the *significator's* pole (promissor carried
  backwards). Ours, following the book and Morin, uses the fixed point's pole.
- **Which rows each convention explains** (our full verification set re-run with the
  freeware's normalisation, one-line change to `computeRegiomontanusDirection`):
  Diana's Mercury ☌ Mars → 54.69° (2016-12, blog Jan 2017) ✓ and William's Saturn ☍
  → IC → 14.96° (1997-08, blog Aug 1997) ✓ — but every converse row of the book's
  Table 3.9 and of Elizabeth II breaks by 12–48 years. So the two blog articles used
  the shortest-path convention (or software implementing it) while the book and the
  Elizabeth article use the traditional one. Direct rows are identical in both.
- **Aspects**: only *mundane* aspects (added in RA to the significator's W) or
  *Bianchini's* circle (`lat_aspect = asin(sin(lat)·cos(aspect))`, the instantaneous-
  latitude circle Morin rejects). **Morin's circle of aspects is not implemented**, so
  the freeware cannot check §3 (matching the book's remark that most programs don't
  support Morin's method).
- **Antiscia**: mirror of the longitude across the Cancer/Capricorn axis **keeping the
  planet's latitude**, plus a contra-antiscion (+180°) — not the "equal declination
  points on the ecliptic" of Morin's text (§10).
- **Key**: Naibod coefficient `1.01456164` yr/° (= 365.2422/360), dates
  `JD + years · 365.2421904`; Ptolemy `1.0`; Cardan `0°59′12″`. Ours: `1.014647`, same
  to ~1 day at age 40.
- **Secondary motion of the Moon** and a topocentric option exist in the program
  (`SecMotion`, `options.topocentric`); the default for the Moon is not established
  from the source alone.
