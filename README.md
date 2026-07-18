# V2-Radar-Chart-Visualisation

A Splunk custom visualization app (D3 radar/spider chart), packaged and made
Splunkbase / AppInspect compliant from the original *Custom Radar Chart
Visualization* app.

- `v2-radar-chart-visualisation/` - the app source, ready to package.
- `custom-radar-chart-visualization_112.tgz` - original upstream Splunkbase archive (source material).

## Building the package

```
tar -czf v2-radar-chart-visualisation.tgz --exclude='.DS_Store' v2-radar-chart-visualisation
```

## Compliance

The app has been validated with the official `splunk-appinspect` tool
(precert and cloud modes) with no failures or errors.

`app.conf` sets `check_for_updates = 1` since this app is intended for
Splunkbase distribution. AppInspect raises one expected warning
(`check_for_updates_disabled`) when run standalone, because it can't tell
from the package alone that it's Splunkbase-bound rather than a private
app — that warning does not apply once the app is actually listed on
Splunkbase.