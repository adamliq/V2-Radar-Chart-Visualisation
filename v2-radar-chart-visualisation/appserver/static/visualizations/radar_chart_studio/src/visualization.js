/*
 * radar_chart_studio - Dashboard Studio-native port of the classic
 * radar_chart visualization (appserver/static/visualizations/radar_chart).
 *
 * The classic viz used SplunkVisualizationBase (formatData/updateView,
 * RequireJS, row-oriented search results). This port uses
 * @splunk/dashboard-studio-extension's VisualizationAPI (listeners,
 * columnar {fields, columns} search results) per Splunk's current
 * Dashboard Studio custom visualization framework. The D3 rendering
 * engine itself (vendor/d3-radar-chart.js) and the category/axis
 * grouping logic are carried over unchanged in behavior.
 */
import { VisualizationAPI } from '@splunk/dashboard-studio-extension';
// d3-instance.js must come before d3-legend.js: it sets globalThis.d3 to a
// mutable object, which that (unmodified, browserify-bundled) vendor file
// expects to already exist and adds its `.legend` property onto.
import d3 from './vendor/d3-instance.js';
import './vendor/d3-legend.js';
import RadarChart from './vendor/d3-radar-chart.js';
import './visualization.css';

const REQUIRED_FIELDS = ['key', 'axis', 'value'];
const ALLOWED_FIELDS = [...REQUIRED_FIELDS, 'keyColor'];

// The classic viz hardcoded light-theme-only defaults (e.g. a white axis
// line, near-black legend text). Dashboard Studio supports a real dark
// theme, so unset options fall back to theme-aware defaults instead -
// chosen to keep at least 4.5:1 contrast against both panel backgrounds.
const THEME_DEFAULTS = {
    light: {
        axesLineColor: '#dddddd',
        axesLabelFontColor: '#737373',
        axesLegendFontColor: '#000000',
        legendFontColor: '#000000',
    },
    dark: {
        axesLineColor: '#464646',
        axesLabelFontColor: '#b3b3b3',
        axesLegendFontColor: '#e8e8e8',
        legendFontColor: '#e8e8e8',
    },
};

const state = {
    data: null,
    loading: true,
    options: {},
    width: 0,
    height: 0,
    theme: 'light',
};

let radarChart = null;
let isInitializedDom = false;

const rootEl = document.getElementById('root') || document.body;
const container = document.createElement('div');
container.className = 'radar-chart-studio-container';
container.setAttribute('role', 'img');
container.setAttribute('aria-label', 'Radar chart');
rootEl.appendChild(container);

function showMessage(message) {
    container.replaceChildren();
    container.setAttribute('aria-label', message);
    const el = document.createElement('div');
    el.className = 'radar-chart-studio-empty';
    el.textContent = message;
    // Placeholder text needs its own theme-aware color: it's plain DOM, not
    // part of the D3-rendered chart, and the classic viz's #737373 default
    // falls to ~3.3:1 contrast (fails WCAG AA for normal text) on a dark
    // panel background.
    el.style.color = (THEME_DEFAULTS[state.theme] || THEME_DEFAULTS.light).axesLabelFontColor;
    container.appendChild(el);
}

// Search results arrive columnar: { fields: [{name}, ...], columns: [[...], ...] }.
// Convert to row objects to reuse the classic viz's row-oriented grouping logic.
function toRows(data) {
    const fieldNames = (data.fields || []).map((f) => (typeof f === 'string' ? f : f.name));
    const columns = data.columns || [];
    const numRows = columns[0] ? columns[0].length : 0;
    const rows = [];
    for (let i = 0; i < numRows; i += 1) {
        const row = {};
        fieldNames.forEach((name, j) => {
            row[name] = columns[j] ? columns[j][i] : undefined;
        });
        rows.push(row);
    }
    return rows;
}

function validateFields(fieldNames) {
    fieldNames.forEach((name) => {
        if (!ALLOWED_FIELDS.includes(name)) {
            throw new Error(`Invalid field detected: ${name}; required fields: key, axis, value`);
        }
    });
    const missing = REQUIRED_FIELDS.filter((name) => !fieldNames.includes(name));
    if (missing.length) {
        throw new Error(`Missing required field(s): ${missing.join(', ')}`);
    }
}

