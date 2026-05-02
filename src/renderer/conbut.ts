// ── Types ─────────────────────────────────────────────────────────────────────
interface CBPort {
  refDes:  string;
  conId:   string;          // "" = CONID attr present but no value
  side:    'left' | 'right';
  offsetY: number;          // Y within the board's port area (world px)
  pins:    Array<{ pin: string; signal: string }>;
}

interface CBBoard {
  entityId: string;
  name:     string;
  brdPath:  string;
  x:        number;   // world position
  y:        number;
  ports:    CBPort[];
}

interface ConButLayout {
  boards: Array<{
    entityId: string;
    x: number; y: number;
    ports: Array<{ refDes: string; side: 'left' | 'right'; offsetY: number }>;
  }>;
}

interface ConButInitData {
  boards: Array<{ id: string; name: string; brdPath: string }>;
  layout: ConButLayout | null;
}

interface PinoutData {
  conId: string;
  connectors: Array<{
    boardName:     string;
    connectorName: string;
    pins: Array<{ pin: string; signal: string }>;
  }>;
}

declare global {
  interface Window {
    kondor: {
      loadBrd:           (p: string) => Promise<{ brdPath: string; brdContent: string; brdMtime: number; glbPath: string | null } | null>;
      setConId:          (brdPath: string, refDes: string, value: string) => Promise<{ ok: boolean; error?: string }>;
      showInModel:       (conId: string) => Promise<void>;
      openPinout:        (data: PinoutData) => Promise<void>;
      onConButInit:      (cb: (data: ConButInitData) => void) => void;
      updateConButLayout:(layout: ConButLayout) => Promise<void>;
    };
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const BOARD_W       = 200;
const HEADER_H      = 28;
const PORT_H        = 22;
const PAD_BOTTOM    = 8;
const PORT_R        = 5;   // port dot radius (world px)
const PORT_HIT_R    = 9;   // port hit radius (screen px)
const LINE_HIT_PX   = 7;   // connection line hit threshold (screen px)

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas        = document.getElementById('canvas')          as HTMLCanvasElement;
const boardListEl   = document.getElementById('board-list')!;
const connListEl    = document.getElementById('connection-list')!;
const connCtxMenu   = document.getElementById('conn-ctx-menu')!;
const portCtxMenu   = document.getElementById('port-ctx-menu')!;
const conidDialog   = document.getElementById('conid-dialog')!;
const conidLabel    = document.getElementById('conid-dialog-label')!;
const conidInput    = document.getElementById('conid-input')     as HTMLInputElement;
const conidOk       = document.getElementById('conid-ok')!;
const conidCancel   = document.getElementById('conid-cancel')!;
const renameDialog  = document.getElementById('rename-dialog')!;
const renameInput   = document.getElementById('rename-input')    as HTMLInputElement;
const renameOk      = document.getElementById('rename-ok')!;
const renameCancel  = document.getElementById('rename-cancel')!;

const ctx2d = canvas.getContext('2d')!;

// ── State ─────────────────────────────────────────────────────────────────────
let boards: CBBoard[] = [];
let vpX = 0, vpY = 0, vpScale = 1;
let selectedConId: string | null = null;
let hoveredConId:  string | null = null;

type DragState =
  | { type: 'board'; board: CBBoard; mx0: number; my0: number; bx0: number; by0: number }
  | { type: 'port';  board: CBBoard; port: CBPort;  mx0: number; my0: number; oy0: number; side0: 'left'|'right' }
  | { type: 'pan';   mx0: number; my0: number; vx0: number; vy0: number }
  | null;

let drag: DragState = null;
let dragMoved = false;

let ctxConId: string | null = null;
let ctxPort:  { board: CBBoard; port: CBPort } | null = null;

// ── Layout helpers ─────────────────────────────────────────────────────────────
function boardHeight(b: CBBoard): number {
  return HEADER_H + Math.max(1, b.ports.length) * PORT_H + PAD_BOTTOM;
}

function portWorldPos(board: CBBoard, port: CBPort): { x: number; y: number } {
  const bh  = boardHeight(board);
  const maxY = bh - HEADER_H - PAD_BOTTOM;
  const py  = Math.max(0, Math.min(port.offsetY, maxY));
  return {
    x: port.side === 'left' ? board.x : board.x + BOARD_W,
    y: board.y + HEADER_H + py,
  };
}

// ── Coordinate conversion ─────────────────────────────────────────────────────
function s2w(sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - vpX) / vpScale, y: (sy - vpY) / vpScale };
}

