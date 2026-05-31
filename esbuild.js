const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Builds an esbuild plugin that prefixes the standard problem-matcher
 * start/end markers with a human-readable bundle name, so the npm output
 * tells you which of the three bundles (extension, edgeLayout, viewport)
 * is being rebuilt instead of three indistinguishable lines.
 *
 * @param {string} label — short bundle name, e.g. "extension", "viewport-client"
 * @param {string} [outfile] — optional output path to print alongside the label
 * @returns {import('esbuild').Plugin}
 */
function problemMatcherPlugin(label, outfile) {
    const tag = outfile ? `${label} → ${outfile}` : label;
    return {
        name: `esbuild-problem-matcher:${label}`,

        setup(build) {
            let started = 0;
            build.onStart(() => {
                started = Date.now();
                console.log(`[watch] build started (${tag})`);
            });
            build.onEnd(result => {
                result.errors.forEach(({ text, location }) => {
                    console.error(`✘ [ERROR] ${text}`);
                    console.error(
                        `    ${location.file}:${location.line}:${location.column}:`
                    );
                });
                const ms = Date.now() - started;
                const errs = result.errors.length;
                const warns = result.warnings.length;
                const status =
                    errs > 0
                        ? `failed with ${errs} error(s)`
                        : warns > 0
                            ? `ok (${warns} warning(s))`
                            : 'ok';
                console.log(
                    `[watch] build finished (${tag}) — ${status} in ${ms}ms`
                );
            });
        },
    };
}

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        logLevel: 'silent',
        plugins: [problemMatcherPlugin('extension', 'dist/extension.js')],
    });
    // Pure geometry module bundled separately as a browser IIFE so the
    // PyTree: Create webview can use the SAME algorithm as the auto-tree
    // SVG renderer — no hand-copied duplicate of the lane-assignment /
    // highway-routing code. Exposed at `window.PTEdgeLayout`.
    const edgeLayoutCtx = await esbuild.context({
        entryPoints: ['src/ui/utils/edgeLayout.ts'],
        bundle: true,
        format: 'iife',
        globalName: 'PTEdgeLayout',
        platform: 'browser',
        outfile: 'dist/edgeLayout.client.js',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        logLevel: 'silent',
        plugins: [
            problemMatcherPlugin(
                'edgeLayout-client',
                'dist/edgeLayout.client.js'
            ),
        ],
    });
    // Auto-tree viewport runtime (pan/zoom, edge drag, find bar, lazy
    // hydration, ...). Lives as plain TypeScript under src/ui/viewport/ so
    // it goes through the same type-check + lint pipeline as everything
    // else, instead of being a string-templated blob inside viewport.ts.
    const viewportClientCtx = await esbuild.context({
        entryPoints: ['src/ui/viewport/client.ts'],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        outfile: 'dist/viewport.client.js',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        logLevel: 'silent',
        plugins: [
            problemMatcherPlugin(
                'viewport-client',
                'dist/viewport.client.js'
            ),
        ],
    });
    // PyTree: Create board client runtime. Plain TypeScript (same rationale as
    // the viewport client) bundled as a self-running IIFE; it references the
    // shared edge geometry through the `PTEdgeLayout` global loaded ahead of
    // it, importing only its types.
    const createBoardClientCtx = await esbuild.context({
        entryPoints: ['src/handlers/create/client.ts'],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        outfile: 'dist/createBoard.client.js',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        logLevel: 'silent',
        plugins: [
            problemMatcherPlugin(
                'createBoard-client',
                'dist/createBoard.client.js'
            ),
        ],
    });
    if (watch) {
        await Promise.all([
            ctx.watch(),
            edgeLayoutCtx.watch(),
            viewportClientCtx.watch(),
            createBoardClientCtx.watch(),
        ]);
    } else {
        await Promise.all([
            ctx.rebuild(),
            edgeLayoutCtx.rebuild(),
            viewportClientCtx.rebuild(),
            createBoardClientCtx.rebuild(),
        ]);
        await Promise.all([
            ctx.dispose(),
            edgeLayoutCtx.dispose(),
            viewportClientCtx.dispose(),
            createBoardClientCtx.dispose(),
        ]);
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