// Studio's number editor can hand back an empty string (cleared input) or
// leave a key unset even where optionsSchema declares a default - unlike
// the classic viz's `|| default`, `?? default` doesn't catch NaN.
function numberOption(value, fallback) {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function intOption(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

// Mirrors the classic viz's `category` helper (src/radar_chart.js), including
// its pre-existing quirk of only re-sorting the axes of categories that are
// missing one: a category with a complete, already-ordered axis set keeps
// its original insertion order rather than being re-sorted to match.
function makeCategory(key, axis, value) {
    return {
        key,
        axes: [axis],
        vals: [{ axis, value }],
        update(axisName, val) {
            this.vals.push({ axis: axisName, value: val });
            this.axes.push(axisName);
        },
        fillMissingAxis(allAxes) {
            allAxes.sort();
            this.axes.sort();
            allAxes.forEach((axisName, i) => {
                if (!this.axes.includes(axisName)) {
                    this.vals.splice(i, 0, { axis: axisName, value: 0 });
                    this.axes.splice(i, 0, axisName);
                }
            });
        },
    };
}

function formatData(data) {
    const categories = {};
    if (!data || !data.columns || !data.columns.length || !data.columns[0] || !data.columns[0].length) {
        return categories;
    }

    const fieldNames = (data.fields || []).map((f) => (typeof f === 'string' ? f : f.name));
    validateFields(fieldNames);

    const allAxes = [];
    toRows(data).forEach((row) => {
        try {
            if (Object.prototype.hasOwnProperty.call(categories, row.key)) {
                categories[row.key].update(row.axis, row.value);
            } else if (row.key) {
                const category = makeCategory(row.key, row.axis, row.value);
                if (row.keyColor !== undefined && row.keyColor !== '') {
                    category.keyColor = row.keyColor;
                }
                categories[row.key] = category;
            }
            if (row.key && !allAxes.includes(row.axis)) {
                allAxes.push(row.axis);
            }
        } catch (err) {
            VisualizationAPI.setError(err instanceof Error ? err.message : String(err));
        }
    });

    Object.keys(categories).forEach((key) => categories[key].fillMissingAxis(allAxes));
    return categories;
}

function isTrue(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function render() {
    if (state.loading) return;
    if (state.width <= 0 || state.height <= 0) return;
    if (!state.data) {
        showMessage('No data available');
        return;
    }

    let categories;
    try {
        categories = formatData(state.data);
    } catch (err) {
        VisualizationAPI.setError(err instanceof Error ? err.message : String(err));
        showMessage('Invalid data: expected fields key, axis, value, and optional keyColor');
        return;
    }

    if (!Object.keys(categories).length) {
        showMessage('No data available');
        return;
    }
    VisualizationAPI.clearError();

    const themeDefaults = THEME_DEFAULTS[state.theme] || THEME_DEFAULTS.light;
    const opts = state.options || {};

    const maxValue = numberOption(opts.maxValue, 1);
    const levels = intOption(opts.levels, 8);
    const format = opts.format ?? '';
    const isRounded = opts.isRounded ?? true;
    const legendEnabled = opts.legendEnabled ?? true;
    const legendSymbol = opts.legendSymbol || 'cross';
    const legendToggleSymbol = opts.legendToggleSymbol || 'circle';
    const legendFontSize = intOption(opts.legendFontSize, 12);
    const legendPositionX = intOption(opts.legendPositionX, 25);
    const legendPositionY = intOption(opts.legendPositionY, 25);
    const legendFontColor = opts.legendFontColor || themeDefaults.legendFontColor;
    const axesLegendFontSize = intOption(opts.axesLegendFontSize, 12);
    const axesLabelFontSize = intOption(opts.axesLabelFontSize, 12);
    const axesLineColor = opts.axesLineColor || themeDefaults.axesLineColor;
    const axesLabelFontColor = opts.axesLabelFontColor || themeDefaults.axesLabelFontColor;
    const axesLegendFontColor = opts.axesLegendFontColor || themeDefaults.axesLegendFontColor;
    const circlesColor = opts.circlesColor || '#CDCDCD';
    const circlesFillColor = opts.circlesFillColor || '#CDCDCD';
    const areasOpacity = numberOption(opts.areasOpacity, 0.35);
    const circlesOpacity = numberOption(opts.circlesOpacity, 0.1);

    if (!isInitializedDom) {
        // Only clear the container (which may hold a leftover "no data"/error
        // placeholder) right before building the chart's DOM for the first
        // time. Later renders must NOT touch the container directly - the
        // chart's own `update()` does incremental D3 data joins against the
        // exact nodes it created here, and detaching them (even to rebuild
        // identical markup) would leave `update()` silently redrawing an
        // orphaned, invisible copy.
        container.replaceChildren();
        radarChart = new RadarChart(format);
        d3.select(container).call(radarChart);
        isInitializedDom = true;
    }

    radarChart
        .options({
            width: state.width,
            height: state.height,
            format,
            legend: {
                display: isTrue(legendEnabled),
                symbol: legendSymbol,
                toggle: legendToggleSymbol,
                position: { x: legendPositionX, y: legendPositionY },
                fontColor: legendFontColor,
            },
            areas: { opacity: areasOpacity },
            circles: { color: circlesColor, fill: circlesFillColor, opacity: circlesOpacity },
            axes: {
                lineColor: axesLineColor,
                axesLabelFontColor,
                axesLegendFontColor,
                fontWidth: `${axesLegendFontSize}px`,
            },
        })
        .rounded(isTrue(isRounded))
        .maxValue(maxValue)
        .levels(levels);

    radarChart.clear();

    Object.keys(categories).forEach((key) => {
        const category = categories[key];
        const currentColors = radarChart.colors();
        if (category.keyColor) {
            currentColors[category.key] = category.keyColor;
        }
        radarChart.push({ key: category.key, values: category.vals }).colors(currentColors);
    });

    radarChart.update();

    const containerSel = d3.select(container);
    containerSel.selectAll('.label').style('font-size', `${legendFontSize}px`);
    containerSel.selectAll('.rcAxisLabel').style('font-size', `${axesLabelFontSize}px`);

    if (isTrue(legendEnabled)) {
        makeLegendKeyboardAccessible(containerSel, categories);
    }
}

// The legend's click-to-toggle-visibility behavior (d3-legend.js + the
// vendor engine's internal legendClick) is wired to mouse clicks only.
// `update()` replaces the legend's DOM every render, so re-applying these
// attributes/listeners each time (rather than once) is required, and safe -
// d3's `.attr()`/`.on()` replace rather than stack per element.
function makeLegendKeyboardAccessible(containerSel, categories) {
    const keys = Object.keys(categories);
    containerSel
        .selectAll('.cell')
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-label', (d, i) => `Toggle ${keys[i] ?? 'series'} visibility`)
        .each(function attachKeydown() {
            // Not d3's `.on('keydown', ...)`: that reads the native event
            // from `d3.event`, which d3 v3 sets on *its own* internal d3
            // object during dispatch - not on the mutable copy this file
            // imports (see d3-instance.js's comment on why there's a copy
            // at all), so `d3.event` read from here is always stale/null.
            // Assigning `.onkeydown` (vs. addEventListener) is also what
            // makes this idempotent to redo on every render.
            this.onkeydown = (event) => {
                if (event.key === 'Enter' || event.key === ' ' || event.keyCode === 13 || event.keyCode === 32) {
                    event.preventDefault();
                    this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }
            };
        });
}

VisualizationAPI.addDataSourcesListener(
    ({ dataSources, loading }) => {
        state.loading = loading;
        state.data = dataSources?.primary?.data ?? null;
        render();
    },
    { invokeImmediately: true }
);

VisualizationAPI.addOptionsListener(
    ({ options }) => {
        state.options = options || {};
        render();
    },
    { invokeImmediately: true }
);

VisualizationAPI.addDimensionsListener(
    ({ width, height }) => {
        state.width = width;
        state.height = height;
        render();
    },
    { invokeImmediately: true }
);

VisualizationAPI.addThemeListener(
    ({ theme }) => {
        state.theme = theme;
        render();
    },
    { invokeImmediately: true }
);
