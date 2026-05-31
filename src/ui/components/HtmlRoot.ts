export function renderRootStyles(): string {
    return `<style>
  :root {
      /* Structural - from VSCode */
      --pt-bg:       var(--vscode-editor-background,       #1e1e1e);
      --pt-panel-bg: var(--vscode-editorWidget-background, #252526);
      --pt-border:   var(--vscode-editorWidget-border,     #3c3c3c);
      --pt-text:     var(--vscode-editor-foreground,       #d4d4d4);

      /* Header */
      --pt-header-bg:          #4ec9b0;
      --pt-header-bg-top:      #5bd9bd;
      --pt-header-bg-bot:      #36a98f;
      --pt-abstract-header-bg: #f2f7d7;
      --pt-abstract-bg-top:    #f7f9e2;
      --pt-abstract-bg-bot:    #dfeaac;
      --pt-header-text:        #052b24;

      /* Brand accent — unifies selection, focus rings and primary actions
         across the auto-tree views and the Create board. */
      --pt-accent:          #4ec9b0;
      --pt-accent-2:        #36a98f;
      --pt-accent-contrast: #052b24;
      --pt-accent-soft:     rgba(78, 201, 176, 0.16);
      --pt-focus-ring:      rgba(78, 201, 176, 0.55);
      --pt-edge-target:     #e8c46a;
      --pt-invalid:         #d9645a;

      /* Elevation + shape */
      --pt-radius:    11px;
      --pt-radius-sm: 7px;
      --pt-shadow-box:   0 1px 2px rgba(0,0,0,0.45), 0 6px 18px rgba(0,0,0,0.28);
      --pt-shadow-hover: 0 2px 6px rgba(0,0,0,0.5), 0 14px 34px rgba(0,0,0,0.42);
      --pt-shadow-float: 0 10px 36px rgba(0,0,0,0.5);

      /* Glassy floating surfaces (toolbars, popovers, find bar) */
      --pt-glass-bg:     rgba(32, 33, 36, 0.78);
      --pt-glass-border: rgba(255, 255, 255, 0.10);
      --pt-glass-hover:  rgba(255, 255, 255, 0.08);

      /* File path section */
      --pt-filepath-bg:   #1a1a1a;
      --pt-filepath-text: #717171;

      /* Section labels */
      --pt-section-label: #606060;

      /* Semantic syntax colors — dark theme defaults */
      --pt-type:      #4ec9b0;
      --pt-string:    #ce9178;
      --pt-number:    #b5cea8;
      --pt-attribute: #9cdcfe;
      --pt-method:    #dccd79;
      --pt-override:  #c586c0;
      --pt-bool:      #569cd6;

      /* Edge colors */
      --pt-edge:    var(--vscode-editorWidget-border, #6a6a6a);
      --pt-edge-0:  #7a9fc2;
      --pt-edge-1:  #89b08a;
      --pt-edge-2:  #c2a97a;
      --pt-edge-3:  #a87ec2;
      --pt-edge-4:  #7ab8b5;
      --pt-edge-5:  #c28080;
      --pt-edge-6:  #d9a45e;
      --pt-edge-7:  #6dbd6d;
      --pt-edge-8:  #d8a6c8;
      --pt-edge-9:  #5dc1a8;
      --pt-edge-10: #c2b85d;
      --pt-edge-11: #c27a5d;
      --pt-edge-12: #9ac260;
      --pt-edge-13: #b85d8e;
      --pt-edge-14: #5db8c2;

      /* Hover underline on interactive nodes */
      --pt-hover-underline:        rgba(255,255,255,0.85);
      --pt-hover-underline-member: rgba(255,255,255,0.30);
  }

  /* Light theme overrides */
  body[data-vscode-theme-kind="vscode-light"],
  body[data-vscode-theme-kind="vscode-high-contrast-light"] {
      --pt-type:     #267f99;
      --pt-string:   #a31515;
      --pt-attribute:#0070c1;
      --pt-method:   #795e26;
      --pt-override: #af00db;
      --pt-bool:     var(--vscode-symbolIcon-booleanForeground, #0000ff);
      --pt-number:   #098658;

      --pt-edge-0:  #2b6797;
      --pt-edge-1:  #2e6b30;
      --pt-edge-2:  #7d5a00;
      --pt-edge-3:  #6b2f8f;
      --pt-edge-4:  #1d7a75;
      --pt-edge-5:  #8b2222;
      --pt-edge-6:  #a16400;
      --pt-edge-7:  #1f7a1f;
      --pt-edge-8:  #8e3d6e;
      --pt-edge-9:  #157a5d;
      --pt-edge-10: #6e6900;
      --pt-edge-11: #823b0f;
      --pt-edge-12: #4a7300;
      --pt-edge-13: #6e1e4e;
      --pt-edge-14: #146b78;

      --pt-hover-underline:        rgba(0,0,0,0.85);
      --pt-hover-underline-member: rgba(0,0,0,0.30);

      --pt-filepath-bg:   #e0e0e0;
      --pt-filepath-text: #5a5a5a;

      --pt-section-label: #909090;

      --pt-header-bg-top:   #62dcc1;
      --pt-header-bg-bot:   #2f9d83;
      --pt-accent-contrast: #042019;
      --pt-accent-soft:     rgba(54, 169, 143, 0.16);
      --pt-shadow-box:   0 1px 2px rgba(0,0,0,0.14), 0 6px 18px rgba(0,0,0,0.10);
      --pt-shadow-hover: 0 2px 6px rgba(0,0,0,0.18), 0 14px 34px rgba(0,0,0,0.16);
      --pt-shadow-float: 0 10px 36px rgba(0,0,0,0.20);
      --pt-glass-bg:     rgba(248, 248, 250, 0.82);
      --pt-glass-border: rgba(0, 0, 0, 0.09);
      --pt-glass-hover:  rgba(0, 0, 0, 0.06);
  }
</style>`;
}

export function HtmlRoot(body: string): string {
    return `<!DOCTYPE html>
<html>
<head>
${renderRootStyles()}
</head>
<body style="margin:0;overflow:hidden;">
${body}
</body>
</html>
`;
}
