export function FindBar(): string {
    return `
<div
    id="find-bar"
    style="
        display: none;
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--pt-glass-bg);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        backdrop-filter: blur(16px) saturate(150%);
        border: 1px solid var(--pt-glass-border);
        border-radius: 12px;
        padding: 7px 10px;
        align-items: center;
        gap: 6px;
        z-index: 1000;
        box-shadow: var(--pt-shadow-float);
    "
>
    <input
        id="find-input"
        type="text"
        placeholder="Find in tree…"
        autocomplete="off"
        spellcheck="false"
        style="
            background: var(--pt-bg);
            border: 1px solid var(--pt-glass-border);
            color: var(--pt-text);
            padding: 5px 9px;
            border-radius: 7px;
            outline: none;
            width: 200px;
            font-size: 13px;
            font-family: monospace;
        "
    />

    <button id="find-case" class="find-toggle" title="Match Case (Alt+C)" style="font-weight: bold; letter-spacing: -1px;">Aa</button>
    <button id="find-word" class="find-toggle" title="Match Whole Word (Alt+W)" style="text-decoration: underline; text-underline-offset: 3px;">ab</button>

    <span
        id="find-count"
        style="
            color: #888;
            font-size: 12px;
            min-width: 60px;
            text-align: center;
        "
    ></span>

    <button id="find-prev" title="Previous (Shift+Enter)">↑</button>
    <button id="find-next" title="Next (Enter)">↓</button>
    <button id="find-close" title="Close (Escape)">✕</button>
</div>`;
}
