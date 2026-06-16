# Beacon · fonts/

Beacon is **air-gapped** — no CDN, no Google Fonts, no runtime network. The three
families are loaded by `@font-face` in `tokens.css` from **this folder**. Until you
vendor the `.woff2` files here, the system falls back to metric-approximate system
fonts (Bahnschrift/DIN for display, the platform mono, Segoe/Helvetica for sans).

## Drop these files in (exact names — `tokens.css` references them)

| File | Family / weight |
|------|-----------------|
| `ChakraPetch-Medium.woff2`   | Chakra Petch 500 |
| `ChakraPetch-SemiBold.woff2` | Chakra Petch 600 |
| `ChakraPetch-Bold.woff2`     | Chakra Petch 700 |
| `IBMPlexMono-Regular.woff2`  | IBM Plex Mono 400 |
| `IBMPlexMono-Medium.woff2`   | IBM Plex Mono 500 |
| `IBMPlexMono-SemiBold.woff2` | IBM Plex Mono 600 |
| `IBMPlexSans-Regular.woff2`  | IBM Plex Sans 400 |
| `IBMPlexSans-Medium.woff2`   | IBM Plex Sans 500 |
| `IBMPlexSans-SemiBold.woff2` | IBM Plex Sans 600 |

## Sources (all open-source, redistributable, vendor into the repo)

- **Chakra Petch** — SIL Open Font License 1.1
- **IBM Plex Mono / IBM Plex Sans** — SIL Open Font License 1.1

Convert TTF→WOFF2 with `woff2_compress`, or grab the prebuilt `.woff2` from the
upstream font repos, then commit them here. Subsetting to Latin + the box-drawing
glyphs the radar uses (`· • ◆ › ─`) keeps each file small.

> Keeping fonts in-repo is deliberate: every app vendors `beacon/` so a datacenter
> with zero egress still renders pixel-identical type.