// ── Connection helpers ─────────────────────────────────────────────────────────
function getConnections(): Map<string, Array<{ board: CBBoard; port: CBPort }>> {
  const map = new Map<string, Array<{ board: CBBoard; port: CBPort }>>();
  for (const b of boards) {
    for (const p of b.ports) {
      if (!p.conId) continue;
      if (!map.has(p.conId)) map.set(p.conId, []);
      map.get(p.conId)!.push({ board: b, port: p });
    }
  }
  return map;
}

// ── Color ─────────────────────────────────────────────────────────────────────
function conIdColor(conId: string): string {
  let h = 0;
  for (let i = 0; i < conId.length; i++) h = (h * 31 + conId.charCodeAt(i)) & 0xffffffff;
  return `hsl(${(h >>> 0) % 360}, 65%, 55%)`;
}

// ── MST (Prim's) ──────────────────────────────────────────────────────────────
function mst(pts: Array<{ x: number; y: number }>): Array<[number, number]> {
  const N = pts.length;
  if (N < 2) return [];
  const d2 = (a: number, b: number) => {
    const dx = pts[a].x - pts[b].x, dy = pts[a].y - pts[b].y;
    return dx * dx + dy * dy;
  };
  const inTree = new Set<number>([0]);
  const edges: Array<[number, number]> = [];
  while (inTree.size < N) {
    let best = Infinity, u = -1, v = -1;
    for (const i of inTree) {
      for (let j = 0; j < N; j++) {
        if (inTree.has(j)) continue;
        const d = d2(i, j);
        if (d < best) { best = d; u = i; v = j; }
      }
    }
    if (v < 0) break;
    inTree.add(v);
    edges.push([u, v]);
  }
  return edges;
}

// ── Geometry ──────────────────────────────────────────────────────────────────
function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// ── Draw ──────────────────────────────────────────────────────────────────────
let drawPending = false;
function requestDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => { drawPending = false; draw(); });
}

function draw() {
  const W = canvas.width, H = canvas.height;
  ctx2d.clearRect(0, 0, W, H);
  ctx2d.fillStyle = '#1e1e1e';
  ctx2d.fillRect(0, 0, W, H);

  ctx2d.save();
  ctx2d.translate(vpX, vpY);
  ctx2d.scale(vpScale, vpScale);

  drawConnections();
  drawBoards();

  ctx2d.restore();
}

function drawConnections() {
  const conns = getConnections();
  for (const [conId, ports] of conns) {
    if (ports.length < 2) continue;
    const pts    = ports.map(({ board, port }) => portWorldPos(board, port));
    const edges  = mst(pts);
    const isSel  = conId === selectedConId;
    const isHov  = conId === hoveredConId;
    const color  = isSel ? '#ffffff' : isHov ? '#ffee88' : conIdColor(conId);
    const lw     = (isSel || isHov ? 2.5 : 1.5) / vpScale;

    ctx2d.strokeStyle = color;
    ctx2d.lineWidth   = lw;
    ctx2d.setLineDash([]);
    ctx2d.beginPath();
    for (const [u, v] of edges) {
      ctx2d.moveTo(pts[u].x, pts[u].y);
      ctx2d.lineTo(pts[v].x, pts[v].y);
    }
    ctx2d.stroke();

    // Label at centroid
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const fs = Math.max(10, 12) / vpScale;
    ctx2d.font         = `${fs}px monospace`;
    ctx2d.textAlign    = 'center';
    ctx2d.textBaseline = 'bottom';
    ctx2d.fillStyle    = color;
    // Label background
    const tw = ctx2d.measureText(conId).width;
    ctx2d.fillStyle = 'rgba(30,30,30,0.75)';
    ctx2d.fillRect(cx - tw / 2 - 2 / vpScale, cy - fs - 3 / vpScale, tw + 4 / vpScale, fs + 2 / vpScale);
    ctx2d.fillStyle = color;
    ctx2d.fillText(conId, cx, cy - 2 / vpScale);
  }
}

