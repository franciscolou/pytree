import * as vscode from 'vscode';
import { ClassNode } from '../types';
import { extractClasses, invalidateParserCache } from './parser';

// Bounded concurrency for the workspace scan. Pylance handles concurrent LSP
// requests internally; with parallel workers we overlap file I/O with LSP
// work and avoid the long sequential tail. 16 is a balance: high enough to
// hide latency, low enough to not flood Pylance's request queue or push its
// memory up with too many concurrently-parsed ASTs.
const FILE_CONCURRENCY = 16;

// Cheap structural pre-check: any line that starts with `class Name`. False
// positives (commented-out or string-literal "class") cost only a wasted LSP
// call. False negatives are essentially impossible — Python class declarations
// always start with the `class` keyword at the line start (modulo indent).
const CLASS_KEYWORD_RE = /^[ \t]*class[ \t]+\w/m;
const TEXT_DECODER = new TextDecoder('utf-8');

let scanCache: Map<string, ClassNode> | null = null;
let scanInProgress: Promise<Map<string, ClassNode>> | null = null;

function invalidate(): void {
    scanCache = null;
    scanInProgress = null;
}

export function invalidateScanCache(): void {
    invalidate();
}

export function initCache(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.py');
    const invalidateFor = (uri: vscode.Uri): void => {
        invalidate();
        invalidateParserCache(uri);
    };
    context.subscriptions.push(
        watcher,
        watcher.onDidCreate(invalidateFor),
        watcher.onDidDelete(invalidateFor),
        watcher.onDidChange(invalidateFor),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.languageId === 'python') {
                invalidate();
                invalidateParserCache(doc.uri);
            }
        })
    );
}

// Skips the expensive `openTextDocument` + `executeDocumentSymbolProvider`
// pair when the file plainly has no class declarations. On Django-shaped
// repos this drops migration files, settings, urls, scripts, and many
// `__init__.py`s — often a large fraction of all `.py` files. Conservative
// on errors so we never lose a class to a transient read failure.
async function fileHasClass(uri: vscode.Uri): Promise<boolean> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return CLASS_KEYWORD_RE.test(TEXT_DECODER.decode(bytes));
    } catch {
        return true;
    }
}

async function processFile(
    uri: vscode.Uri,
    allClasses: Map<string, ClassNode>
): Promise<void> {
    if (!(await fileHasClass(uri))) {
        return;
    }
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const classes = await extractClasses(doc);
        for (const [id, node] of classes) {
            allClasses.set(id, node);
        }
    } catch {
        // skip files that can't be parsed
    }
}

async function performScan(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Map<string, ClassNode>> {
    const files = await vscode.workspace.findFiles(
        '**/*.py',
        '{**/node_modules/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/.git/**,**/site-packages/**}'
    );

    const allClasses = new Map<string, ClassNode>();
    const step = files.length > 0 ? 100 / files.length : 100;

    // Shared work queue: each worker pulls the next file index and processes
    // it. Map.set is safe under JS's single-threaded model — workers
    // interleave at `await` points but never preempt each other mid-write.
    let nextIdx = 0;
    const workerCount = Math.max(1, Math.min(FILE_CONCURRENCY, files.length));
    const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
            const idx = nextIdx++;
            if (idx >= files.length) {
                return;
            }
            const uri = files[idx];
            await processFile(uri, allClasses);
            progress?.report({
                message: uri.fsPath.split('/').pop(),
                increment: step,
            });
        }
    });

    await Promise.all(workers);
    return allClasses;
}

export async function scanWorkspaceClasses(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Map<string, ClassNode>> {
    if (scanCache) {
        return scanCache;
    }
    // Concurrent callers (e.g. the background deferred scan from activate()
    // + a user-triggered command racing it) share the same in-flight scan.
    // The second caller's `progress` reporter is ignored — its withProgress
    // notification just shows an indeterminate spinner, which is fine.
    if (scanInProgress) {
        return scanInProgress;
    }

    const myScan = performScan(progress);
    scanInProgress = myScan;
    try {
        const result = await myScan;
        // Only commit the result if no invalidation happened mid-scan. A
        // FileSystemWatcher event during the scan zeroes scanInProgress; we
        // then refuse to populate scanCache so the next caller starts fresh.
        if (scanInProgress === myScan) {
            scanCache = result;
        }
        return result;
    } finally {
        if (scanInProgress === myScan) {
            scanInProgress = null;
        }
    }
}
