// Installed into the browser page via page.addInitScript(installMockApi, config)
// - runs *in the page*, before visualization.js's module script, standing in
// for the real `globalThis.DashboardExtensionAPI` Dashboard Studio injects
// into the sandboxed iframe. Must be self-contained (no closures over
// outer scope): Playwright serializes this function and runs it in-page.
export function installMockApi({ dataSources, options = {}, dims = { width: 500, height: 500 }, theme = 'light' }) {
    window.__errors = [];
    window.addEventListener('error', (e) => {
        window.__errors.push(String(e.error ? e.error.stack || e.error : e.message));
    });
    window.__setErrorCalls = [];
    window.__clearErrorCallCount = 0;
    window.__drilldownRegistrations = [];
    window.__listeners = { dataSources: null, options: null, dimensions: null, theme: null };
    window.__sampleData = dataSources && dataSources.primary ? dataSources.primary.data : null;

    window.DashboardExtensionAPI = {
        addDataSourcesListener(cb, opts) {
            window.__listeners.dataSources = cb;
            if (opts && opts.invokeImmediately) cb({ dataSources, loading: false });
            return () => {};
        },
        getDataSources() {
            return { dataSources, loading: false };
        },
        addOptionsListener(cb, opts) {
            window.__listeners.options = cb;
            if (opts && opts.invokeImmediately) cb({ options });
            return () => {};
        },
        getOptions() {
            return { options };
        },
        setOptions() {},
        addDimensionsListener(cb, opts) {
            window.__listeners.dimensions = cb;
            if (opts && opts.invokeImmediately) cb(dims);
            return () => {};
        },
        getDimensions() {
            return dims;
        },
        addModeListener(cb, opts) {
            if (opts && opts.invokeImmediately) cb({ mode: 'view' });
            return () => {};
        },
        getMode() {
            return { mode: 'view' };
        },
        addThemeListener(cb, opts) {
            window.__listeners.theme = cb;
            if (opts && opts.invokeImmediately) cb({ theme });
            return () => {};
        },
        getTheme() {
            return { theme };
        },
        addTokensListener() {
            return () => {};
        },
        getTokens() {
            return { tokens: {} };
        },
        addDrilldownListener(args) {
            window.__drilldownRegistrations.push(args);
        },
        triggerDrilldown() {},
        addErrorListener() {
            return () => {};
        },
        getError() {
            return { error: '' };
        },
        setError(msg) {
            window.__setErrorCalls.push(msg);
        },
        clearError() {
            window.__clearErrorCallCount += 1;
        },
    };
}

// Two categories ("current", "better"), six axes each, matching the SPL
// sample in README.md - used as the default fixture across most test cases.
export const SAMPLE_DATA = {
    fields: [{ name: 'key' }, { name: 'axis' }, { name: 'value' }, { name: 'keyColor' }],
    columns: [
        [
            'current', 'current', 'current', 'current', 'current', 'current',
            'better', 'better', 'better', 'better', 'better', 'better',
        ],
        [
            'Business Value', 'Enablement', 'Foundations', 'Governance', 'Operational Excellence', 'Community',
            'Business Value', 'Enablement', 'Foundations', 'Governance', 'Operational Excellence', 'Community',
        ],
        ['0.37', '8.64', '2.56', '1.68', '4.992', '9.66', '9.37', '2.64', '4.56', '6.68', '9.992', '9.66'],
        [
            'magenta', 'magenta', 'magenta', 'magenta', 'magenta', 'magenta',
            '#33FF55', '#33FF55', '#33FF55', '#33FF55', '#33FF55', '#33FF55',
        ],
    ],
};
