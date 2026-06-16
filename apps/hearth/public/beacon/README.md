# Beacon (neutral build)

A framework-agnostic instrument-panel UI system: `tokens.css` (3 themes: dark/light/wall) +
`beacon.css` (`.bcn-*` components) + `beacon.js` (theme, toast, modal, command palette, ASCII radar) +
self-hosted fonts (Chakra Petch · IBM Plex Mono · IBM Plex Sans) + Lucide icon sprite. No CDN.

## Adopt
```html
<html data-theme="dark" style="--accent:#8b5cf6">
  <link rel="stylesheet" href="beacon/tokens.css">
  <link rel="stylesheet" href="beacon/beacon.css">
  ...
  <script src="beacon/beacon.js"></script>
</html>
```
Set `--accent` to your brand color; use `.bcn-*` classes; `Beacon.initTheme({theme,accent})`.
