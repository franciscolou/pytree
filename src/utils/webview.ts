import * as vscode from 'vscode';
import type { ClassNode } from '../types';
import { Messages } from '../config';
import { renderRootStyles } from '../ui/components';
import {
    detectCycle,
    detectAlreadyInherits,
    detectConflicts,
    rewriteInheritance,
} from './inheritance';
import { invalidateScanCache, getScanGeneration } from './scan';

export interface PanelState {
    html: string;
    fileUris: string[];
    classes: Map<string, ClassNode>;
}

export type PanelStateProvider = () => Promise<PanelState | null>;

type PanelEntry = {
    panel: vscode.WebviewPanel;
    fileVersions: Map<string, number>;
    generation: number;
    extraKey: string;
    provider?: PanelStateProvider;
};

const panelRegistry = new Map<string, PanelEntry>();

// Versions of the involved files, read only from already-open documents — no
// `openTextDocument`, which would force-load (and parse) every file in the
// workspace just to compare a number. A file that isn't open can't have
// unsaved changes; its on-disk mutations are covered by the scan generation
// counter, checked alongside this map in `panelEntryMatches`.
function getFileVersions(fileUris: string[]): Map<string, number> {
    const openVersions = new Map<string, number>(
        vscode.workspace.textDocuments.map(d => [d.uri.toString(), d.version])
    );
    const versions = new Map<string, number>();
    for (const uri of fileUris) {
        versions.set(uri, openVersions.get(uri) ?? -1);
    }
    return versions;
}

function panelEntryMatches(
    entry: PanelEntry,
    fileVersions: Map<string, number>,
    extraKey: string
): boolean {
    if (entry.extraKey !== extraKey) {
        return false;
    }
    if (entry.generation !== getScanGeneration()) {
        return false;
    }
    if (entry.fileVersions.size !== fileVersions.size) {
        return false;
    }
    for (const [uri, version] of entry.fileVersions) {
        if (fileVersions.get(uri) !== version) {
            return false;
        }
    }
    return true;
}