function drawBoards() {
  for (const board of boards) {
    const bh = boardHeight(board);

    // Body
    ctx2d.fillStyle   = '#252526';
    ctx2d.strokeStyle = '#555555';
    ctx2d.lineWidth   = 1 / vpScale;
    ctx2d.beginPath();
    ctx2d.rect(board.x, board.y, BOARD_W, bh);
    ctx2d.fill();
    ctx2d.stroke();

    // Header
    ctx2d.fillStyle = '#2d2d30';
    ctx2d.fillRect(board.x, board.y, BOARD_W, HEADER_H);
    // Header bottom border
    ctx2d.strokeStyle = '#444';
    ctx2d.beginPath();
    ctx2d.moveTo(board.x,           board.y + HEADER_H);
    ctx2d.lineTo(board.x + BOARD_W, board.y + HEADER_H);
    ctx2d.stroke();

    // Board name
    const fs = 12 / vpScale;
    ctx2d.font         = `bold ${fs}px sans-serif`;
    ctx2d.textAlign    = 'left';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillStyle    = '#cccccc';
    ctx2d.save();
    ctx2d.rect(board.x + 2 / vpScale, board.y, BOARD_W - 4 / vpScale, HEADER_H);
    ctx2d.clip();
    ctx2d.fillText(board.name, board.x + 7 / vpScale, board.y + HEADER_H / 2);
    ctx2d.restore();

    // Ports
    const pfs = 11 / vpScale;
    ctx2d.font = `${pfs}px monospace`;
    for (const port of board.ports) {
      const pp     = portWorldPos(board, port);
      const hasCon = !!port.conId;

      // Dot
      ctx2d.beginPath();
      ctx2d.arc(pp.x, pp.y, PORT_R / vpScale, 0, Math.PI * 2);
      ctx2d.fillStyle   = hasCon ? '#4ec9b0' : '#555555';
      ctx2d.fill();
      ctx2d.strokeStyle = hasCon ? '#6eddb0' : '#666666';
      ctx2d.lineWidth   = 1 / vpScale;
      ctx2d.stroke();

      // Label
      const pad     = 8 / vpScale;
      const labelX  = port.side === 'left' ? pp.x + pad : pp.x - pad;
      ctx2d.textAlign    = port.side === 'left' ? 'left' : 'right';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillStyle    = hasCon ? '#bbbbbb' : '#666666';

      // Clip to board interior
      ctx2d.save();
      ctx2d.rect(board.x + 1 / vpScale, board.y + HEADER_H, BOARD_W - 2 / vpScale, bh - HEADER_H);
      ctx2d.clip();
      ctx2d.fillText(port.refDes, labelX, pp.y);
      ctx2d.restore();
    }
  }
}

// ── Hit testing ───────────────────────────────────────────────────────────────
type HitResult =
  | { type: 'port';       board: CBBoard; port: CBPort }
  | { type: 'connection'; conId: string }
  | { type: 'board';      board: CBBoard }
  | { type: 'none' };

