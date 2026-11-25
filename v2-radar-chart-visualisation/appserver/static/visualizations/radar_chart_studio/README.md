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
- **Clearer errors**: the classic viz's field check only rejected *unexpected*
  fields; it never verified `key`/`axis`/`value` were actually present, so a
  search missing one of them just rendered an unhelpful empty chart. This
  port reports "Missing required field(s): ..." via `VisualizationAPI.setError`.
- **More robust options**: Studio's format panel can hand back an empty
  string for a cleared field - `'' ?? 8` is `''` (`??` only replaces
  `null`/`undefined`), so an early version of this port's `parseFloat(opts.x
  ?? 8)` pattern produced `NaN` instead of falling back. The classic viz
  avoided this (it used `parseFloat(...) || 8`, and `NaN || 8` is `8`); this
  port now checks for `NaN` explicitly for every numeric option instead.
- Everything else (required fields, `keyColor`, all remaining format options,
  the rendering math) is unchanged - `src/vendor/d3-radar-chart.js` is the
  classic viz's `contrib/js/d3-radar-chart.js` verbatim, aside from the fixes
  below.

`contrib/js/d3-legend.js` *is* required, despite the classic wrapper
(`src/radar_chart.js`) never calling `d3.legend`/`legend(` itself: the
engine it imports (`contrib/js/d3-radar-chart.js`) calls `d3.legend.color()`
directly, gated behind `if (d3.legend)` - so the legend silently disappears
without it. (An earlier version of this port got this backwards and shipped
without a legend; see `src/vendor/d3-legend.js` and `src/vendor/d3-instance.js`.)

### Bugs fixed during the port

A headless-browser smoke test against a mocked `DashboardExtensionAPI` -
exercising real sample data, the no-data and invalid-data states, and a
keyboard-driven legend toggle - caught several latent bugs in the ported
engine, all pre-existing in the classic viz's own `contrib/js/` but masked
there by non-strict execution:

- `update_radarCircle`, `update_radarInvisibleCircle` (main render path) and
  `newX`/`newY` (hover tooltip handler) in `d3-radar-chart.js`, and
  `shapeEnter`/`shapes` in `d3-legend.js` (three call sites: `color`, `size`,
  `symbol`), were all assigned without being declared anywhere - implicit
  globals. The `d3-legend.js` case was a stray `;` where the original
  third-party source meant a `,`, breaking a `var a = ..., b = ...` chain
  partway through. Dashboard Studio loads visualizations via
  `<script type="module">`, which is always strict mode, and assigning to an
  undeclared identifier throws there instead of silently creating a global.
  Fixed by declaring them properly (`var update_radarCircle = ...`, restoring
  the dropped comma, etc.).
- d3 v3's own UMD bundle reads an implicit, unbound `this` as the global
  object (`!function() { var d3_document = this.document; ... }()`) - also
  sloppy-mode-only. `build.mjs` binds it to `globalThis` explicitly instead
  of patching `node_modules`.
- `import * as d3 from 'd3'` gives every importer its own ES module
  namespace object, which per spec is non-extensible - so `d3-legend.js`'s
  `d3.legend = {...}` (needed for the point above) silently no-ops rather
  than throwing, and `d3.legend` stays `undefined` everywhere. `d3-instance.js`
  works around this with a genuinely mutable, shared copy that every file
  (`visualization.js`, `d3-radar-chart.js`, and `d3-legend.js` via
  `globalThis.d3`) imports instead of `'d3'` directly.
- A keyboard-accessible legend toggle (`tabindex`, `role="button"`, Enter/Space
  dispatches a synthetic `click`) initially read `d3.event` to detect the
  keypress, matching the rest of this vendor code - but `d3.event` is set by
  d3 v3's *own* internal dispatch, on *its own* internal d3 object, not on the
  mutable copy above, so it was always `null` here. Fixed by reading the
  native event directly instead.

## Accessibility

- The chart container has `role="img"` with a text `aria-label` (also used
  for the no-data/error placeholder states).
- The legend's click-to-toggle-visibility is keyboard-reachable: tab to a
  legend entry, Enter or Space toggles it, same as clicking it.
- Placeholder/error text uses a theme-aware color (the classic viz's
  default was light-theme-only and fails WCAG AA contrast on a dark panel).

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
