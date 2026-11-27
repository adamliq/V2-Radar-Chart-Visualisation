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
import * as d3 from 'd3';
import { VisualizationAPI } from '@splunk/dashboard-studio-extension';
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
let exportBar = null;

const rootEl = document.getElementById('root') || document.body;
const container = document.createElement('div');
container.className = 'radar-chart-studio-container';
// Not role="img": that tells assistive tech to treat the whole subtree as
// one flat, non-interactive image, which would swallow the legend cells,
// data points, and export buttons inside it - all real, keyboard-focusable
// controls. "group" keeps aria-label as the overview while still exposing
// those descendants normally.
container.setAttribute('role', 'group');
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
    // This can run on a render *after* the chart was already built (e.g. a
    // live search that briefly returns zero rows), and the replaceChildren()
    // above just detached it along with the export button bar. Without
    // resetting these, a later render with valid data would see
    // isInitializedDom still true and skip rebuilding against the (now
    // detached) old nodes - the chart would silently stop rendering for
    // good the first time this happens.
    isInitializedDom = false;
    radarChart = null;
    exportBar = null;
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

function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on a timeout rather than immediately - some browsers need the
    // object URL to still resolve when the download actually starts.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Rasterizing an SVG client-side (no server round-trip, no extra library)
// means drawing it into an offscreen canvas via an <img>, then reading the
// canvas back out - the standard, dependency-free way to get a PNG from an
// SVG in a browser.
function downloadChartAsPng(svgEl) {
    const width = parseFloat(svgEl.getAttribute('width')) || svgEl.clientWidth || 500;
    const height = parseFloat(svgEl.getAttribute('height')) || svgEl.clientHeight || 500;
    const svgString = new XMLSerializer().serializeToString(svgEl);
    const svgUrl = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // Flatten transparency against an opaque background first - a PNG
        // opened outside a browser composites transparency onto whatever
        // the viewer defaults to (often black), not the dashboard's own
        // panel background.
        ctx.fillStyle = state.theme === 'dark' ? '#1a1a1a' : '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(svgUrl);
        canvas.toBlob((blob) => {
            if (blob) triggerDownload(URL.createObjectURL(blob), 'radar-chart.png');
        }, 'image/png');
    };
    img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        VisualizationAPI.setError('Could not export chart as PNG');
    };
    img.src = svgUrl;
}

function downloadChartAsSvg(svgEl) {
    const svgString = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    triggerDownload(URL.createObjectURL(blob), 'radar-chart.svg');
}

// Created once (see the one-time init block in render()) and left in place
// across re-renders, same as the chart's own DOM - the D3 engine only ever
// touches its own <svg>, so a plain sibling element here is safe.
//
// Not yet possible to verify outside a real Dashboard Studio instance:
// whether its sandboxed iframe allows a download this way (the `download`
// attribute on an anchor needs the iframe's sandbox to include
// `allow-downloads`, or no sandbox restriction at all) - same category of
// caveat as registerPointDrilldown's below. The mocked test harness can
// only confirm this code builds the right blob/anchor, not that Studio's
// real sandbox lets the browser carry it through.
function createExportControls() {
    const bar = document.createElement('div');
    bar.className = 'radar-chart-studio-export-bar';

    const svgBtn = document.createElement('button');
    svgBtn.type = 'button';
    svgBtn.className = 'radar-chart-studio-export-btn';
    svgBtn.textContent = 'SVG';
    svgBtn.setAttribute('aria-label', 'Download chart as SVG');
    svgBtn.addEventListener('click', () => {
        const svgEl = container.querySelector('svg');
        if (svgEl) downloadChartAsSvg(svgEl);
    });

    const pngBtn = document.createElement('button');
    pngBtn.type = 'button';
    pngBtn.className = 'radar-chart-studio-export-btn';
    pngBtn.textContent = 'PNG';
    pngBtn.setAttribute('aria-label', 'Download chart as PNG');
    pngBtn.addEventListener('click', () => {
        const svgEl = container.querySelector('svg');
        if (svgEl) downloadChartAsPng(svgEl);
    });

    bar.appendChild(svgBtn);
    bar.appendChild(pngBtn);
    container.appendChild(bar);
    return bar;
}

