# radar_chart visualization

This directory contains the `radar_chart` custom visualization used by the
`v2-radar-chart-visualisation` Splunk app. It renders a D3 radar (spider)
chart from `key`/`axis`/`value` tabular results.

- `src/radar_chart.js` - visualization source, extends `SplunkVisualizationBase`.
- `contrib/js/d3-radar-chart.js` - D3-based radar chart rendering engine.
- `contrib/js/d3-legend.js` - D3 legend rendering helper.
- `formatter.html` - format editor controls shown in Splunk's visualization format menu.
- `visualization.css` - visualization-scoped styles.
- `visualization.js` - built AMD bundle loaded by Splunk (output of the webpack build below).
- `webpack.config.js` / `package.json` - build configuration.

## Building the visualization

The visualization must be built with webpack to produce `visualization.js`.
From this directory:

```
$ npm install
$ npm run build-local
```

This regenerates `visualization.js` from `src/radar_chart.js` and the
`contrib/js` dependencies.

## More information

For more on building custom visualizations, including a tutorial and API
overview, see:

https://dev.splunk.com/enterprise/docs/devtools/customvisualizations/
