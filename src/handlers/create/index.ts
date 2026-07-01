import * as vscode from 'vscode';
import * as path from 'path';
import { scanWorkspaceClasses, invalidateScanCache } from '../../utils/scan';
import { renderCreateBoard, ExistingModuleInfo } from './webview';
import {
    generateFiles,
    CreateBoardState,
    GeneratedFile,
} from './generate';

const VIEW_TYPE = 'pytreeCreateBoard';

export async function showCreateBoard(
    context: vscode.ExtensionContext
): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'PyTree: Create',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        ...'assets/images/file-icon.png'.split('/')
    );

    const html = await buildHtml(context);
    panel.webview.html = html;

    panel.webview.onDidReceiveMessage(async msg => {
        if (msg.command === 'createFiles') {
            await handleCreate(panel, msg.payload as CreateBoardState);
        }
    });
}

async function readDistBundle(
    context: vscode.ExtensionContext,
    file: string
): Promise<string> {
    // The board reuses two esbuild bundles emitted alongside the extension
    // (see esbuild.js): `edgeLayout.client.js` (the shared lane-assignment /
    // highway-routing geometry, attached to `window.PTEdgeLayout`) and
    // `createBoard.client.js` (this board's own runtime).
    const uri = vscode.Uri.joinPath(context.extensionUri, 'dist', file);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf-8');
}

async function buildHtml(context: vscode.ExtensionContext): Promise<string> {
    const [edgeLayoutScript, clientScript] = await Promise.all([
        readDistBundle(context, 'edgeLayout.client.js'),
        readDistBundle(context, 'createBoard.client.js'),
    ]);
    const classNames: string[] = [];
    const moduleSet = new Map<string, ExistingModuleInfo>();
    try {
        const classes = await scanWorkspaceClasses();
        for (const node of classes.values()) {
            classNames.push(node.name);
        }
    } catch {
        // empty workspace or scan failure
    }

    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (wsFolder) {
        const wsBase = wsFolder.uri.fsPath;
        try {
            const files = await vscode.workspace.findFiles(
                '**/*.py',
                '{**/node_modules/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/.git/**,**/site-packages/**}'
            );
            for (const uri of files) {
                const rel = path
                    .relative(wsBase, uri.fsPath)
                    .replace(/\\/g, '/');
                if (!rel || rel.startsWith('..')) {
                    continue;
                }
                if (!moduleSet.has(rel)) {
                    moduleSet.set(rel, {
                        name: path.basename(rel, '.py'),
                        relativePath: rel,
                        fileUri: uri.toString(),
                    });
                }
            }
        } catch {
            // ignore: autocomplete is non-essential
        }
    }
    return renderCreateBoard(
        classNames,
        [...moduleSet.values()],
        edgeLayoutScript,
        clientScript
    );
}

async function handleCreate(
    panel: vscode.WebviewPanel,
    state: CreateBoardState
): Promise<void> {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {
        await panel.webview.postMessage({
            command: 'createError',
            error: 'Open a workspace folder before creating files.',
        });
        return;
    }
    let files: GeneratedFile[];
    try {
        files = generateFiles(state);
    } catch (e) {
        await panel.webview.postMessage({
            command: 'createError',
            error: 'Failed to generate Python source: ' + (e as Error).message,
        });
        return;
    }

    const wsRoot = wsFolder.uri;
    const overwriteCandidates: GeneratedFile[] = [];
    for (const file of files) {
        if (file.appendToExisting) {
            continue;
        }
        const target = vscode.Uri.joinPath(
            wsRoot,
            ...file.relativePath.split('/')
        );
        try {
            await vscode.workspace.fs.stat(target);
            overwriteCandidates.push(file);
        } catch {
            // doesn't exist — safe to create
        }
    }

    if (overwriteCandidates.length > 0) {
        const list = overwriteCandidates.map(f => f.relativePath).join('\n');
        const choice = await vscode.window.showWarningMessage(
            `Overwrite ${overwriteCandidates.length} existing file(s)?\n\n${list}`,
            { modal: true },
            'Overwrite',
            'Skip these'
        );
        if (choice === undefined) {
            return;
        }
        if (choice === 'Skip these') {
            const skip = new Set(overwriteCandidates.map(f => f.relativePath));
            files = files.filter(f => !skip.has(f.relativePath));
        }
    }

    let written = 0;
    const writtenUris: vscode.Uri[] = [];
    for (const file of files) {
        try {
            if (file.appendToExisting && file.existingFileUri) {
                await appendToFile(
                    vscode.Uri.parse(file.existingFileUri),
                    file.content
                );
                writtenUris.push(vscode.Uri.parse(file.existingFileUri));
            } else {
                const target = vscode.Uri.joinPath(
                    wsRoot,
                    ...file.relativePath.split('/')
                );
                await ensureParentDir(target);
                await vscode.workspace.fs.writeFile(
                    target,
                    Buffer.from(file.content, 'utf-8')
                );
                writtenUris.push(target);
            }
            written++;
        } catch (e) {
            await panel.webview.postMessage({
                command: 'createError',
                error: `Failed to write ${file.relativePath}: ${(e as Error).message}`,
            });
            return;
        }
    }

    invalidateScanCache();
    await panel.webview.postMessage({
        command: 'createDone',
        fileCount: written,
    });

    if (writtenUris.length > 0) {
        await vscode.window.showTextDocument(writtenUris[0], { preview: false });
    }
    vscode.window.showInformationMessage(
        `PyTree: created/updated ${written} file(s).`
    );
}

async function ensureParentDir(target: vscode.Uri): Promise<void> {
    const parent = vscode.Uri.joinPath(target, '..');
    try {
        await vscode.workspace.fs.createDirectory(parent);
    } catch {
        // already exists
    }
}

async function appendToFile(target: vscode.Uri, content: string): Promise<void> {
    let existing = '';
    try {
        const bytes = await vscode.workspace.fs.readFile(target);
        existing = Buffer.from(bytes).toString('utf-8');
    } catch {
        existing = '';
    }
    const separator = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    const combined = existing + separator + content;
    await vscode.workspace.fs.writeFile(
        target,
        Buffer.from(combined, 'utf-8')
    );
}
