// @ts-check

/** @type {typeof acquireVsCodeApi} */
const vscode = acquireVsCodeApi();

const treeRoot = document.getElementById('tree-root');
const errorOverlay = document.getElementById('error-overlay');
const errorMessage = document.getElementById('error-message');
const emptyState = document.getElementById('empty-state');
const fileNameEl = document.getElementById('file-name');
const btnExpandAll = document.getElementById('btn-expand-all');
const btnCollapseAll = document.getElementById('btn-collapse-all');
const btnToggleMode = document.getElementById('btn-toggle-mode');

let viewMode = 'wpf'; // 'tree' or 'wpf'

// Toolbar actions
btnExpandAll.addEventListener('click', () => toggleAll(true));
btnCollapseAll.addEventListener('click', () => toggleAll(false));
btnToggleMode.addEventListener('click', () => {
  viewMode = viewMode === 'tree' ? 'wpf' : 'tree';
  btnToggleMode.textContent = viewMode === 'wpf' ? 'Tree' : 'WPF';
  // Re-render with current state
  const state = vscode.getState();
  if (state && state.xml) {
    renderXml(state.xml, state.fileName);
  }
});

function toggleAll(expand) {
  const nodes = treeRoot.querySelectorAll('.tree-node.has-children');
  nodes.forEach((node) => node.classList.toggle('collapsed', !expand));
  // WPF mode expand/collapse
  const wpfNodes = treeRoot.querySelectorAll('.wpf-container');
  wpfNodes.forEach((node) => node.classList.toggle('wpf-collapsed', !expand));
}

// Listen for messages from the extension
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'update') {
    vscode.setState({ xml: message.xml, fileName: message.fileName });
    renderXml(message.xml, message.fileName);
  }
});

// Restore state on reload
const previousState = vscode.getState();
if (previousState && previousState.xml) {
  renderXml(previousState.xml, previousState.fileName);
}

/**
 * Parse and render XML.
 * @param {string} xmlString
 * @param {string} fileName
 */
