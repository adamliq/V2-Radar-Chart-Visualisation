# Changelog

All notable changes to the v2-radar-chart-visualisation app.

## 2.3.0

**radar_chart_studio** (Dashboard Studio-native visualization):

- Rewrote the vendored D3 engine (`src/vendor/d3-radar-chart.js`) from d3 v3
  against d3 v7, and bumped the `d3` dependency accordingly. The classic
  `radar_chart` visualization is unaffected - it keeps its own
  webpack/RequireJS build on d3 v3.
- This surfaced and fixed a real, pre-existing-shape bug along the way: d3
  v4+'s "general update pattern" no longer merges newly-entered elements
  back into the selection a chained `.transition()`/`.style()` call was
  written against (d3 v3 did this automatically). Without an explicit
  `.merge()` at each affected join, a few elements would have been created
  correctly but never received their settled style/attribute values until a
  *second* render happened to re-match them by key - on a real, single
  initial render, this would have shown as the radar areas' fill-opacity
  stuck at 0 and empty/incompletely-wired legend cells. Fixed by merging
  the entered selection back in at every affected join. Caught by the
  committed regression suite, which now also directly checks for this (axis
  line/legend counts, legend swatch/transform completeness, and area
  opacity on a render that hasn't yet repeated).
- Other v3 -to- v7 API changes carried through: `d3.scale.*` to
  `d3.scaleOrdinal()`/`d3.scaleLinear()`, `d3.svg.line.radial()` to
  `d3.lineRadial().curve(...)`, `d3.svg.symbol()` to `d3.symbol().type(...)`
  (string symbol names mapped to v7's symbol-type constants; d3 v7 has no
  built-in downward-pointing triangle, so `'triangle-down'` is now drawn
  from a small custom symbol-type definition mirroring `d3.symbolTriangle`'s
  geometry), and `.on()` event handlers' argument order (`(event, d)`
  instead of v3's `(d, i)` - this chart's own hover/click handlers never
  used the index, so no behavior change there). d3 v3's nested-selection
  "group index" (a third callback argument, used for per-axis positioning)
  is gone in v7; replaced with an explicit axis-name-to-index lookup built
  once per render.
- `build.mjs` no longer needs to patch d3's UMD bundle for its unbound-`this`
  bug - that was specific to v3's bundle shape, and v7 ships proper ESM.
  Picked up a new, unrelated-to-the-rewrite build fix instead: the `d3`
  package declares `"sideEffects": false`, which made esbuild tree-shake
  away `d3-transition`'s prototype patch (`selection.prototype.transition`)
  since nothing referenced it by name - fixed with an explicit
  side-effect-only `import 'd3-transition'`.

## 2.2.0

**radar_chart_studio** (Dashboard Studio-native visualization):

- Added drilldown support: clicking a data point fires `key`/`axis`/`value`
  Dashboard Studio drilldown actions. Registered once per chart point (not
  on every render) to work within `addDrilldownListener`'s lack of an
  unregister API - see the app's README for the full design and its one
  unverified caveat (whether Studio itself garbage-collects a registration
  after its node is removed).
- Replaced the `d3-legend.js` dependency (a 2015, unmaintained third-party
  library, which also turned out to have its own latent bug - see below)
  with a small, purpose-built legend renderer. Behavior is unchanged:
  same click-to-toggle, hover-dim, and keyboard access as before.
- Added a "Loading..." placeholder (previously blank while waiting on the
  first search result).
- An invalid "Number format" string no longer crashes the chart - falls
  back to the default formatter instead of letting d3 v3's `d3.format`
  throw.
- Fixed a bug in the (now-removed) `d3-legend.js`: a stray `;` where the
  original third-party source meant a `,`, breaking a `var a = ..., b = ...`
  declaration chain and silently creating implicit globals - the same class
  of bug fixed in `d3-radar-chart.js` in 2.1.1, caught in the same way
  (strict mode, via `<script type="module">`).
- Added a committed regression test suite (`appserver/static/visualizations/radar_chart_studio/test/`,
  run via `npm test`): a mocked `DashboardExtensionAPI` driving the built
  bundle in a real headless browser. This is what caught every fix above,
  and the three fixed in 2.1.1, before any of it reached AppInspect or a
  real Splunk instance.

**Classic `radar_chart` visualization:**

- Backported the three undeclared-variable fixes from 2.1.1's
  `radar_chart_studio` port to this visualization's own
  `contrib/js/d3-radar-chart.js` and built `visualization.js`. Dormant there
  today (that build runs as a non-strict RequireJS/webpack script, which
  tolerates them), but a latent trap for anyone who later touches that code
  under different conditions.

## 2.1.1

- Fixed a real functional gap in `radar_chart_studio`: the legend never
  rendered. The vendor engine gates its legend-drawing code on
  `if (d3.legend)`, and the 2.1.0 port had concluded (incorrectly - it had
  only checked the classic viz's wrapper, not the engine itself) that
  `d3-legend.js` was dead code and left it unported.
- Fixed three latent bugs in the ported D3 engine (`update_radarCircle`,
  `update_radarInvisibleCircle`, and the hover tooltip's `newX`/`newY` were
  all assigned without being declared - implicit globals that only broke
  under Dashboard Studio's strict-mode `<script type="module">` loading)
  and one in `d3-legend.js` itself once it was properly ported.
- Made the legend's click-to-toggle-visibility keyboard-reachable.
- `validateFields` now checks `key`/`axis`/`value` are actually present, not
  just that unexpected fields aren't - surfaces a clear error instead of a
  silent empty chart.
- Numeric format options are now parsed with an explicit `NaN` fallback,
  fixing a case where a cleared format-panel field produced `NaN` instead
  of the documented default.
- Placeholder/error text is now theme-aware (previously light-theme-only,
  failing WCAG AA contrast on a dark panel).

## 2.1.0

- Added `radar_chart_studio`: a Dashboard Studio-native port of the classic
  `radar_chart` visualization, built on
  `@splunk/dashboard-studio-extension`. Ships alongside the classic
  visualization rather than replacing it, so Simple XML dashboards and
  pre-10.4 Splunk keep working. Requires Splunk Enterprise 10.4+ or an
  equivalent Splunk Cloud Platform release.

## 2.0.0

- Repackaged the original *Custom Radar Chart Visualization* Splunkbase
  app as `v2-radar-chart-visualisation`, made Splunkbase/AppInspect
  compliant: new app id/manifest, fixed non-square app icons, corrected
  `display.visualizations.custom.*` keys, fixed a duplicate `maxValue` key
  in the visualization's default config, and refreshed README/LICENSE
  metadata while preserving upstream credits and third-party license text.
