import * as vscode from 'vscode';
import { ClassNode } from '../types';
import { extractClasses } from './parser';

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
    context.subscriptions.push(
        watcher,
        watcher.onDidCreate(invalidate),
        watcher.onDidDelete(invalidate),
        watcher.onDidChange(invalidate),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.languageId === 'python') {
                invalidate();
            }
        })
    );
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

    for (const uri of files) {
        progress?.report({
            message: uri.fsPath.split('/').pop(),
            increment: step,
        });
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