function hitTest(sx: number, sy: number): HitResult {
  const w = s2w(sx, sy);

  // Ports first (highest priority)
  for (const board of [...boards].reverse()) {
    for (const port of board.ports) {
      const pp = portWorldPos(board, port);
      const dx = w.x - pp.x, dy = w.y - pp.y;
      if (Math.hypot(dx, dy) < PORT_HIT_R / vpScale) {
        return { type: 'port', board, port };
      }
    }
  }

  // Board bodies
  for (const board of [...boards].reverse()) {
    const bh = boardHeight(board);
    if (w.x >= board.x && w.x <= board.x + BOARD_W && w.y >= board.y && w.y <= board.y + bh) {
      return { type: 'board', board };
    }
  }

  // Connection lines
  const conns = getConnections();
  for (const [conId, ports] of conns) {
    if (ports.length < 2) continue;
    const pts   = ports.map(({ board, port }) => portWorldPos(board, port));
    const edges = mst(pts);
    for (const [u, v] of edges) {
      const d = pointSegDist(w.x, w.y, pts[u].x, pts[u].y, pts[v].x, pts[v].y);
      if (d * vpScale < LINE_HIT_PX) return { type: 'connection', conId };
    }
  }

  return { type: 'none' };
}

// ── Mouse handlers ─────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragMoved = false;
  closeMenus();

  const hit = hitTest(e.clientX, e.clientY);

  if (e.ctrlKey && hit.type === 'port') {
    drag = { type: 'port', board: hit.board, port: hit.port,
             mx0: e.clientX, my0: e.clientY,
             oy0: hit.port.offsetY, side0: hit.port.side };
  } else if (hit.type === 'port' || hit.type === 'board') {
    const board = hit.type === 'port' ? hit.board : hit.board;
    drag = { type: 'board', board, mx0: e.clientX, my0: e.clientY,
             bx0: board.x, by0: board.y };
  } else {
    drag = { type: 'pan', mx0: e.clientX, my0: e.clientY, vx0: vpX, vy0: vpY };
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!drag) {
    const hit       = hitTest(e.clientX, e.clientY);
    const newHov    = hit.type === 'connection' ? hit.conId : null;
    const newCursor = hit.type === 'port'       ? (e.ctrlKey ? 'grab' : 'pointer')
                    : hit.type === 'board'       ? 'move'
                    : hit.type === 'connection'  ? 'pointer'
                    : 'default';
    canvas.style.cursor = newCursor;
    if (newHov !== hoveredConId) { hoveredConId = newHov; requestDraw(); }
    return;
  }

  const dx = e.clientX - drag.mx0;
  const dy = e.clientY - drag.my0;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;

  if (drag.type === 'board') {
    drag.board.x = drag.bx0 + dx / vpScale;
    drag.board.y = drag.by0 + dy / vpScale;
    requestDraw();
  } else if (drag.type === 'port') {
    const board = drag.board;
    const port  = drag.port;
    const bh    = boardHeight(board);
    const areaH = bh - HEADER_H - PAD_BOTTOM;
    const wx    = (e.clientX - vpX) / vpScale;
    const wy    = (e.clientY - vpY) / vpScale;
    port.side    = wx < board.x + BOARD_W / 2 ? 'left' : 'right';
    port.offsetY = Math.max(PORT_H / 2, Math.min(areaH - PORT_H / 2, wy - board.y - HEADER_H));
    requestDraw();
  } else if (drag.type === 'pan') {
    vpX = drag.vx0 + dx;
    vpY = drag.vy0 + dy;
    requestDraw();
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (!drag) return;
  const wasDrag = dragMoved;
  const savedDrag = drag;
  drag = null;

  if (wasDrag) {
    if (savedDrag.type === 'board' || savedDrag.type === 'port') notifyLayoutChanged();
    return;
  }

  // Click (no drag)
  if (e.button === 0) {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit.type === 'connection') {
      selectedConId = selectedConId === hit.conId ? null : hit.conId;
    } else if (hit.type === 'none') {
      selectedConId = null;
    }
    requestDraw();
    renderConnectionList();
  }
});

canvas.addEventListener('mouseleave', () => {
  if (drag?.type === 'pan') { drag = null; }
  hoveredConId = null;
  requestDraw();
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor   = e.deltaY > 0 ? 0.9 : 1 / 0.9;
  const newScale = Math.max(0.1, Math.min(15, vpScale * factor));
  vpX      = e.clientX - (e.clientX - vpX) * newScale / vpScale;
  vpY      = e.clientY - (e.clientY - vpY) * newScale / vpScale;
  vpScale  = newScale;
  requestDraw();
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  drag = null;
  const hit = hitTest(e.clientX, e.clientY);
  if (hit.type === 'connection') {
    openConnMenu(e.clientX, e.clientY, hit.conId);
  } else if (hit.type === 'port') {
    openPortMenu(e.clientX, e.clientY, hit.board, hit.port);
  }
});

