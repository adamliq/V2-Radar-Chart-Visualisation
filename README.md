# V2-Radar-Chart-Visualisation

A Splunk custom visualization app (D3 radar/spider chart), packaged and made
Splunkbase / AppInspect compliant from the original *Custom Radar Chart
Visualization* app, then extended with a Dashboard Studio-native build of
the same visualization.

- `v2-radar-chart-visualisation/` - the app source, ready to package. Ships both the classic
  `radar_chart` visualization and the Dashboard Studio-native `radar_chart_studio` visualization
  (requires Splunk Enterprise 10.4+ / equivalent Splunk Cloud Platform release) - see that app's
  README for the differences between the two.
- `custom-radar-chart-visualization_112.tgz` - original upstream Splunkbase archive (source material).

## Building the package

```
# Build the Dashboard Studio visualization bundle first
(cd v2-radar-chart-visualisation/appserver/static/visualizations/radar_chart_studio && npm install && npm run build:prod)

tar -czf v2-radar-chart-visualisation.tgz --exclude='.DS_Store' --exclude='node_modules' --exclude='*.map' v2-radar-chart-visualisation
```

## Compliance

The app has been validated with the official `splunk-appinspect` tool
(precert and cloud modes) with no failures or errors.

AppInspect raises three expected, benign warnings, all against the final
packaged `.tgz`/`.spl`:

- `check_for_updates_disabled` - `app.conf` sets `check_for_updates = 1`
  since this app is intended for Splunkbase distribution. AppInspect raises
  this when run standalone because it can't tell from the package alone
  that it's Splunkbase-bound rather than a private app - it does not apply
  once the app is actually listed on Splunkbase.
- `check_for_splunk_dashboard_core` - fires on `@splunk/dashboard-studio-extension`
  (the Studio visualization's dependency); AppInspect's own message says to
  ignore it ("has no impact to your Splunk app") - it's a telemetry notice,
  not a compliance issue.
- `check_for_legacy_custom_visualizations` - flags the classic `radar_chart`
  stanza in `visualizations.conf` and suggests migrating it to the Studio
  framework. That's `radar_chart_studio`'s job; `radar_chart` is kept
  alongside it deliberately, for Simple XML dashboards and pre-10.4 Splunk -
  see the app README for the rationale.

Also validated by installing the packaged app into a real `splunk/splunk`
Docker container: it loads with no errors in `splunkd.log`, and both
`radar_chart` and `radar_chart_studio` show up correctly in
`conf-visualizations` (the latter with `framework_type = studio_visualization`).
The Studio visualization's actual bundle was further checked with a
headless-browser smoke test against a mocked `DashboardExtensionAPI`,
which is what caught (and let us fix) three latent bugs in the classic
engine's D3 code that only break under Dashboard Studio's strict-mode
`<script type="module">` loading - see
`v2-radar-chart-visualisation/appserver/static/visualizations/radar_chart_studio/README.md`.