function renderXml(xmlString, fileName) {
  fileNameEl.textContent = fileName || 'XML Preview';

  if (!xmlString.trim()) {
    treeRoot.innerHTML = '';
    emptyState.classList.remove('hidden');
    errorOverlay.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    errorOverlay.classList.remove('hidden');
    errorMessage.textContent = parseError.textContent.split('\n')[0] || 'Invalid XML';
    return;
  }

  errorOverlay.classList.add('hidden');
  treeRoot.innerHTML = '';

  if (doc.documentElement) {
    if (viewMode === 'wpf') {
      const wpf = buildWpfNode(doc.documentElement);
      treeRoot.appendChild(wpf);
    } else {
      const tree = buildTreeNode(doc.documentElement, 0);
      treeRoot.appendChild(tree);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  WPF VISUAL RENDERER
// ═══════════════════════════════════════════════════════════

/** @type {Record<string, (el: Element) => HTMLElement>} */
const WPF_RENDERERS = {
  // ── Window ──
  Window: (el) => {
    const win = div('wpf-window');
    const titleBar = div('wpf-window-titlebar');
    const titleText = span('wpf-window-title', attr(el, 'Title') || attr(el, 'Name') || 'Window');
    const btns = div('wpf-window-btns');
    btns.innerHTML = '<span class="wpf-btn-min">&#x2500;</span><span class="wpf-btn-max">&#x25A1;</span><span class="wpf-btn-close">&#x2715;</span>';
    titleBar.appendChild(titleText);
    titleBar.appendChild(btns);
    win.appendChild(titleBar);
    const body = div('wpf-window-body');
    appendChildren(body, el);
    win.appendChild(body);
    const size = [];
    if (attr(el, 'Width')) size.push(`W: ${attr(el, 'Width')}`);
    if (attr(el, 'Height')) size.push(`H: ${attr(el, 'Height')}`);
    if (size.length) {
      const sizeLabel = div('wpf-size-label');
      sizeLabel.textContent = size.join(' x ');
      win.appendChild(sizeLabel);
    }
    return win;
  },

  // ── Layout panels ──
  Grid: (el) => {
    const grid = div('wpf-grid');
    const label = div('wpf-control-label');
    label.textContent = 'Grid';
    if (attr(el, 'Rows')) label.textContent += ` [${attr(el, 'Rows')}R x ${attr(el, 'Columns') || '1'}C]`;
    grid.appendChild(label);
    appendChildren(grid, el);
    return grid;
  },

  StackPanel: (el) => {
    const panel = div('wpf-stackpanel');
    const orient = attr(el, 'Orientation') || 'Vertical';
    if (orient.toLowerCase() === 'horizontal') panel.classList.add('wpf-horizontal');
    const label = div('wpf-control-label');
    label.textContent = `StackPanel (${orient})`;
    panel.appendChild(label);
    appendChildren(panel, el);
    return panel;
  },

  DockPanel: (el) => {
    const panel = div('wpf-dockpanel');
    const label = div('wpf-control-label');
    label.textContent = 'DockPanel';
    panel.appendChild(label);
    appendChildren(panel, el);
    return panel;
  },

  WrapPanel: (el) => {
    const panel = div('wpf-wrappanel');
    const label = div('wpf-control-label');
    label.textContent = 'WrapPanel';
    panel.appendChild(label);
    appendChildren(panel, el);
    return panel;
  },

  Canvas: (el) => {
    const canvas = div('wpf-canvas');
    const label = div('wpf-control-label');
    label.textContent = 'Canvas';
    canvas.appendChild(label);
    if (attr(el, 'Width')) canvas.style.width = attr(el, 'Width') + 'px';
    if (attr(el, 'Height')) canvas.style.height = attr(el, 'Height') + 'px';
    for (const child of el.children) {
      const rendered = buildWpfNode(child);
      rendered.style.position = 'absolute';
      if (attr(child, 'Canvas.Left')) rendered.style.left = attr(child, 'Canvas.Left') + 'px';
      if (attr(child, 'Canvas.Top')) rendered.style.top = attr(child, 'Canvas.Top') + 'px';
      if (attr(child, 'Canvas.Right')) rendered.style.right = attr(child, 'Canvas.Right') + 'px';
      if (attr(child, 'Canvas.Bottom')) rendered.style.bottom = attr(child, 'Canvas.Bottom') + 'px';
      canvas.appendChild(rendered);
    }
    return canvas;
  },

  UniformGrid: (el) => {
    const grid = div('wpf-uniformgrid');
    const cols = parseInt(attr(el, 'Columns') || '0', 10);
    const rows = parseInt(attr(el, 'Rows') || '0', 10);
    const count = el.children.length;
    const c = cols || Math.ceil(Math.sqrt(count)) || 1;
    const r = rows || Math.ceil(count / c);
    grid.style.gridTemplateColumns = `repeat(${c}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${r}, auto)`;
    const label = div('wpf-control-label');
    label.textContent = `UniformGrid [${r}R x ${c}C]`;
    grid.appendChild(label);
    appendChildren(grid, el);
    return grid;
  },

  Viewbox: (el) => {
    const vb = div('wpf-viewbox');
    const label = div('wpf-control-label');
    label.textContent = `Viewbox (${attr(el, 'Stretch') || 'Uniform'})`;
    vb.appendChild(label);
    appendChildren(vb, el);
    return vb;
  },

  ScrollViewer: (el) => {
    const sv = div('wpf-scrollviewer');
    if (attr(el, 'Height')) sv.style.height = attr(el, 'Height') + 'px';
    if (attr(el, 'Width')) sv.style.width = attr(el, 'Width') + 'px';
    appendChildren(sv, el);
    return sv;
  },

  // ── Controls ──
  Button: (el) => {
    const btn = document.createElement('button');
    btn.className = 'wpf-button';
    btn.textContent = attr(el, 'Content') || getDirectText(el) || 'Button';
    if (attr(el, 'Style') === 'Primary') btn.classList.add('wpf-primary');
    if (attr(el, 'Width')) btn.style.width = attr(el, 'Width') + 'px';
    if (attr(el, 'IsEnabled') === 'false') btn.classList.add('wpf-disabled');
    return btn;
  },

  TextBlock: (el) => {
    const tb = div('wpf-textblock');
    tb.textContent = attr(el, 'Text') || getDirectText(el) || '';
    if (attr(el, 'FontSize')) tb.style.fontSize = attr(el, 'FontSize') + 'px';
    if (attr(el, 'FontWeight') === 'Bold') tb.style.fontWeight = 'bold';
    if (attr(el, 'Foreground')) tb.style.color = attr(el, 'Foreground');
    return tb;
  },

  Label: (el) => {
    const lb = div('wpf-label');
    lb.textContent = attr(el, 'Content') || getDirectText(el) || '';
    return lb;
  },

  TextBox: (el) => {
    const input = document.createElement('input');
    input.className = 'wpf-textbox';
    input.type = 'text';
    input.placeholder = attr(el, 'Placeholder') || attr(el, 'Text') || '';
    if (attr(el, 'Width')) input.style.width = attr(el, 'Width') + 'px';
    if (attr(el, 'IsReadOnly') === 'True') input.readOnly = true;
    return input;
  },

  PasswordBox: (el) => {
    const input = document.createElement('input');
    input.className = 'wpf-textbox';
    input.type = 'password';
    input.placeholder = attr(el, 'Placeholder') || 'Password';
    if (attr(el, 'Width')) input.style.width = attr(el, 'Width') + 'px';
    return input;
  },

  RichTextBox: (el) => {
    const ta = document.createElement('textarea');
    ta.className = 'wpf-richtextbox';
    ta.placeholder = attr(el, 'Placeholder') || '';
    ta.value = getDirectText(el);
    if (attr(el, 'Width')) ta.style.width = attr(el, 'Width') + 'px';
    if (attr(el, 'Height')) ta.style.height = attr(el, 'Height') + 'px';
    if (attr(el, 'IsReadOnly') === 'True') ta.readOnly = true;
    return ta;
  },

  DatePicker: (el) => {
    const input = document.createElement('input');
    input.className = 'wpf-datepicker';
    input.type = 'date';
    if (attr(el, 'SelectedDate')) input.value = attr(el, 'SelectedDate').slice(0, 10);
    if (attr(el, 'Width')) input.style.width = attr(el, 'Width') + 'px';
    return input;
  },

  Calendar: (el) => {
    const cal = div('wpf-calendar');
    const header = div('wpf-calendar-header');
    const now = new Date();
    header.textContent = now.toLocaleString('default', { month: 'long', year: 'numeric' });
    cal.appendChild(header);
    const days = div('wpf-calendar-grid');
    ['S','M','T','W','T','F','S'].forEach((d) => {
      const c = span('wpf-calendar-dow', d);
      days.appendChild(c);
    });
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const firstDow = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
    for (let i = 0; i < firstDow; i++) days.appendChild(div('wpf-calendar-day wpf-empty'));
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = div('wpf-calendar-day');
      cell.textContent = String(d);
      if (d === now.getDate()) cell.classList.add('wpf-today');
      days.appendChild(cell);
    }
    cal.appendChild(days);
    return cal;
  },

  ToggleButton: (el) => {
    const btn = document.createElement('button');
    btn.className = 'wpf-button wpf-togglebutton';
    btn.textContent = attr(el, 'Content') || getDirectText(el) || 'Toggle';
    if (attr(el, 'IsChecked') === 'True') btn.classList.add('wpf-toggle-on');
    if (attr(el, 'Width')) btn.style.width = attr(el, 'Width') + 'px';
    return btn;
  },

  RepeatButton: (el) => {
    const btn = document.createElement('button');
    btn.className = 'wpf-button wpf-repeatbutton';
    btn.textContent = attr(el, 'Content') || getDirectText(el) || 'Repeat';
    if (attr(el, 'Width')) btn.style.width = attr(el, 'Width') + 'px';
    return btn;
  },

  Hyperlink: (el) => {
    const a = document.createElement('a');
    a.className = 'wpf-hyperlink';
    a.textContent = attr(el, 'Content') || getDirectText(el) || attr(el, 'NavigateUri') || 'link';
    a.href = attr(el, 'NavigateUri') || '#';
    a.rel = 'noopener noreferrer';
    return a;
  },

  CheckBox: (el) => {
    const wrap = div('wpf-checkbox-wrap');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'wpf-checkbox';
    if (attr(el, 'IsChecked') === 'True') cb.checked = true;
    const lbl = span('wpf-checkbox-label', attr(el, 'Content') || getDirectText(el) || '');
    wrap.appendChild(cb);
    wrap.appendChild(lbl);
    return wrap;
  },

  RadioButton: (el) => {
    const wrap = div('wpf-radio-wrap');
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.className = 'wpf-radio';
    rb.name = attr(el, 'GroupName') || 'default';
    if (attr(el, 'IsChecked') === 'True') rb.checked = true;
    const lbl = span('wpf-radio-label', attr(el, 'Content') || getDirectText(el) || '');
    wrap.appendChild(rb);
    wrap.appendChild(lbl);
    return wrap;
  },

  ComboBox: (el) => {
    const sel = document.createElement('select');
    sel.className = 'wpf-combobox';
    for (const child of el.children) {
      const opt = document.createElement('option');
      opt.textContent = attr(child, 'Content') || getDirectText(child) || child.tagName;
      sel.appendChild(opt);
    }
    if (sel.options.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = attr(el, 'SelectedItem') || 'Select...';
      sel.appendChild(opt);
    }
    if (attr(el, 'Width')) sel.style.width = attr(el, 'Width') + 'px';
    return sel;
  },

  ListBox: (el) => {
    const list = div('wpf-listbox');
    for (const child of el.children) {
      const item = div('wpf-listbox-item');
      item.textContent = attr(child, 'Content') || getDirectText(child) || child.tagName;
      list.appendChild(item);
    }
    return list;
  },

  Slider: (el) => {
    const input = document.createElement('input');
    input.className = 'wpf-slider';
    input.type = 'range';
    input.min = attr(el, 'Minimum') || '0';
    input.max = attr(el, 'Maximum') || '100';
    input.value = attr(el, 'Value') || '50';
    return input;
  },

  ProgressBar: (el) => {
    const wrap = div('wpf-progressbar');
    const fill = div('wpf-progressbar-fill');
    const val = parseInt(attr(el, 'Value') || '50', 10);
    const max = parseInt(attr(el, 'Maximum') || '100', 10);
    fill.style.width = Math.round((val / max) * 100) + '%';
    wrap.appendChild(fill);
    return wrap;
  },

  Image: (el) => {
    const img = div('wpf-image-placeholder');
    img.textContent = `[Image: ${attr(el, 'Source') || 'no source'}]`;
    if (attr(el, 'Width')) img.style.width = attr(el, 'Width') + 'px';
    if (attr(el, 'Height')) img.style.height = attr(el, 'Height') + 'px';
    return img;
  },

  Separator: (el) => {
    const sep = document.createElement('hr');
    sep.className = 'wpf-separator';
    return sep;
  },

  // ── Menu ──
  Menu: (el) => {
    const menu = div('wpf-menu');
    for (const child of el.children) {
      const item = div('wpf-menu-item');
      item.textContent = attr(child, 'Label') || attr(child, 'Header') || getDirectText(child) || child.tagName;
      if (attr(child, 'IsDefault') === 'true') item.classList.add('wpf-menu-active');
      menu.appendChild(item);
    }
    return menu;
  },

  MenuItem: (el) => {
    const item = div('wpf-menu-item');
    item.textContent = attr(el, 'Label') || attr(el, 'Header') || getDirectText(el) || 'Item';
    return item;
  },

  // ── TabControl ──
  TabControl: (el) => {
    const tabs = div('wpf-tabcontrol');
    const tabBar = div('wpf-tab-bar');
    let first = true;
    for (const child of el.children) {
      const tab = div('wpf-tab');
      tab.textContent = attr(child, 'Header') || attr(child, 'Name') || child.tagName;
      if (first || attr(child, 'IsSelected') === 'True') { tab.classList.add('wpf-tab-active'); first = false; }
      tabBar.appendChild(tab);
    }
    tabs.appendChild(tabBar);
    // Render first tab content
    if (el.children.length > 0) {
      const content = div('wpf-tab-content');
      appendChildren(content, el.children[0]);
      tabs.appendChild(content);
    }
    return tabs;
  },

  // ── GroupBox ──
  GroupBox: (el) => {
    const gb = div('wpf-groupbox');
    const header = div('wpf-groupbox-header');
    header.textContent = attr(el, 'Header') || attr(el, 'Name') || 'Group';
    gb.appendChild(header);
    const body = div('wpf-groupbox-body');
    appendChildren(body, el);
    gb.appendChild(body);
    return gb;
  },

  // ── Expander ──
  Expander: (el) => {
    const exp = div('wpf-expander');
    const header = div('wpf-expander-header');
    header.textContent = (attr(el, 'IsExpanded') !== 'False' ? '\u25BC ' : '\u25B6 ') + (attr(el, 'Header') || 'Expander');
    exp.appendChild(header);
    if (attr(el, 'IsExpanded') !== 'False') {
      const body = div('wpf-expander-body');
      appendChildren(body, el);
      exp.appendChild(body);
    }
    return exp;
  },

  // ── StatusBar ──
  StatusBar: (el) => {
    const bar = div('wpf-statusbar');
    for (const child of el.children) {
      const item = span('wpf-statusbar-item', attr(child, 'Text') || getDirectText(child) || '');
      if (attr(child, 'Align') === 'Right') item.classList.add('wpf-right');
      bar.appendChild(item);
    }
    return bar;
  },

  // ── Border ──
  Border: (el) => {
    const border = div('wpf-border');
    if (attr(el, 'BorderBrush')) border.style.borderColor = attr(el, 'BorderBrush');
    if (attr(el, 'BorderThickness')) border.style.borderWidth = attr(el, 'BorderThickness') + 'px';
    if (attr(el, 'CornerRadius')) border.style.borderRadius = attr(el, 'CornerRadius') + 'px';
    if (attr(el, 'Background')) border.style.background = attr(el, 'Background');
    if (attr(el, 'Padding')) border.style.padding = attr(el, 'Padding') + 'px';
    appendChildren(border, el);
    return border;
  },

  // ── TreeView ──
  TreeView: (el) => {
    const tv = div('wpf-treeview');
    appendChildren(tv, el);
    return tv;
  },

  TreeViewItem: (el) => {
    const wrap = div('wpf-treeviewitem');
    const header = div('wpf-treeviewitem-header');
    const expanded = attr(el, 'IsExpanded') !== 'False';
    header.textContent = (el.children.length > 0 ? (expanded ? '\u25BC ' : '\u25B6 ') : '\u2022 ')
      + (attr(el, 'Header') || getDirectText(el) || 'Item');
    wrap.appendChild(header);
    if (expanded && el.children.length > 0) {
      const children = div('wpf-treeviewitem-children');
      appendChildren(children, el);
      wrap.appendChild(children);
    }
    return wrap;
  },

  // ── ListView + GridView ──
  ListView: (el) => {
    const lv = div('wpf-listview');
    const gridView = el.querySelector('GridView, ListView\\.View > GridView');
    const cols = gridView ? gridView.querySelectorAll('GridViewColumn') : null;
    if (cols && cols.length > 0) {
      const headerRow = div('wpf-listview-header');
      cols.forEach((c) => {
        const cell = span('wpf-listview-cell', attr(c, 'Header') || attr(c, 'DisplayMemberBinding') || '');
        if (attr(c, 'Width')) cell.style.flex = `0 0 ${attr(c, 'Width')}px`;
        headerRow.appendChild(cell);
      });
      lv.appendChild(headerRow);
      const items = Array.from(el.children).filter((c) => c.tagName !== 'GridView' && c.tagName !== 'ListView.View');
      items.forEach((item) => {
        const row = div('wpf-listview-row');
        cols.forEach(() => row.appendChild(span('wpf-listview-cell', attr(item, 'Content') || getDirectText(item) || '...')));
        lv.appendChild(row);
      });
    } else {
      for (const child of el.children) {
        if (child.tagName === 'GridView' || child.tagName === 'ListView.View') continue;
        const item = div('wpf-listbox-item');
        item.textContent = attr(child, 'Content') || getDirectText(child) || child.tagName;
        lv.appendChild(item);
      }
    }
    return lv;
  },

  // ── Generic containers ──
  ItemsControl: (el) => {
    const c = div('wpf-itemscontrol');
    const label = div('wpf-control-label');
    label.textContent = 'ItemsControl';
    c.appendChild(label);
    appendChildren(c, el);
    return c;
  },

  ContentControl: (el) => {
    const c = div('wpf-contentcontrol');
    appendChildren(c, el);
    return c;
  },

  UserControl: (el) => {
    const c = div('wpf-usercontrol');
    const label = div('wpf-control-label');
    label.textContent = 'UserControl' + (attr(el, 'x:Class') ? ` (${attr(el, 'x:Class')})` : '');
    c.appendChild(label);
    appendChildren(c, el);
    return c;
  },

  Frame: (el) => {
    const c = div('wpf-frame');
    const label = div('wpf-control-label');
    label.textContent = 'Frame' + (attr(el, 'Source') ? ` → ${attr(el, 'Source')}` : '');
    c.appendChild(label);
    appendChildren(c, el);
    return c;
  },

  Page: (el) => {
    const c = div('wpf-page');
    const label = div('wpf-control-label');
    label.textContent = 'Page' + (attr(el, 'Title') ? ` "${attr(el, 'Title')}"` : '');
    c.appendChild(label);
    appendChildren(c, el);
    return c;
  },

  // ── Shapes (SVG) ──
  Rectangle: (el) => makeShape('rect', el),
  Ellipse: (el) => makeShape('ellipse', el),
  Line: (el) => makeShape('line', el),
  Polygon: (el) => makeShape('polygon', el),
  Polyline: (el) => makeShape('polyline', el),
  Path: (el) => makeShape('path', el),

  // ── ToolBar ──
  ToolBarTray: (el) => {
    const tray = div('wpf-toolbartray');
    appendChildren(tray, el);
    return tray;
  },

  ToolBar: (el) => {
    const bar = div('wpf-toolbar');
    appendChildren(bar, el);
    return bar;
  },

  // ── Popup / ToolTip / ContextMenu ──
  Popup: (el) => {
    const p = div('wpf-popup');
    const label = div('wpf-control-label');
    label.textContent = 'Popup' + (attr(el, 'IsOpen') === 'True' ? ' (open)' : '');
    p.appendChild(label);
    appendChildren(p, el);
    return p;
  },

  ToolTip: (el) => {
    const t = div('wpf-tooltip');
    t.textContent = attr(el, 'Content') || getDirectText(el) || 'Tooltip';
    return t;
  },

  ContextMenu: (el) => {
    const m = div('wpf-contextmenu');
    for (const child of el.children) {
      const item = div('wpf-menu-item');
      item.textContent = attr(child, 'Header') || attr(child, 'Label') || getDirectText(child) || child.tagName;
      m.appendChild(item);
    }
    return m;
  },

  // ── DataGrid (simple table) ──
  DataGrid: (el) => {
    const wrap = div('wpf-datagrid');
    const label = div('wpf-control-label');
    label.textContent = 'DataGrid';
    wrap.appendChild(label);
    // Render columns as a header row
    const cols = el.querySelectorAll('DataGridTextColumn, DataGridColumn, Column');
    if (cols.length > 0) {
      const headerRow = div('wpf-datagrid-header');
      cols.forEach((col) => {
        const cell = span('wpf-datagrid-cell', attr(col, 'Header') || attr(col, 'Binding') || '');
        headerRow.appendChild(cell);
      });
      wrap.appendChild(headerRow);
      // Placeholder rows
      for (let i = 0; i < 3; i++) {
        const row = div('wpf-datagrid-row');
        cols.forEach(() => {
          const cell = span('wpf-datagrid-cell', '...');
          row.appendChild(cell);
        });
        wrap.appendChild(row);
      }
    }
    return wrap;
  },
};

/**
 * Build a WPF visual node from an XML element.
 * @param {Element} xmlNode
 * @returns {HTMLElement}
 */
function buildWpfNode(xmlNode) {
  const localName = xmlNode.localName || xmlNode.tagName;
  // Strip namespace prefix
  const tag = localName.includes(':') ? localName.split(':')[1] : localName;

  const renderer = WPF_RENDERERS[tag];
  if (renderer) {
    const rendered = renderer(xmlNode);
    applyMargin(rendered, xmlNode);
    return rendered;
  }

  // Generic container for unrecognized tags
  const container = div('wpf-container');
  const label = div('wpf-control-label');
  label.textContent = tag;
  // Show key attributes
  const keyAttrs = ['Name', 'x:Name', 'Title', 'Content', 'Text', 'Header'];
  for (const a of keyAttrs) {
    if (attr(xmlNode, a)) {
      label.textContent += ` "${attr(xmlNode, a)}"`;
      break;
    }
  }
  container.appendChild(label);
  appendChildren(container, xmlNode);
  applyMargin(container, xmlNode);
  return container;
}

// ═══════════════════════════════════════════════════════════
//  TREE MODE RENDERER (original)
// ═══════════════════════════════════════════════════════════

function buildTreeNode(xmlNode, depth) {
  const container = document.createElement('div');
  container.className = 'tree-node';
  container.style.setProperty('--depth', String(depth));

  const header = document.createElement('div');
  header.className = 'node-header';

  const hasElementChildren = Array.from(xmlNode.children).length > 0;
  const textContent = getDirectText(xmlNode);

  if (hasElementChildren) {
    container.classList.add('has-children');
    const arrow = document.createElement('span');
    arrow.className = 'toggle-arrow';
    arrow.textContent = '\u25BC';
    header.appendChild(arrow);
    header.addEventListener('click', () => container.classList.toggle('collapsed'));
    header.style.cursor = 'pointer';
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'toggle-spacer';
    header.appendChild(spacer);
  }

  const tagName = document.createElement('span');
  tagName.className = 'tag-name';
  tagName.textContent = xmlNode.tagName;
  header.appendChild(tagName);

  if (xmlNode.attributes.length > 0) {
    for (const a of xmlNode.attributes) {
      const attrSpan = document.createElement('span');
      attrSpan.className = 'attribute';
      attrSpan.innerHTML = `<span class="attr-name">${esc(a.name)}</span><span class="attr-eq">=</span><span class="attr-value">"${esc(a.value)}"</span>`;
      header.appendChild(attrSpan);
    }
  }

  if (!hasElementChildren && textContent) {
    const text = document.createElement('span');
    text.className = 'text-content';
    text.textContent = textContent;
    header.appendChild(text);
  }

  container.appendChild(header);

  if (hasElementChildren && textContent) {
    const mixedText = document.createElement('div');
    mixedText.className = 'mixed-text';
    mixedText.textContent = textContent;
    container.appendChild(mixedText);
  }

  if (hasElementChildren) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'node-children';
    for (const child of xmlNode.children) {
      childrenContainer.appendChild(buildTreeNode(child, depth + 1));
    }
    container.appendChild(childrenContainer);
  }

  return container;
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function div(cls) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text || '';
  return s;
}

function attr(el, name) {
  return el.getAttribute(name) || '';
}

function getDirectText(node) {
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
  }
  return text.trim();
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function appendChildren(parent, xmlEl) {
  for (const child of xmlEl.children) {
    parent.appendChild(buildWpfNode(child));
  }
}

function makeShape(kind, el) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const w = parseFloat(attr(el, 'Width')) || 60;
  const h = parseFloat(attr(el, 'Height')) || 40;
  const fill = attr(el, 'Fill') || 'transparent';
  const stroke = attr(el, 'Stroke') || '#888';
  const strokeW = attr(el, 'StrokeThickness') || '1';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'wpf-shape');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  let shape;
  if (kind === 'rect') {
    shape = document.createElementNS(SVG_NS, 'rect');
    shape.setAttribute('x', '0');
    shape.setAttribute('y', '0');
    shape.setAttribute('width', String(w));
    shape.setAttribute('height', String(h));
    if (attr(el, 'RadiusX')) shape.setAttribute('rx', attr(el, 'RadiusX'));
    if (attr(el, 'RadiusY')) shape.setAttribute('ry', attr(el, 'RadiusY'));
  } else if (kind === 'ellipse') {
    shape = document.createElementNS(SVG_NS, 'ellipse');
    shape.setAttribute('cx', String(w / 2));
    shape.setAttribute('cy', String(h / 2));
    shape.setAttribute('rx', String(w / 2));
    shape.setAttribute('ry', String(h / 2));
  } else if (kind === 'line') {
    shape = document.createElementNS(SVG_NS, 'line');
    shape.setAttribute('x1', attr(el, 'X1') || '0');
    shape.setAttribute('y1', attr(el, 'Y1') || '0');
    shape.setAttribute('x2', attr(el, 'X2') || String(w));
    shape.setAttribute('y2', attr(el, 'Y2') || String(h));
  } else if (kind === 'polygon' || kind === 'polyline') {
    shape = document.createElementNS(SVG_NS, kind);
    shape.setAttribute('points', attr(el, 'Points') || `0,0 ${w},0 ${w / 2},${h}`);
  } else if (kind === 'path') {
    shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('d', attr(el, 'Data') || `M0 0 L${w} ${h}`);
  }

  shape.setAttribute('fill', kind === 'line' || kind === 'polyline' ? 'none' : fill);
  shape.setAttribute('stroke', stroke);
  shape.setAttribute('stroke-width', strokeW);
  svg.appendChild(shape);
  return /** @type {any} */ (svg);
}

function applyMargin(el, xmlNode) {
  const m = attr(xmlNode, 'Margin');
  if (m) {
    const parts = m.split(',').map((s) => s.trim() + 'px');
    if (parts.length === 4) el.style.margin = `${parts[1]} ${parts[2]} ${parts[3]} ${parts[0]}`;
    else if (parts.length === 1) el.style.margin = parts[0];
  }
}