// ── Context menus ─────────────────────────────────────────────────────────────
function closeMenus() {
  connCtxMenu.classList.remove('open');
  portCtxMenu.classList.remove('open');
}

function openConnMenu(x: number, y: number, conId: string) {
  ctxConId = conId;
  connCtxMenu.style.left = x + 'px';
  connCtxMenu.style.top  = y + 'px';
  connCtxMenu.classList.add('open');
}

function openPortMenu(x: number, y: number, board: CBBoard, port: CBPort) {
  ctxPort = { board, port };
  const clearItem = document.getElementById('port-ctx-clear')!;
  clearItem.style.display = port.conId ? '' : 'none';
  portCtxMenu.style.left = x + 'px';
  portCtxMenu.style.top  = y + 'px';
  portCtxMenu.classList.add('open');
}

document.addEventListener('mousedown', (e) => {
  if (!(e.target as Element).closest('.ctx-menu')) closeMenus();
});

document.getElementById('conn-ctx-pinout')!.addEventListener('click', () => {
  closeMenus();
  if (ctxConId) openPinout(ctxConId);
});

document.getElementById('conn-ctx-model')!.addEventListener('click', async () => {
  closeMenus();
  if (ctxConId) await window.kondor.showInModel(ctxConId);
});

document.getElementById('conn-ctx-rename')!.addEventListener('click', () => {
  closeMenus();
  if (ctxConId) showRenameDialog(ctxConId);
});

document.getElementById('conn-ctx-delete')!.addEventListener('click', async () => {
  closeMenus();
  if (ctxConId) await deleteConnection(ctxConId);
});

document.getElementById('port-ctx-set')!.addEventListener('click', () => {
  closeMenus();
  if (ctxPort) showSetConIdDialog(ctxPort.board, ctxPort.port);
});

document.getElementById('port-ctx-clear')!.addEventListener('click', async () => {
  closeMenus();
  if (ctxPort) await setPortConId(ctxPort.board, ctxPort.port, '');
});

// Connection list right-click
connListEl.addEventListener('contextmenu', (e) => {
  const item = (e.target as Element).closest('[data-conid]') as HTMLElement | null;
  if (!item) return;
  e.preventDefault();
  openConnMenu(e.clientX, e.clientY, item.dataset.conid!);
});

// ── Dialogs ────────────────────────────────────────────────────────────────────
function showSetConIdDialog(board: CBBoard, port: CBPort) {
  conidLabel.textContent = `CONID for ${port.refDes} on ${board.name}:`;
  conidInput.value = port.conId;
  conidDialog.classList.add('open');
  conidInput.focus();
  conidInput.select();

  const onOk = async () => {
    conidDialog.classList.remove('open');
    await setPortConId(board, port, conidInput.value.trim());
    cleanup();
  };
  const onCancel = () => { conidDialog.classList.remove('open'); cleanup(); };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') onOk();
    if (ev.key === 'Escape') onCancel();
  };

  conidOk.onclick     = onOk;
  conidCancel.onclick = onCancel;
  conidInput.addEventListener('keydown', onKey);
  function cleanup() { conidInput.removeEventListener('keydown', onKey); }
}

function showRenameDialog(oldConId: string) {
  renameInput.value = oldConId;
  renameDialog.classList.add('open');
  renameInput.focus();
  renameInput.select();

  const onOk = async () => {
    const newName = renameInput.value.trim();
    renameDialog.classList.remove('open');
    if (newName && newName !== oldConId) await renameConnection(oldConId, newName);
    cleanup();
  };
  const onCancel = () => { renameDialog.classList.remove('open'); cleanup(); };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') onOk();
    if (ev.key === 'Escape') onCancel();
  };

  renameOk.onclick     = onOk;
  renameCancel.onclick = onCancel;
  renameInput.addEventListener('keydown', onKey);
  function cleanup() { renameInput.removeEventListener('keydown', onKey); }
}