async function handleExport(msg: {
    format: string;
    svgContent?: string;
    themeKind?: string;
    base64?: string;
}): Promise<void> {
    if (msg.format === 'svg') {
        const uri = await vscode.window.showSaveDialog({
            filters: { 'SVG Images': ['svg'] },
            saveLabel: 'Export',
        });
        if (!uri) {
            return;
        }
        await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(msg.svgContent!, 'utf-8')
        );
        return;
    }

    const uri = await vscode.window.showSaveDialog({
        filters: { 'HTML Files': ['html'] },
        saveLabel: 'Export',
    });
    if (!uri) {
        return;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
${renderRootStyles()}
<style>
  html, body { margin: 0; padding: 0; background: var(--pt-bg); }
  svg { display: block; }
</style>
</head>
<body data-vscode-theme-kind="${msg.themeKind ?? 'vscode-dark'}">
${msg.svgContent}
</body>
</html>`;

    await vscode.workspace.fs.writeFile(uri, Buffer.from(html, 'utf-8'));
}

async function handleNavigate(fileUri: string, line: number): Promise<void> {
    const uri = vscode.Uri.parse(fileUri);
    const pos = new vscode.Position(line, 0);
    const existingEditor = vscode.window.visibleTextEditors.find(
        e => e.document.uri.toString() === uri.toString()
    );
    const editor = existingEditor
        ? await vscode.window.showTextDocument(
              existingEditor.document,
              existingEditor.viewColumn
          )
        : await vscode.window.showTextDocument(uri, { preview: true });
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(
        new vscode.Range(pos, pos),
        vscode.TextEditorRevealType.InCenter
    );
}

async function refreshPanel(viewType: string): Promise<void> {
    const entry = panelRegistry.get(viewType);
    if (!entry || !entry.provider) {
        return;
    }
    try {
        const state = await entry.provider();
        if (!state) {
            return;
        }
        entry.panel.webview.html = state.html;
        entry.fileVersions = getFileVersions(state.fileUris);
        entry.generation = getScanGeneration();
    } catch {
        // ignore
    }
}

async function handleChangeInheritance(
    viewType: string,
    childId: string,
    oldParentId: string,
    newParentId: string
): Promise<void> {
    const entry = panelRegistry.get(viewType);
    if (!entry?.provider) {
        return;
    }
    const state = await entry.provider();
    if (!state) {
        return;
    }
    const { classes } = state;

    const child = classes.get(childId);
    const oldParent = classes.get(oldParentId);
    const newParent = classes.get(newParentId);
    if (!child || !oldParent || !newParent) {
        return;
    }

    if (oldParent.id === newParent.id) {
        vscode.window.showInformationMessage(Messages.inheritance.sameParent);
        return;
    }

    if (detectAlreadyInherits(child, oldParentId, newParentId, classes)) {
        vscode.window.showErrorMessage(
            Messages.inheritance.alreadyInheritsError(
                child.name,
                newParent.name
            )
        );
        return;
    }

    if (detectCycle(childId, newParentId, classes)) {
        vscode.window.showErrorMessage(
            Messages.inheritance.cycleError(child.name, newParent.name)
        );
        return;
    }

    const conflicts = detectConflicts(child, oldParentId, newParentId, classes);
    if (conflicts.attrs.length || conflicts.methods.length) {
        const lines: string[] = [
            Messages.inheritance.conflictTitle(child.name, newParent.name),
        ];
        if (conflicts.attrs.length) {
            lines.push(Messages.inheritance.conflictAttrs(conflicts.attrs));
        }
        if (conflicts.methods.length) {
            lines.push(Messages.inheritance.conflictMethods(conflicts.methods));
        }
        lines.push(Messages.inheritance.conflictFooter);
        const choice = await vscode.window.showWarningMessage(
            lines.join('\n\n'),
            { modal: true },
            Messages.inheritance.applyAnyway
        );
        if (choice !== Messages.inheritance.applyAnyway) {
            return;
        }
    } else {
        const choice = await vscode.window.showInformationMessage(
            Messages.inheritance.confirmTitle(
                child.name,
                oldParent.name,
                newParent.name
            ),
            { modal: true },
            Messages.inheritance.confirmApply
        );
        if (choice !== Messages.inheritance.confirmApply) {
            return;
        }
    }

    const ok = await rewriteInheritance(child, oldParent, newParent);
    if (!ok) {
        vscode.window.showErrorMessage(Messages.inheritance.rewriteFailed);
        return;
    }

    invalidateScanCache();
    await refreshPanel(viewType);
    vscode.window.showInformationMessage(
        Messages.inheritance.appliedNotice(child.name, newParent.name)
    );
}

function setupPanel(
    context: vscode.ExtensionContext,
    viewType: string,
    title: string,
    html: string
): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        viewType,
        title,
        vscode.ViewColumn.Beside,
        { enableScripts: true }
    );
    panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        ...'assets/images/file-icon.svg'.split('/')
    );
    panel.webview.html = html;

    panel.webview.onDidReceiveMessage(async msg => {
        if (msg.command === 'navigate') {
            await handleNavigate(msg.fileUri, msg.line);
            return;
        }
        if (msg.command === 'changeInheritance') {
            await handleChangeInheritance(
                viewType,
                msg.childId,
                msg.oldParentId,
                msg.newParentId
            );
            return;
        }
        if (msg.command === 'export') {
            await handleExport(msg);
            return;
        }
    });

    return panel;
}

/**
 * Opens a webview panel. When `fileUris` is provided, reuses an existing
 * panel of the same viewType if all involved files are unchanged (same VSCode
 * document version) and `extraKey` matches. If any file changed or the key
 * differs, a new panel is created so both versions can be compared side-by-side.
 *
 * `provider`, when supplied, is invoked to refresh the panel after the user
 * mutates inheritance via drag-and-drop. It must return the up-to-date state
 * (HTML, involved file URIs, and the classes map).
 */
export async function openWebview(
    context: vscode.ExtensionContext,
    viewType: string,
    title: string,
    html: string,
    fileUris?: string[],
    extraKey = '',
    provider?: PanelStateProvider
): Promise<void> {
    if (fileUris?.length) {
        const currentVersions = getFileVersions(fileUris);
        const entry = panelRegistry.get(viewType);
        if (entry && panelEntryMatches(entry, currentVersions, extraKey)) {
            entry.panel.reveal();
            entry.provider = provider ?? entry.provider;
            return;
        }
        const panel = setupPanel(context, viewType, title, html);
        panelRegistry.set(viewType, {
            panel,
            fileVersions: currentVersions,
            generation: getScanGeneration(),
            extraKey,
            provider,
        });
        panel.onDidDispose(() => {
            if (panelRegistry.get(viewType)?.panel === panel) {
                panelRegistry.delete(viewType);
            }
        });
        return;
    }

    setupPanel(context, viewType, title, html);
}
