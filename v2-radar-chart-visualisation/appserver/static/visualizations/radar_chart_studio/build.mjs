#!/usr/bin/env node
// esbuild orchestrator for the radar_chart_studio Dashboard Studio
// visualization. Single-entry version of the build.mjs that
// `@splunk/create --mode=dashboard-studio-extension` scaffolds, adapted to
// build in place (visualization.js lands next to src/, like the classic
// viz's webpack output) instead of into a project-level dist/ directory.
import { build, context } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssInjectAndSizeWarnPlugin } from './build-plugins/css-and-size.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
const isProduction = process.env.NODE_ENV === 'production';

const entryPoint = join(__dirname, 'src', 'visualization.js');
const outFile = join(__dirname, 'visualization.js');

// esbuild's node-compat __toESM wrapping for CJS packages under node_modules
// can mishandle @splunk/dashboard-studio-extension's dual CJS+ESM exports
// map. Re-export via a virtual ESM shim so esbuild never applies node-compat
// mode to it (same interop esbuild's own dashboard-studio-extension scaffold
// uses for all @splunk/* imports).
function packageHasEsmEntry(resolvedPath) {
    let dir = dirname(resolvedPath);
    while (dir !== dirname(dir)) {
        const pkgPath = join(dir, 'package.json');
        if (existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
                if (pkg.module) return true;
                if (pkg.exports && JSON.stringify(pkg.exports).includes('"import"')) return true;
            } catch {
                // ignore malformed package.json
            }
            return false;
        }
        dir = dirname(dir);
    }
    return false;
}

const splunkCjsInteropPlugin = {
    name: 'splunk-cjs-interop',
    setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^@splunk\// }, async (args) => {
            if (args.kind !== 'import-statement' && args.kind !== 'entry-point') return undefined;
            const result = await pluginBuild.resolve(args.path, {
                resolveDir: args.resolveDir,
                kind: 'require-call',
            });
            if (result.errors.length) return result;
            if (packageHasEsmEntry(result.path)) return undefined;
            return { path: result.path, namespace: 'splunk-esm-shim' };
        });

        pluginBuild.onLoad({ filter: /.*/, namespace: 'splunk-esm-shim' }, (args) => ({
            contents: `
const _cjs = require(${JSON.stringify(args.path)});
const _mod = (_cjs && _cjs.__esModule) ? _cjs : { default: _cjs };
const _default = (typeof _mod.default === 'object' && _mod.default !== null && typeof _mod.default.default === 'function')
    ? _mod.default.default
    : _mod.default;
export default _default;
export * from ${JSON.stringify(args.path)};
`,
            loader: 'js',
            resolveDir: dirname(args.path),
        }));
    },
};

// d3 v7 ships as proper per-module ESM (unlike v3's unbound-this UMD
// bundle), so no build-time patching of node_modules is needed here.

const buildOptions = {
    entryPoints: [entryPoint],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2017',
    minify: isProduction,
    sourcemap: !isProduction,
    plugins: [splunkCjsInteropPlugin, cssInjectAndSizeWarnPlugin],
    loader: {
        '.png': 'dataurl',
        '.jpg': 'dataurl',
        '.jpeg': 'dataurl',
        '.gif': 'dataurl',
        '.svg': 'dataurl',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
    },
};

if (isWatch) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
} else {
    await build(buildOptions);
    console.log(`Built ${outFile}`);
}
