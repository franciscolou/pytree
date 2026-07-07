import * as vscode from 'vscode';
import { Messages } from '../config';
import { scanWorkspaceClasses } from '../utils/scan';
import {
    buildComponentLayers,
    buildConnectedComponents,
} from '../ui/utils/layering';
import { openWebview, PanelState } from '../utils/webview';
import { renderProjectTree } from '../ui/render/trees/project';

export async function showProjectTree(context: vscode.ExtensionContext) {
    const computeState = async (
        progress?: vscode.Progress<{
            message?: string;
            increment?: number;
        }>
    ): Promise<PanelState | null> => {
        const allClasses = await scanWorkspaceClasses(progress);
        if (!allClasses.size) {
            return null;
        }
        const components = buildConnectedComponents(allClasses);
        const componentLayers = components.map(comp =>
            buildComponentLayers(comp)
        );
        const fileUris = [
            ...new Set([...allClasses.values()].map(n => n.fileUri)),
        ];
        return {
            html: renderProjectTree(componentLayers, allClasses),
            fileUris,
            classes: allClasses,
        };
    };

    let state: PanelState | null = null;
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: Messages.status.scanningFiles,
            cancellable: false,
        },
        async progress => {
            state = await computeState(progress);
        }
    );

    if (!state) {
        vscode.window.showInformationMessage(Messages.errors.noClassesFound);
        return;
    }
    const finalState: PanelState = state;

    await openWebview(
        context,
        'pytreeProjectTree',
        Messages.webView.titles.projectTree,
        finalState.html,
        finalState.fileUris,
        '',
        () => computeState()
    );
}
