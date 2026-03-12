import * as vscode from 'vscode';
import * as path from 'path';

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  // ── Sidebar WebviewViewProvider ──
  const sidebarProvider = new XmlSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'xmlLivePreview.sidebarView',
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // ── Command: open panel beside editor ──
  const openCmd = vscode.commands.registerCommand('xmlLivePreview.open', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open an XML file first.');
      return;
    }
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.Beside);
      sendXmlToPanel(editor.document);
      return;
    }
    currentPanel = vscode.window.createWebviewPanel(
      'xmlLivePreview',
      `Preview: ${path.basename(editor.document.fileName)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );
    currentPanel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'preview-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'preview-dark.svg'),
    };
    currentPanel.webview.html = getWebviewHtml(context.extensionUri, currentPanel.webview);
    sendXmlToPanel(editor.document);
    currentPanel.onDidDispose(() => { currentPanel = undefined; }, null, context.subscriptions);
  });

  // ── Command: focus sidebar ──
  const focusCmd = vscode.commands.registerCommand('xmlLivePreview.focusSidebar', () => {
    vscode.commands.executeCommand('xmlLivePreview.sidebarView.focus');
  });

  // ── Debounced text change ──
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || e.document !== activeEditor.document) return;
    if (e.document.languageId !== 'xml') return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      sendXmlToPanel(e.document);
      sidebarProvider.updateXml(e.document);
    }, 300);
  });

  // ── Editor switch ──
  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor || editor.document.languageId !== 'xml') return;
    if (currentPanel) {
      currentPanel.title = `Preview: ${path.basename(editor.document.fileName)}`;
    }
    sendXmlToPanel(editor.document);
    sidebarProvider.updateXml(editor.document);
  });

  context.subscriptions.push(openCmd, focusCmd, changeListener, editorChangeListener);

  // ── Send initial content if an XML editor is already open ──
  if (vscode.window.activeTextEditor?.document.languageId === 'xml') {
    setTimeout(() => sidebarProvider.updateXml(vscode.window.activeTextEditor!.document), 500);
  }
}

// ────────────────────────────────────────────────────────────
// Sidebar Webview View Provider
// ────────────────────────────────────────────────────────────
class XmlSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _pendingXml?: { type: string; xml: string; fileName: string };

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
    };

    webviewView.webview.html = getWebviewHtml(this._extensionUri, webviewView.webview);

    // If we have pending XML that arrived before the view was ready
    if (this._pendingXml) {
      webviewView.webview.postMessage(this._pendingXml);
      this._pendingXml = undefined;
    }

    // Send current editor content when sidebar becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === 'xml') {
          this.updateXml(editor.document);
        }
      }
    });
  }

  updateXml(document: vscode.TextDocument) {
    const msg = {
      type: 'update',
      xml: document.getText(),
      fileName: path.basename(document.fileName),
    };
    if (this._view?.visible) {
      this._view.webview.postMessage(msg);
    } else {
      this._pendingXml = msg;
    }
  }
}

// ────────────────────────────────────────────────────────────
// Send XML to the side panel
// ────────────────────────────────────────────────────────────
function sendXmlToPanel(document: vscode.TextDocument) {
  if (!currentPanel) return;
  currentPanel.webview.postMessage({
    type: 'update',
    xml: document.getText(),
    fileName: path.basename(document.fileName),
  });
}

// ────────────────────────────────────────────────────────────
// HTML shared by both panel and sidebar webviews
// ────────────────────────────────────────────────────────────
function getWebviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview_script.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview_style.css'));
  const nonce = getNonce();

  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>XML Live Preview</title>
</head>
<body>
  <div id="toolbar">
    <span id="file-name"></span>
    <div id="toolbar-actions">
      <button id="btn-expand-all" title="Expand all">&#x25BC;</button>
      <button id="btn-collapse-all" title="Collapse all">&#x25B6;</button>
      <button id="btn-toggle-mode" title="Toggle tree / WPF view">WPF</button>
    </div>
  </div>
  <div id="preview-container">
    <div id="tree-root"></div>
  </div>
  <div id="error-overlay" class="hidden">
    <div id="error-icon">&#x26A0;</div>
    <div id="error-message"></div>
  </div>
  <div id="empty-state">
    <div class="empty-icon">&#x1F4C4;</div>
    <p>Open an XML file to see the live preview.</p>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function deactivate() {
  currentPanel?.dispose();
}
