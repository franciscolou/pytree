import * as vscode from 'vscode';
import { ClassRef } from './types';
import {
    showClassTree,
    showCompleteClassTree,
    showProjectTree,
    showPickClassesTree,
    showPickPathsTree,
    showAllExceptTree,
    showCreateBoard,
} from './handlers';
import { Messages } from './config';
import { HoverProvider } from './providers/hover';
import { initCache, scanWorkspaceClasses } from './utils/scan';
import { setWorkspaceUri } from './ui/render/classBox';

const PYLANCE_EXTENSION_ID = 'ms-python.vscode-pylance';
const PYLANCE_PROBE_INTERVAL_MS = 1_000;
const PYLANCE_READY_TIMEOUT_MS = 120_000;
const SCAN_EXCLUDE_GLOB =
    '{**/node_modules/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/.git/**,**/site-packages/**}';

export function activate(context: vscode.ExtensionContext) {
    const workspaceUri =
        vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? '';
    setWorkspaceUri(workspaceUri);
    initCache(context);
    context.subscriptions.push(
        registerShowClassCommand(context),
        registerShowCompleteClassCommand(context),
        registerShowProjectTreeCommand(context),
        registerPickClassesCommand(context),
        registerPickPathsCommand(context),
        registerAllExceptCommand(context),
        registerCreateCommand(context),
        scheduleBackgroundScan(),
        registerHoverProvider()
    );
}

// Fire-and-forget warmup: kick off a workspace scan once Pylance's symbol
// provider is responsive, so the first PyTree command on a large repo (e.g.
// Django) hits a warm cache instead of paying ~25k LSP calls synchronously.
// We probe Pylance directly instead of waiting a fixed timeout — fast
// startups don't pay an unnecessary wait, slow ones don't kick off prematurely.
function scheduleBackgroundScan(): vscode.Disposable {
    let cancelled = false;
    void (async () => {
        const ready = await waitForPylanceReady();
        if (cancelled || !ready) {
            return;
        }
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: Messages.status.backgroundScan,
                cancellable: false,
            },
            async progress => {
                // Drop per-file `message` updates: the warmup scan should show
                // a fixed title plus an advancing bar only. User-triggered
                // scans keep the live filename by passing their progress
                // reporter through unwrapped.
                const silent: vscode.Progress<{
                    message?: string;
                    increment?: number;
                }> = {
                    report: ({ increment }) => progress.report({ increment }),
                };
                try {
                    await scanWorkspaceClasses(silent);
                } catch {
                    // Silent: the next user-triggered command falls back to
                    // the lazy path with its own progress UI.
                }
            }
        );
    })();
    return {
        dispose: () => {
            cancelled = true;
        },
    };
}

// Polls the document-symbol provider on a sample .py file until Pylance
// responds (or the hard timeout elapses). Returns true if a provider answered,
// false if we gave up. Waits on the extension's `activate()` first when
// installed, then probes — the activate promise resolves before the LSP
// finishes booting, so probing is still required.
async function waitForPylanceReady(): Promise<boolean> {
    const pylance = vscode.extensions.getExtension(PYLANCE_EXTENSION_ID);
    if (pylance) {
        try {
            await pylance.activate();
        } catch {
            // Fall through to probing — provider may still register.
        }
    }

    const sample = await vscode.workspace.findFiles(
        '**/*.py',
        SCAN_EXCLUDE_GLOB,
        1
    );
    if (sample.length === 0) {
        return false;
    }

    const deadline = Date.now() + PYLANCE_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const doc = await vscode.workspace.openTextDocument(sample[0]);
            const symbols = await vscode.commands.executeCommand<
                vscode.DocumentSymbol[] | undefined
            >('vscode.executeDocumentSymbolProvider', doc.uri);
            if (symbols !== undefined) {
                return true;
            }
        } catch {
            // Not ready yet.
        }
        await new Promise(resolve =>
            setTimeout(resolve, PYLANCE_PROBE_INTERVAL_MS)
        );
    }
    return false;
}

export function deactivate() {}

function registerHoverProvider(): vscode.Disposable {
    return vscode.languages.registerHoverProvider('python', HoverProvider);
}

function registerShowClassCommand(
    context: vscode.ExtensionContext
): vscode.Disposable {
    return vscode.commands.registerCommand(
        'pytree.showClassTree',
        (ref?: ClassRef) => showClassTree(context, ref)
    );
}

function registerShowCompleteClassCommand(
    context: vscode.ExtensionContext
): vscode.Disposable {
    return vscode.commands.registerCommand(
        'pytree.showCompleteClassTree',
        (ref?: ClassRef) => showCompleteClassTree(context, ref)
    );
}

function registerShowProjectTreeCommand(
    context: vscode.ExtensionContext
): vscode.Disposable {
    return vscode.commands.registerCommand('pytree.showProjectTree', () =>
        showProjectTree(context)
    );
}

function registerPickClassesCommand(
    context: vscode.ExtensionContext
): vscode.Disposable {
    return vscode.commands.registerCommand('pytree.pickClasses', () =>
        showPickClassesTree(context)
    );
}

function registerPickPathsCommand(
    context: vscode.ExtensionContext
): vscode.Disposable {
    return vscode.commands.registerCommand('pytree.pickPaths', () =>
        showPickPathsTree(context)
    );
}

function registerAllExceptCommand(
    context: vscode.ExtensionContext
): vscode.Disposable {
    return vscode.commands.registerCommand('pytree.allExcept', () =>
        showAllExceptTree(context)
    );
}

function registerCreateCommand(
    context: vscode.ExtensionContext
): vscode.Disposable {
    return vscode.commands.registerCommand('pytree.create', () =>
        showCreateBoard(context)
    );
}
