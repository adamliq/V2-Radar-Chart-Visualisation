#!/usr/bin/env node
// Regression suite for the built visualization.js, run against a mocked
// DashboardExtensionAPI in a real headless browser (not jsdom - this engine
// does real SVG layout, d3 symbol generation, and strict-mode module
// loading that a DOM-only shim wouldn't exercise the same way).
//
// Run with `npm test` (builds first) or `node test/run.mjs` directly
// against an already-built visualization.js.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockApi, SAMPLE_DATA } from './mock-dashboard-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

function startServer() {
    return new Promise((resolve) => {
        const server = createServer(async (req, res) => {
            try {
                const filePath = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
                const body = await readFile(filePath);
                res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
                res.end(body);
            } catch {
                res.writeHead(404);
                res.end('not found');
            }
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
    if (condition) {
        passed += 1;
        console.log(`  \x1b[32m✓\x1b[0m ${message}`);
    } else {
        failed += 1;
        failures.push(message);
        console.log(`  \x1b[31m✗\x1b[0m ${message}`);
    }
}

async function withPage(browser, baseUrl, mockConfig, fn) {
    const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.stack || e.message));
    if (mockConfig) {
        await page.addInitScript(installMockApi, mockConfig);
    }
    await page.goto(`${baseUrl}/test/harness.html`);
    await page.waitForTimeout(400);
    try {
        await fn(page, pageErrors);
    } finally {
        await page.close();
    }
}

async function main() {
    const server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const launchOptions = {};
    if (existsSync('/opt/pw-browsers/chromium')) {
        // Anthropic sandbox: a pre-installed Chromium/Playwright pair lives
        // here, and a freshly npm-installed Playwright driver (this
        // project's devDependency) won't locate it on its own.
        launchOptions.executablePath = '/opt/pw-browsers/chromium';
    }
    const browser = await chromium.launch(launchOptions);

    try {
        console.log('rendering with valid sample data');
        await withPage(browser, baseUrl, { dataSources: { primary: { data: SAMPLE_DATA } } }, async (page, errors) => {
            const info = await page.evaluate(() => ({
                hasSvg: !!document.querySelector('svg'),
                legendCellCount: document.querySelectorAll('.cell').length,
                legendLabels: Array.from(document.querySelectorAll('.cell text.label')).map((el) => el.textContent).sort(),
                circleCount: document.querySelectorAll('.rcRadarInvisibleCircle').length,
            }));
            assert(errors.length === 0, 'no uncaught page errors');
            assert(info.hasSvg, 'svg is rendered');
            assert(info.legendCellCount === 2, `legend has 2 cells (got ${info.legendCellCount})`);
            assert(
                JSON.stringify(info.legendLabels) === JSON.stringify(['better', 'current']),
                `legend labels are "better"/"current" (got ${JSON.stringify(info.legendLabels)})`
            );
            assert(info.circleCount === 12, `12 data-point circles, 2 categories x 6 axes (got ${info.circleCount})`);
        });

        console.log('\nempty data');
        await withPage(
            browser,
            baseUrl,
            { dataSources: { primary: { data: { fields: SAMPLE_DATA.fields, columns: [[], [], [], []] } } } },
            async (page, errors) => {
                const text = await page.evaluate(() => document.body.innerText);
                assert(errors.length === 0, 'no uncaught page errors');
                assert(text.includes('No data available'), 'shows "No data available"');
            }
        );

        console.log('\nmissing required field (no "key")');
        await withPage(
            browser,
            baseUrl,
            {
                dataSources: {
                    primary: {
                        data: {
                            fields: [{ name: 'axis' }, { name: 'value' }],
                            columns: [['a', 'b'], ['1', '2']],
                        },
                    },
                },
            },
            async (page, errors) => {
                const info = await page.evaluate(() => ({
                    text: document.body.innerText,
                    setErrorCalls: window.__setErrorCalls,
                }));
                assert(errors.length === 0, 'no uncaught page errors');
                assert(info.text.includes('Invalid data'), 'shows an "Invalid data" message');
                assert(
                    info.setErrorCalls.some((m) => m.includes('Missing required field') && m.includes('key')),
                    `setError reports the missing field (got ${JSON.stringify(info.setErrorCalls)})`
                );
            }
        );

        console.log('\nNaN-prone options (cleared/empty-string panel fields)');
        await withPage(
            browser,
            baseUrl,
            {
                dataSources: { primary: { data: SAMPLE_DATA } },
                options: {
                    maxValue: '', levels: '', areasOpacity: '', circlesOpacity: '',
                    legendFontSize: '', axesLineColor: '',
                },
            },
            async (page, errors) => {
                const hasSvg = await page.evaluate(() => !!document.querySelector('svg'));
                assert(errors.length === 0, 'no uncaught page errors (NaN would otherwise propagate into d3 scale math)');
                assert(hasSvg, 'chart still renders with empty-string options falling back to defaults');
            }
        );

        console.log('\ninvalid "Number format" string');
        await withPage(
            browser,
            baseUrl,
            { dataSources: { primary: { data: SAMPLE_DATA } }, options: { format: 'not a valid d3 format spec !!!' } },
            async (page, errors) => {
                const hasSvg = await page.evaluate(() => !!document.querySelector('svg'));
                assert(errors.length === 0, 'no uncaught page errors (d3.format throws on a bad spec)');
                assert(hasSvg, 'chart still renders, falling back to the default number format');
            }
        );

        console.log('\nzero dimensions (not yet sized)');
        await withPage(
            browser,
            baseUrl,
            { dataSources: { primary: { data: SAMPLE_DATA } }, dims: { width: 0, height: 0 } },
            async (page, errors) => {
                const hasSvg = await page.evaluate(() => !!document.querySelector('svg'));
                assert(errors.length === 0, 'no uncaught page errors');
                assert(!hasSvg, 'nothing renders yet (correctly waiting for a real size)');
            }
        );

        console.log('\nlegend: mouse click toggles, keyboard Enter toggles, round-trips back');
        await withPage(browser, baseUrl, { dataSources: { primary: { data: SAMPLE_DATA } } }, async (page, errors) => {
            const getSwatchD = () => document.querySelectorAll('.cell path.swatch')[0].getAttribute('d');
            const original = await page.evaluate(getSwatchD);

            const cell = await page.$('.cell');
            await cell.focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(200);
            const afterKeyboard = await page.evaluate(getSwatchD);
            assert(afterKeyboard !== original, 'Enter on a focused legend cell toggles its shape (keyboard-accessible)');

            const box = await cell.boundingBox();
            await page.mouse.click(box.x + 5, box.y + 10);
            await page.waitForTimeout(200);
            const afterClick = await page.evaluate(getSwatchD);
            assert(afterClick === original, 'clicking it again toggles back (mouse and keyboard drive the same state)');

            assert(errors.length === 0, 'no uncaught page errors');
        });

        console.log('\nlegend: hover dims other series, reverts on mouseout');
        await withPage(browser, baseUrl, { dataSources: { primary: { data: SAMPLE_DATA } } }, async (page, errors) => {
            const getOpacities = () =>
                Array.from(document.querySelectorAll('.rcRadarArea')).map((el) => getComputedStyle(el).fillOpacity);
            const before = await page.evaluate(getOpacities);
            // legendMouseover/areaMouseout both animate via a 200ms d3
            // transition - read after it's had time to finish, not
            // synchronously in the same tick as dispatching the event.
            await page.evaluate(() => document.querySelectorAll('.cell')[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
            await page.waitForTimeout(300);
            const during = await page.evaluate(getOpacities);
            await page.evaluate(() => document.querySelectorAll('.cell')[0].dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
            await page.waitForTimeout(300);
            const after = await page.evaluate(getOpacities);
            assert(before.every((o) => o === '0.35'), `both areas at the default opacity before hover (got ${before})`);
            assert(during[0] !== during[1], `hovering dims the non-hovered area (got ${during})`);
            assert(JSON.stringify(after) === JSON.stringify(before), `mouseout restores the default opacity (got ${after})`);
            assert(errors.length === 0, 'no uncaught page errors');
        });

        console.log('\ndrilldown: registers once per point, not per render');
        await withPage(browser, baseUrl, { dataSources: { primary: { data: SAMPLE_DATA } } }, async (page, errors) => {
            const after1 = await page.evaluate(() => ({
                count: window.__drilldownRegistrations.length,
                fields: [...new Set(window.__drilldownRegistrations.map((r) => r.action))].sort(),
                uniqueNodes: new Set(window.__drilldownRegistrations.map((r) => r.node)).size,
            }));
            assert(after1.count === 36, `2 categories x 6 axes x 3 actions = 36 registrations (got ${after1.count})`);
            assert(
                JSON.stringify(after1.fields) === JSON.stringify(['axis', 'key', 'value']),
                `registers "key"/"axis"/"value" actions (got ${JSON.stringify(after1.fields)})`
            );
            assert(after1.uniqueNodes === 12, `one registration set per circle, 12 circles (got ${after1.uniqueNodes})`);

            const payloads = await page.evaluate(() => ({
                axis: window.__drilldownRegistrations.find((r) => r.action === 'axis').payloadCallback(),
                key: window.__drilldownRegistrations.find((r) => r.action === 'key').payloadCallback(),
            }));
            assert(payloads.axis.name === 'axis' && typeof payloads.axis.value === 'string', `axis payload shape (got ${JSON.stringify(payloads.axis)})`);
            assert(payloads.key.name === 'key' && (payloads.key.value === 'current' || payloads.key.value === 'better'), `key payload shape (got ${JSON.stringify(payloads.key)})`);

            await page.evaluate(() => {
                window.__listeners.options({ options: { legendFontSize: 14 } });
            });
            await page.waitForTimeout(200);
            const after2 = await page.evaluate(() => window.__drilldownRegistrations.length);
            assert(after2 === 36, `re-rendering with unchanged data adds no new registrations (got ${after2})`);

            await page.evaluate((sample) => {
                const extended = {
                    fields: sample.fields,
                    columns: [
                        [...sample.columns[0], 'current', 'better'],
                        [...sample.columns[1], 'New Axis', 'New Axis'],
                        [...sample.columns[2], '5', '6'],
                        [...sample.columns[3], 'magenta', '#33FF55'],
                    ],
                };
                window.__listeners.dataSources({ dataSources: { primary: { data: extended } }, loading: false });
            }, SAMPLE_DATA);
            await page.waitForTimeout(200);
            const after3 = await page.evaluate(() => window.__drilldownRegistrations.length);
            assert(after3 - after2 === 6, `adding 1 axis x 2 categories adds exactly 6 new registrations (got delta ${after3 - after2})`);

            const stale = await page.evaluate((sample) => {
                const onlyCurrent = { fields: sample.fields, columns: sample.columns.map((col) => col.slice(0, 6)) };
                window.__listeners.dataSources({ dataSources: { primary: { data: onlyCurrent } }, loading: false });
                const staleReg = window.__drilldownRegistrations.find((r) => r.action === 'key' && !document.contains(r.node));
                if (!staleReg) return { found: false };
                try {
                    return { found: true, payload: staleReg.payloadCallback(), threw: false };
                } catch {
                    return { found: true, threw: true };
                }
            }, SAMPLE_DATA);
            assert(stale.found, 'a registration for a since-removed node is found (category dropped from results)');
            assert(!stale.threw, "calling its payloadCallback doesn't throw even though its node is detached");

            assert(errors.length === 0, 'no uncaught page errors across all of the above');
        });

        console.log(`\n${passed} passed, ${failed} failed`);
        if (failed > 0) {
            console.log('\nFailed assertions:');
            failures.forEach((f) => console.log(`  - ${f}`));
        }
    } finally {
        await browser.close();
        server.close();
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
