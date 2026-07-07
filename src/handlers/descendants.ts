import * as vscode from 'vscode';
import { openWebview, PanelState } from '../utils/webview';
import { resolveClassNode, resolveLayeredNodes } from '../utils/resolve';
import { Messages } from '../config';
import { extractClasses } from '../utils/parser';
import { scanWorkspaceClasses } from '../utils/scan';
import { collectDescendants } from '../ui/utils/layering';
import { renderClassTree } from '../ui/render/trees/single';
import { ClassRef } from '../types';

export async function showDescendantsTree(
    context: vscode.ExtensionContext,
    ref?: ClassRef
) {
    const focusNode = await resolveClassNode(ref);
    if (!focusNode) {
        vscode.window.showInformationMessage(Messages.errors.noClassUnderCursor);
        return;
    }

    const focusRef: ClassRef = {
        fileUri: focusNode.fileUri,
        line: focusNode.definedAtLine,
    };

    const computeState = async (
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<PanelState | null> => {
        const node = await resolveClassNode(focusRef);
        if (!node) {
            return null;
        }
        const document = await vscode.workspace.openTextDocument(
            vscode.Uri.parse(node.fileUri)
        );
        const classes = await extractClasses(document);

        // Descendants come from the workspace scan (same strategy as the
        // Complete Tree and Project Tree) since Pylance's subtype index is
        // unreliable on large repos — finding subclasses across the
        // workspace requires the full scan rather than the focus file alone.
        const allClasses = await scanWorkspaceClasses(progress);
        for (const [id, n] of allClasses) {
            if (!classes.has(id)) {
                classes.set(id, n);
            }
        }
        const descendants = resolveLayeredNodes(
            collectDescendants(node.id, classes),
            classes
        );

        const treeFiles = new Set<string>([node.fileUri]);
        for (const layer of descendants) {
            for (const n of layer) {
                treeFiles.add(n.fileUri);
            }
        }
        const fileUris = [...treeFiles];
        return {
            html: renderClassTree(node, [], descendants),
            fileUris,
            classes,
        };
    };

    let state: PanelState | null = null;
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: Messages.status.scanningFiles,
            cancellable: false,
        },
        async reporter => {
            state = await computeState(reporter);
        }
    );

    if (!state) {
        return;
    }
    const finalState: PanelState = state;

    await openWebview(
        context,
        'pytreeClassTree',
        Messages.webView.titles.descendantsTree(focusNode.name),
        finalState.html,
        finalState.fileUris,
        'descendants:' + focusNode.id,
        () => computeState()
    );
}