function styleExportControls(bar) {
    const dark = state.theme === 'dark';
    bar.querySelectorAll('button').forEach((btn) => {
        btn.style.background = dark ? '#2a2a2a' : '#ffffff';
        btn.style.color = dark ? '#e8e8e8' : '#333333';
        btn.style.border = `1px solid ${dark ? '#555555' : '#cccccc'}`;
    });
}

function render() {
    if (state.loading) {
        showMessage('Loading...');
        return;
    }
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
    const exportButtonsEnabled = opts.exportButtonsEnabled ?? true;

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
        radarChart.onPointCreated(registerPointDrilldown);
        exportBar = createExportControls();
        isInitializedDom = true;
    }

    exportBar.style.display = isTrue(exportButtonsEnabled) ? '' : 'none';
    styleExportControls(exportBar);

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
    makeDataPointsAccessible(containerSel);

    const categoryNames = Object.keys(categories);
    container.setAttribute(
        'aria-label',
        `Radar chart comparing ${categoryNames.join(', ')} across ${radarChart.axes().join(', ')}`
    );
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
            // from `d3.event`, which was always null here - traced to d3 v3
            // setting it on its own internal reference to the d3 object
            // during dispatch, which this file's own import of 'd3' doesn't
            // reliably alias (confirmed while this file briefly went through
            // a mutable copy of d3 for an unrelated reason - see git history
            // around d3-instance.js). Reading the real native event directly
            // sidesteps the question entirely. Assigning `.onkeydown` (vs.
            // addEventListener) is also what makes this idempotent to redo
            // on every render.
            this.onkeydown = (event) => {
                if (event.key === 'Enter' || event.key === ' ' || event.keyCode === 13 || event.keyCode === 32) {
                    event.preventDefault();
                    this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }
            };
        });
}

// Each invisible hit-target circle (one per category/axis combination) is
// otherwise mouse-only: hovering shows a tooltip (d3-radar-chart.js's
// tooltip_show/tooltip_hide) and the registered drilldown fires on a real
// click. tabindex/aria-label make the point itself discoverable via
// keyboard/screen reader; focus/blur stand in for mouseover/mouseout so the
// same tooltip shows, and Enter/Space dispatch a synthetic click so a
// keyboard user reaches the same drilldown a mouse click does (mirrors
// makeLegendKeyboardAccessible's pattern above, including why this isn't
// d3's own .on('keydown', ...)). Re-applied every render for the same
// reason as the legend's version: idempotent, and circles are reused (not
// recreated) across renders when the category/axis set doesn't change.
function makeDataPointsAccessible(containerSel) {
    containerSel
        .selectAll('.rcRadarInvisibleCircle')
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-label', (d) => {
            if (!d) return 'Data point';
            const value = d.original_value != null ? d.original_value : d.value;
            return `${d.key}, ${d.axis}: ${value}`;
        })
        .each(function attachPointKeyboardHandlers() {
            const node = this;
            node.onfocus = () => node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            node.onblur = () => node.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            node.onkeydown = (event) => {
                if (event.key === 'Enter' || event.key === ' ' || event.keyCode === 13 || event.keyCode === 32) {
                    event.preventDefault();
                    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }
            };
        });
}

// Wired once via radarChart.onPointCreated (see the one-time init block in
// render()), which itself only fires once per radarInvisibleCircle DOM node
// - the first time it's created, not on every render (see its declaration
// in d3-radar-chart.js). addDrilldownListener has no documented way to
// unregister a node, so this avoids calling it on every render, which would
// register the same node repeatedly for as long as the chart stays open.
//
// Reads the node's *current* bound datum via d3.select(node).datum() inside
// each payloadCallback, rather than closing over the datum from when the
// node was created: circles are reused (not recreated) across renders when
// the category/axis set doesn't change, so a value captured at creation
// time would go stale the next time that same circle's value changes.
//
// One caveat this hasn't been possible to verify outside a real Dashboard
// Studio instance: whether Studio itself garbage-collects a drilldown
// registration once its node is later removed (e.g. a category disappears
// from the search results). If it doesn't, registrations would accumulate,
// bounded by how often the category/axis set changes - not by how often
// the chart re-renders - over the life of the dashboard.
function registerPointDrilldown(node) {
    ['key', 'axis', 'value'].forEach((field) => {
        VisualizationAPI.addDrilldownListener({
            node,
            action: field,
            payloadCallback: () => {
                const datum = d3.select(node).datum() || {};
                return { name: field, value: datum[field] };
            },
        });
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
