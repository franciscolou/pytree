import { Messages } from '../../config';

export interface FilterInfo {
    mode: 'include' | 'exclude';
    paths: string[];
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderFilterBadge(info: FilterInfo): string {
    const label = info.mode === 'exclude' ? 'Excluded' : 'Showing';
    const count = info.paths.length;
    const items = info.paths
        .map(p => `<div class="filter-info-item">${escapeHtml(p)}</div>`)
        .join('');
    return `
<div id="filter-info">
    <div id="filter-info-chip">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="display:block;flex-shrink:0;">
            <path d="M2 3h9M3.5 6.5h6M5 10h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>${label}: ${count} path${count === 1 ? '' : 's'}</span>
    </div>
    <div id="filter-info-popup">
        <div id="filter-info-header">${label} path${count === 1 ? '' : 's'}</div>
        <div id="filter-info-list">${items}</div>
    </div>
</div>`;
}

export function WebViewOptions(
    filterInfo?: FilterInfo,
    dragEnabled?: boolean
): string {
    return `
<style>
  #export-btn {
    background: var(--pt-glass-bg);
    -webkit-backdrop-filter: blur(16px) saturate(150%);
    backdrop-filter: blur(16px) saturate(150%);
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  #export-btn:hover {
    background: var(--pt-glass-hover);
    border-color: var(--pt-accent);
  }
  #filter-info {
    position: relative;
  }
  #filter-info-chip {
    background: var(--pt-glass-bg);
    -webkit-backdrop-filter: blur(16px) saturate(150%);
    backdrop-filter: blur(16px) saturate(150%);
    border: 1px solid var(--pt-glass-border);
    border-radius: 9px;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: var(--pt-shadow-float);
    cursor: default;
    color: var(--pt-text);
    font-size: 12px;
    user-select: none;
    transition: background 0.15s ease;
  }
  #filter-info-chip:hover {
    background: var(--pt-glass-hover);
  }
  #filter-info-popup {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: var(--pt-glass-bg);
    -webkit-backdrop-filter: blur(16px) saturate(150%);
    backdrop-filter: blur(16px) saturate(150%);
    border: 1px solid var(--pt-glass-border);
    border-radius: 10px;
    box-shadow: var(--pt-shadow-float);
    overflow: hidden;
    opacity: 0;
    transform: translateY(-4px);
    pointer-events: none;
    transition: opacity 0.12s ease, transform 0.12s ease;
    z-index: 10;
    min-width: 220px;
    max-width: 480px;
    max-height: 360px;
    overflow-y: auto;
  }
  #filter-info:hover #filter-info-popup {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
  #filter-info-header {
    padding: 6px 10px;
    font-size: 11px;
    color: var(--pt-section-label);
    border-bottom: 1px solid var(--pt-border);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    user-select: none;
  }
  #filter-info-list {
    padding: 4px 0;
  }
  .filter-info-item {
    padding: 4px 10px;
    font-size: 12px;
    font-family: monospace;
    color: var(--pt-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .filter-info-item:hover {
    background: var(--pt-glass-hover);
  }
  #export-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: var(--pt-glass-bg);
    -webkit-backdrop-filter: blur(16px) saturate(150%);
    backdrop-filter: blur(16px) saturate(150%);
    border: 1px solid var(--pt-glass-border);
    border-radius: 10px;
    box-shadow: var(--pt-shadow-float);
    overflow: hidden;
    opacity: 0;
    transform: translateY(-4px);
    pointer-events: none;
    transition: opacity 0.12s ease, transform 0.12s ease;
    white-space: nowrap;
    min-width: 100%;
    z-index: 10;
  }
  #export-menu.open {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
  .export-menu-item {
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    color: var(--pt-text);
    user-select: none;
    transition: background 0.1s ease;
  }
  .export-menu-item:hover {
    background: var(--pt-accent-soft);
    color: var(--pt-accent);
  }
  #options-btn {
    background: var(--pt-glass-bg);
    -webkit-backdrop-filter: blur(16px) saturate(150%);
    backdrop-filter: blur(16px) saturate(150%);
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  #options-btn:hover {
    background: var(--pt-glass-hover);
    border-color: var(--pt-accent);
  }
  #options-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: var(--pt-glass-bg);
    -webkit-backdrop-filter: blur(16px) saturate(150%);
    backdrop-filter: blur(16px) saturate(150%);
    border: 1px solid var(--pt-glass-border);
    border-radius: 10px;
    box-shadow: var(--pt-shadow-float);
    overflow: hidden;
    opacity: 0;
    transform: translateY(-4px);
    pointer-events: none;
    transition: opacity 0.12s ease, transform 0.12s ease;
    white-space: nowrap;
    min-width: 210px;
    z-index: 10;
  }
  #options-menu.open {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
  .options-menu-item {
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--pt-text);
    user-select: none;
    transition: background 0.1s ease;
  }
  .options-menu-item:hover {
    background: var(--pt-accent-soft);
  }
  .options-menu-item input {
    cursor: pointer;
    accent-color: var(--pt-accent);
  }
  .options-menu-item label {
    cursor: pointer;
  }
</style>
<div
    style="
        position: fixed;
        top: 10px;
        right: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
        z-index: 1000;
    "
>
    ${filterInfo ? renderFilterBadge(filterInfo) : ''}
    <div style="position: relative;">
        <div
            id="export-btn"
            style="
                border: 1px solid var(--pt-glass-border);
                border-radius: 9px;
                padding: 6px 10px;
                display: flex;
                align-items: center;
                gap: 6px;
                box-shadow: var(--pt-shadow-float);
                cursor: pointer;
                color: var(--pt-text);
                font-size: 12px;
                user-select: none;
            "
        >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="display:block;flex-shrink:0;">
                <path d="M6.5 1.5v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M4 5.5L6.5 8 9 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M1.5 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            ${Messages.webView.options.export}
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style="display:block;flex-shrink:0;opacity:0.6;">
                <path d="M1.5 2.5L4 5.5 6.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>

        <div id="export-menu">
            <div id="export-as-svg" class="export-menu-item">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="display:block;flex-shrink:0;">
                    <path d="M1.5 10.5C1.5 10.5 4 2.5 6.5 2.5C9 2.5 11.5 7.5 11.5 7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    <circle cx="1.5" cy="10.5" r="1.1" fill="currentColor"/>
                    <circle cx="6.5" cy="2.5" r="1.1" fill="currentColor"/>
                    <circle cx="11.5" cy="7.5" r="1.1" fill="currentColor"/>
                </svg>
                SVG
            </div>
            <div id="export-as-html" class="export-menu-item">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="display:block;flex-shrink:0;">
                    <path d="M5 3.5L2 6.5 5 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M8 3.5L11 6.5 8 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                HTML
            </div>
        </div>
    </div>

    <div style="position: relative;">
        <div
            id="options-btn"
            title="${Messages.webView.options.optionsMenu}"
            style="
                border: 1px solid var(--pt-glass-border);
                border-radius: 9px;
                padding: 6px 9px;
                display: flex;
                align-items: center;
                box-shadow: var(--pt-shadow-float);
                cursor: pointer;
                color: var(--pt-text);
            "
        >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="display:block;flex-shrink:0;">
                <path d="M2 4h10M2 7h10M2 10h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        </div>

        <div id="options-menu">
            <div class="options-menu-item">
                <input
                    type="checkbox"
                    id="show-paths-cb"
                    style="outline: none;"
                />
                <label for="show-paths-cb">${Messages.webView.options.showAllFilePaths}</label>
            </div>
            <div class="options-menu-item">
                <input
                    type="checkbox"
                    id="show-collapse-tools-cb"
                    checked
                    style="outline: none;"
                />
                <label for="show-collapse-tools-cb">${Messages.webView.options.showCollapseTools}</label>
            </div>
            ${dragEnabled ? renderDragToggleItem() : ''}
        </div>
    </div>
</div>`;
}

function renderDragToggleItem(): string {
    return `
            <div class="options-menu-item">
                <input
                    type="checkbox"
                    id="unlock-drag-cb"
                    style="outline: none;"
                />
                <label for="unlock-drag-cb">${Messages.webView.options.unlockClassDragging}</label>
            </div>`;
}