// ── CONID operations ──────────────────────────────────────────────────────────
async function setPortConId(board: CBBoard, port: CBPort, value: string): Promise<void> {
  const res = await window.kondor.setConId(board.brdPath, port.refDes, value);
  if (!res.ok) { console.error('setConId failed:', res.error); return; }
  port.conId = value;
  requestDraw();
  renderConnectionList();
  notifyLayoutChanged();
}

async function renameConnection(oldConId: string, newConId: string): Promise<void> {
  const conns = getConnections();
  const ports = conns.get(oldConId) ?? [];
  for (const { board, port } of ports) {
    const res = await window.kondor.setConId(board.brdPath, port.refDes, newConId);
    if (res.ok) port.conId = newConId;
  }
  if (selectedConId === oldConId) selectedConId = newConId;
  requestDraw();
  renderConnectionList();
  notifyLayoutChanged();
}

async function deleteConnection(conId: string): Promise<void> {
  const conns = getConnections();
  const ports = conns.get(conId) ?? [];
  for (const { board, port } of ports) {
    const res = await window.kondor.setConId(board.brdPath, port.refDes, '');
    if (res.ok) port.conId = '';
  }
  if (selectedConId === conId) selectedConId = null;
  requestDraw();
  renderConnectionList();
  notifyLayoutChanged();
}

// ── PINOUT ────────────────────────────────────────────────────────────────────
function openPinout(conId: string) {
  const conns = getConnections();
  const ports = conns.get(conId) ?? [];
  const data: PinoutData = {
    conId,
    connectors: ports.map(({ board, port }) => ({
      boardName:     board.name,
      connectorName: port.refDes,
      pins:          port.pins,
    })),
  };
  window.kondor.openPinout(data);
}

// ── Left panel ────────────────────────────────────────────────────────────────
function renderBoardList() {
  boardListEl.innerHTML = '';
  if (boards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = 'No boards';
    boardListEl.appendChild(empty);
    return;
  }
  for (const board of boards) {
    const item  = document.createElement('div');
    item.className   = 'list-item';
    item.textContent = board.name;
    item.title       = board.brdPath;
    item.addEventListener('click', () => {
      const bh = boardHeight(board);
      const cx = board.x + BOARD_W / 2;
      const cy = board.y + bh / 2;
      vpX = canvas.width  / 2 - cx * vpScale;
      vpY = canvas.height / 2 - cy * vpScale;
      requestDraw();
    });
    boardListEl.appendChild(item);
  }
}

function renderConnectionList() {
  connListEl.innerHTML = '';
  const conns = getConnections();

  if (conns.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = 'No connections';
    connListEl.appendChild(empty);
    return;
  }

  for (const [conId, ports] of [...conns].sort(([a], [b]) => a.localeCompare(b))) {
    const item = document.createElement('div');
    item.className       = 'list-item' + (conId === selectedConId ? ' selected' : '');
    item.dataset.conid   = conId;

    const dot    = document.createElement('span');
    dot.style.cssText    = `display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${conIdColor(conId)}`;

    const label  = document.createElement('span');
    label.textContent    = `${conId} (${ports.length})`;
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.whiteSpace   = 'nowrap';

    item.append(dot, label);

    item.addEventListener('click', () => {
      selectedConId = conId === selectedConId ? null : conId;
      renderConnectionList();
      requestDraw();
    });
    connListEl.appendChild(item);
  }
}

// ── Layout persistence ────────────────────────────────────────────────────────
function getCurrentLayout(): ConButLayout {
  return {
    boards: boards.map(b => ({
      entityId: b.entityId,
      x: b.x, y: b.y,
      ports: b.ports.map(p => ({ refDes: p.refDes, side: p.side, offsetY: p.offsetY })),
    })),
  };
}

