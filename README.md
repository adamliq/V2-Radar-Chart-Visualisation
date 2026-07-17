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