# Celestial Sphere

A 3D primary-directions astrology visualizer — Three.js scene (zodiac band,
planets, angles, house cusps, directional arcs) layered over a real
stellarium-web-engine background for the "view from center" first-person
sky.

Live: https://celestial-sphere-5xz.pages.dev/

## Running locally

```
npm install
npm run dev
```

`npm run build` produces a static `dist/` deployable to any static host
(this project deploys to Cloudflare Pages).

## License

AGPL-3.0 (see `LICENSE`). This project bundles
[stellarium-web-engine](https://github.com/Stellarium-Labs/stellarium-web-engine)
(compiled to WASM, plus its own demo sky data — star/DSO catalogs, the
western skyculture, the `guereins` landscape, Sun/Moon/Milky Way survey
tiles — all under `public/stellarium/`), which is itself AGPL-3.0 (or a
commercial license, at Stellarium Labs SRL's option). Because this app is
served as a network service, source is published here to satisfy the AGPL's
network-use clause for that dependency.

## Third-party components

- **stellarium-web-engine** — AGPL-3.0 / commercial, © Stellarium Labs SRL.
- **three.js**, **astronomy-engine** — MIT.
- Milky Way texture — NASA SVS "Deep Star Maps 2020" (public domain).
- Ground landscape photo — Poly Haven "Horn-Koppe Spring" HDRI (CC0).
- Star catalog (`public/bright_stars.json`) — HYG database (public domain).
- Birth-place search — [OpenStreetMap Nominatim](https://nominatim.org/) (© OpenStreetMap contributors, ODbL); time zone of a place via [timeapi.io](https://timeapi.io/) through `functions/api/timezone.js`. The UTC offset for a birth date comes from the browser's own historical IANA time-zone data.