function applyLayout(layout: ConButLayout) {
  for (const entry of layout.boards) {
    const board = boards.find(b => b.entityId === entry.entityId);
    if (!board) continue;
    board.x = entry.x;
    board.y = entry.y;
    for (const pl of entry.ports) {
      const port = board.ports.find(p => p.refDes === pl.refDes);
      if (!port) continue;
      port.side    = pl.side;
      port.offsetY = pl.offsetY;
    }
  }
}

let layoutTimer: ReturnType<typeof setTimeout> | null = null;
function notifyLayoutChanged() {
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    window.kondor.updateConButLayout(getCurrentLayout());
    layoutTimer = null;
  }, 500);
}

// ── BRD parsing ───────────────────────────────────────────────────────────────
interface CBPortData {
  refDes: string;
  conId:  string;
  pins:   Array<{ pin: string; signal: string }>;
}

function parseBrdForConBut(xmlContent: string): CBPortData[] {
  const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');

  const elementPins = new Map<string, Array<{ pin: string; signal: string }>>();
  for (const sig of doc.querySelectorAll('signal')) {
    const sigName = sig.getAttribute('name') ?? '';
    for (const cr of sig.querySelectorAll('contactref')) {
      const ref = cr.getAttribute('element') ?? '';
      const pin = cr.getAttribute('pad')     ?? '';
      if (!elementPins.has(ref)) elementPins.set(ref, []);
      elementPins.get(ref)!.push({ pin, signal: sigName });
    }
  }

  const result: CBPortData[] = [];
  for (const el of doc.querySelectorAll('element')) {
    let conIdValue: string | null = null;

    const direct = el.getAttribute('CONID') ?? el.getAttribute('conid');
    if (direct !== null) {
      conIdValue = direct;
    } else {
      const child = [...el.querySelectorAll('attribute')].find(
        a => (a.getAttribute('name') ?? '').toUpperCase() === 'CONID'
      );
      if (child !== undefined) conIdValue = child.getAttribute('value') ?? '';
    }

    if (conIdValue === null) continue; // attribute not present at all

    const refDes = el.getAttribute('name') ?? '';
    result.push({ refDes, conId: conIdValue, pins: elementPins.get(refDes) ?? [] });
  }

  return result;
}

// ── Initialisation ────────────────────────────────────────────────────────────
async function handleInit(data: ConButInitData): Promise<void> {
  boards = [];
  selectedConId = null;

  const GAP  = 30;
  const COL1 = 50;
  const COL2 = COL1 + BOARD_W + GAP * 2;
  let y0 = 50, y1 = 50;

  for (const info of data.boards) {
    const loaded = await window.kondor.loadBrd(info.brdPath);
    if (!loaded) continue;

    const portData = parseBrdForConBut(loaded.brdContent);
    const bh = HEADER_H + Math.max(1, portData.length) * PORT_H + PAD_BOTTOM;

    const [x, y] = y0 <= y1 ? [COL1, y0] : [COL2, y1];
    if (y0 <= y1) y0 += bh + GAP; else y1 += bh + GAP;

    boards.push({
      entityId: info.id,
      name:     info.name,
      brdPath:  info.brdPath,
      x, y,
      ports: portData.map((p, i) => ({
        refDes:  p.refDes,
        conId:   p.conId,
        side:    'left' as const,
        offsetY: i * PORT_H + PORT_H / 2,
        pins:    p.pins,
      })),
    });
  }

  if (data.layout) applyLayout(data.layout);

  requestDraw();
  renderBoardList();
  renderConnectionList();
}

// Canvas resize
function resizeCanvas() {
  const c = document.getElementById('canvas-container')!;
  canvas.width  = c.clientWidth;
  canvas.height = c.clientHeight;
  requestDraw();
}
new ResizeObserver(resizeCanvas).observe(document.getElementById('canvas-container')!);
resizeCanvas();

// IPC
window.kondor.onConButInit((data) => { handleInit(data); });
