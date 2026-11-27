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
- **Invalid format strings don't crash the chart**: d3 v3's `d3.format(spec)`
  throws synchronously on an unparseable spec, and the "Number format" field
  is free text; a bad value now falls back to the default formatter instead
  of throwing. The classic viz had the same exposure (it calls `d3.format`
  the same way) and hasn't been patched there, since it's user-facing only
  here, not something that trips over Dashboard Studio's stricter loading.
- **A "Loading..." state**: the panel used to render nothing at all while
  waiting on the first search result.
- **Drilldown**: see [Drilldown](#drilldown) below - not something the
  classic viz ever finished (its `formatter.html` had a commented-out,
  unimplemented "Drilldown" option).
- **No `d3-legend.js` dependency**: the legend is hand-rolled directly in
  `d3-radar-chart.js` instead of pulled in from a 2015, long-unmaintained
  third-party library - see the next section.
- Everything else (required fields, `keyColor`, all remaining format options,
  the rendering math) is unchanged - `src/vendor/d3-radar-chart.js` is the
  classic viz's `contrib/js/d3-radar-chart.js` verbatim, aside from the fixes
  below.

### Bugs fixed during the port

A headless-browser smoke test against a mocked `DashboardExtensionAPI` -
exercising real sample data, the no-data and invalid-data states, a
keyboard-driven legend toggle, and drilldown registration - caught several
latent bugs, including some pre-existing in the classic viz's own
`contrib/js/` but masked there by non-strict execution:

- `update_radarCircle`, `update_radarInvisibleCircle` (main render path) and
  `newX`/`newY` (hover tooltip handler) in `d3-radar-chart.js` were all
  assigned without being declared anywhere - implicit globals. Dashboard
  Studio loads visualizations via `<script type="module">`, which is always
  strict mode, and assigning to an undeclared identifier throws there
  instead of silently creating a global. Fixed by declaring them properly
  (`var update_radarCircle = ...`, etc.) The same fix was backported to the
  classic viz's own `contrib/js/d3-radar-chart.js`, where it's dormant
  (harmless today, but a latent trap for whoever next touches that code).
- d3 v3's own UMD bundle reads an implicit, unbound `this` as the global
  object (`!function() { var d3_document = this.document; ... }()`) - also
  sloppy-mode-only. `build.mjs` binds it to `globalThis` explicitly instead
  of patching `node_modules`.
- An earlier version of this port used `contrib/js/d3-legend.js` for the
  legend (ported as-is, since the engine calls `d3.legend.color()` directly,
  gated behind `if (d3.legend)` - the classic *wrapper* never calls
  `d3.legend` itself, which is what led to it being dropped as "dead code"
  in an even earlier pass, and the legend silently disappearing). That file
  turned out to have the same class of bug as above (a stray `;` where the
  original third-party source meant a `,`, breaking a `var a = ..., b = ...`
  chain - also backported to the classic viz's copy), compounded by
  `import * as d3 from 'd3'` handing out a non-extensible ES module
  namespace object that the library's `d3.legend = {...}` assignment
  silently failed to mutate. Replacing the whole dependency with a small,
  purpose-built legend (see above) removes this failure mode entirely
  rather than patching around it again.
- The keyboard-accessible legend toggle (`tabindex`, `role="button"`,
  Enter/Space dispatches a synthetic `click`) initially read `d3.event` to
  detect the keypress, matching the rest of this vendor code - but
  `d3.event` is set by d3 v3's *own* internal dispatch, on *its own*
  internal d3 object, which this file's import of `'d3'` doesn't reliably
  alias. Fixed by reading the native event directly instead.

## Drilldown

Clicking a data point (not yet the legend, which already has its own
click-to-toggle behavior) fires three Dashboard Studio drilldown actions -
`key`, `axis`, and `value` - so a dashboard author can wire any of them to a
token or a linked search from the Interactions panel.

`VisualizationAPI.addDrilldownListener` has no documented way to unregister
a node, so registering it from inside `render()` (called on every data,
option, dimension, or theme change) would register the same point's circle
over and over for as long as the panel stays open. Instead, the engine
(`d3-radar-chart.js`) exposes `chart.onPointCreated(fn)`, which fires `fn`
exactly once per circle - the first time it's created via D3's `.enter()`
selection, not on every render. Circles are *reused* (not recreated) across
renders whenever the category/axis set doesn't change, which is the normal
case for a live, auto-refreshing search - only an actual schema change (an
axis or category appearing/disappearing) creates new circles and triggers
new registrations. Verified directly: 2 categories x 6 axes x 3 actions
register 36 listeners on 12 nodes; a re-render with unchanged data adds
zero; adding one axis adds exactly 6 (the new nodes only, not a
re-registration of the existing 36).

Each `payloadCallback` re-reads the node's *current* bound datum
(`d3.select(node).datum()`) rather than closing over the value from when
the node was created, so a reused circle's later value changes are
reflected correctly.

**Caveat**: whether Dashboard Studio itself garbage-collects a drilldown
registration once its node is later removed from the DOM (a category or
axis disappearing) hasn't been possible to verify outside a real Studio
instance. If it doesn't, registrations accumulate - bounded by how often
the category/axis set changes over the dashboard's lifetime, not by how
often it re-renders, per the above - but still worth watching for on a
long-running, frequently-reconfigured dashboard.

## Export

Two buttons in the top-right corner of the chart (toggle with the "Show
export buttons" format option) download the current render as `.svg` or
`.png` - a direct serialization of the chart's own `<svg>` for the former,
drawn into an offscreen canvas and read back out for the latter. No server
round-trip, no added dependency.

**Caveat**: like the drilldown caveat above, this hasn't been possible to
verify inside a real Dashboard Studio instance - triggering a file download
from inside its sandboxed iframe needs the sandbox to permit it (the
`download` attribute on an anchor needs `allow-downloads` or no sandbox
restriction at all). The test suite confirms this code builds a correct
SVG/PNG blob and requests the download; it can't confirm Studio's real
sandbox lets the browser carry it through.

## Accessibility

- The chart container has `role="group"` (not `role="img"` - it holds real
  interactive controls, which an image role would hide from assistive tech)
  with a text `aria-label` summarizing the categories and axes being
  compared (also used for the no-data/error placeholder states).
- The legend's click-to-toggle-visibility is keyboard-reachable: tab to a
  legend entry, Enter or Space toggles it, same as clicking it.
- Each data point (the invisible hit-target circles) is keyboard-reachable
  too: tab to one, its `aria-label` reads out its category/axis/value,
  focus/blur show and hide the same tooltip a mouse hover would, and
  Enter/Space dispatch a synthetic click - reaching the same registered
  drilldown a mouse click would.
- Placeholder/error text uses a theme-aware color (the classic viz's
  default was light-theme-only and fails WCAG AA contrast on a dark panel).

## Building

```bash
npm install
npm run build        # dev build, with sourcemap
npm run build:prod   # production build: minified, no sourcemap
```

## Testing

```bash
npm test
```

Builds, then runs `test/run.mjs`: a regression suite against the built
`visualization.js` in a real headless browser (Playwright/Chromium - this
engine does real SVG layout and d3 symbol generation that a DOM-only shim
like jsdom wouldn't exercise the same way), with a mocked
`DashboardExtensionAPI` (`test/mock-dashboard-api.mjs`) standing in for
Dashboard Studio's real one. Covers rendering with sample data, the
no-data/invalid-data states, NaN-prone and invalid-format option values,
legend mouse/keyboard/hover behavior, the drilldown registration behavior
described above (including that it doesn't grow on a same-data re-render,
and does grow correctly on a schema change), the SVG/PNG export buttons
(including a valid-PNG-header/valid-SVG-markup check on the downloaded
files themselves), and data-point keyboard accessibility. This is what
caught every bug mentioned above before any of them reached AppInspect or a
real Splunk instance - run it after any change to `src/` or `config.json`.
Also runs in CI (`.github/workflows/ci.yml`) on every push/PR, alongside a
`splunk-appinspect` pass.

Output: `visualization.js`, alongside `src/` (same convention as the classic
viz's webpack output) - this is the file Splunk actually loads, picked up
automatically the next time the app is installed/reloaded. `npm run dev`
watches and rebuilds on change.

## Format options

See `config.json`'s `optionsSchema`/`editorConfig` for the full set (general,
legend, and axes sections - the same options as the classic viz's formatter,
minus the dropped sizing options above).
