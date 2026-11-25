# Changelog

All notable changes to the v2-radar-chart-visualisation app.

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
