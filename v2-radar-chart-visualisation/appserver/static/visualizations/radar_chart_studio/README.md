# radar_chart_studio visualization

Dashboard Studio-native port of the classic `radar_chart` visualization
(`appserver/static/visualizations/radar_chart`), built on
[`@splunk/dashboard-studio-extension`](https://www.npmjs.com/package/@splunk/dashboard-studio-extension)
per Splunk's current custom visualization framework. Requires **Splunk
Enterprise 10.4+** or an equivalent Splunk Cloud Platform release.

It renders the same D3 radar chart as the classic viz (same required
fields, same look), but runs as a sandboxed iframe extension instead of a
RequireJS/`SplunkVisualizationBase` module, and can be dropped onto a
Dashboard Studio dashboard directly - the classic viz cannot.

Dashboard JSON visualization type: `v2-radar-chart-visualisation.radar_chart_studio`

## Required fields

Same contract as the classic viz:

| Field | Required | Description |
|---|---|---|
| `key` | yes | Category/series name |
| `axis` | yes | Axis label |
| `value` | yes | Numeric value for the key/axis pair |
| `keyColor` | no | Hex color to override the auto-assigned series color |

```spl
| makeresults
| eval key="current", "Business Value"=.37, Enablement=8.64, Foundations=2.56, Governance=1.68, "Operational Excellence"=4.992, "Community"=9.66
| untable key, axis, value
| eval keyColor="magenta"
| append
    [| makeresults
    | eval key="better", "Business Value"=9.37, Enablement=2.64, Foundations=4.56, Governance=6.68, "Operational Excellence"=9.992, "Community"=9.66
    | untable key, axis, value
    | eval keyColor="#33FF55"]
```

## What changed vs. the classic viz

- **Sizing**: the panel's own width/height (`VisualizationAPI.addDimensionsListener`)
  replaces the classic viz's manual `chartHeight`/`chartWidth`/`fullScreen`
  options - Dashboard Studio panels are already resizable, so there's nothing
  left for those options to do.
- **Theme**: axis/legend colors left unset now follow Splunk's light/dark
  theme (`VisualizationAPI.addThemeListener`) instead of being hardcoded for
  a light background; set them explicitly in the format panel to override.
- Everything else (required fields, `keyColor`, all remaining format options,
  the rendering math) is unchanged - `src/vendor/d3-radar-chart.js` is the
  classic viz's `contrib/js/d3-radar-chart.js` verbatim, aside from the fixes
  below.

`contrib/js/d3-legend.js` was not ported: the classic viz's RequireJS module
list imports it, but nothing in its code ever calls it - it's dead weight,
confirmed by grepping the classic source for any `d3.legend`/`legend(` call.

### Bugs fixed during the port

The classic engine relied on assigning to a few undeclared variables
(`update_radarCircle`, `update_radarInvisibleCircle` in the main render path,
and `newX`/`newY` in the hover tooltip handler) and on d3 v3's UMD bundle
reading an implicit, unbound `this` as the global object. Both are
sloppy-mode-only behaviors: the classic webpack/RequireJS build happened to
run as a non-strict script, so these went unnoticed. Dashboard Studio loads
visualizations via `<script type="module">`, which is always strict mode,
so both would throw at runtime. Fixed by declaring the variables properly
(`var update_radarCircle = ...`, etc.) and by having the build explicitly
bind d3 v3's IIFE to `globalThis` (see `build.mjs`). Caught and verified via
a headless-browser smoke test against a mocked `DashboardExtensionAPI`
before this was installed into a real Splunk instance.

## Building

```bash
npm install
npm run build        # dev build, with sourcemap
npm run build:prod   # production build: minified, no sourcemap
```

Output: `visualization.js`, alongside `src/` (same convention as the classic
viz's webpack output) - this is the file Splunk actually loads, picked up
automatically the next time the app is installed/reloaded. `npm run dev`
watches and rebuilds on change.

## Format options

See `config.json`'s `optionsSchema`/`editorConfig` for the full set (general,
legend, and axes sections - the same options as the classic viz's formatter,
minus the dropped sizing options above).
