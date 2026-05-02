export {};

// ── Types ─────────────────────────────────────────────────────────────────────
interface CBPort {
  refDes:  string;
  conId:   string;
  side:    'left' | 'right';
  offsetY: number;
  pins:    Array<{ pin: string; signal: string }>;
}

interface CBBoard {
  entityId: string;
  name:     string;
  brdPath:  string;
  x:        number;
  y:        number;
  width:    number;
  rotation: 0 | 90 | 180 | 270;
  ports:    CBPort[];
}

interface ConButLayout {
  boards: Array<{
    entityId: string;
    x: number; y: number;
    rotation: 0 | 90 | 180 | 270;
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
      loadBrd:             (p: string) => Promise<{ brdPath: string; brdContent: string; brdMtime: number; glbPath: string | null } | null>;
      setConId:            (brdPath: string, refDes: string, value: string) => Promise<{ ok: boolean; error?: string }>;
      showInModel:         (conId: string) => Promise<void>;
      showBoardInModel:    (entityId: string) => Promise<void>;
      openPinout:          (data: PinoutData) => Promise<void>;
      onConButInit:        (cb: (data: ConButInitData) => void) => void;
      updateConButLayout:  (layout: ConButLayout) => Promise<void>;
      openNote:  (conId: string) => Promise<{ ok: boolean; error?: string }>;
      readNote:  (conId: string) => Promise<{ content: string; dir: string } | null>;
      listNotes: () => Promise<string[]>;
    };
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const HEADER_H   = 28;
const PORT_H     = 22;
const PAD_BOTTOM = 8;
const PORT_R     = 5;
const PORT_HIT_R = 9;    // screen px
const LINE_HIT_PX = 7;   // screen px
const MIN_W      = 80;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas       = document.getElementById('canvas')           as HTMLCanvasElement;
const boardListEl  = document.getElementById('board-list')!;
const connListEl   = document.getElementById('connection-list')!;
const connCtxMenu  = document.getElementById('conn-ctx-menu')!;
const portCtxMenu  = document.getElementById('port-ctx-menu')!;
const boardCtxMenu = document.getElementById('board-ctx-menu')!;
const conidDialog  = document.getElementById('conid-dialog')!;
const conidLabel   = document.getElementById('conid-dialog-label')!;
const conidInput   = document.getElementById('conid-input')      as HTMLInputElement;
const conidOk      = document.getElementById('conid-ok')!;
const conidCancel  = document.getElementById('conid-cancel')!;
const renameDialog = document.getElementById('rename-dialog')!;
const renameInput  = document.getElementById('rename-input')     as HTMLInputElement;
const renameOk     = document.getElementById('rename-ok')!;
const renameCancel = document.getElementById('rename-cancel')!;

const ctx2d = canvas.getContext('2d')!;

// ── State ─────────────────────────────────────────────────────────────────────
let boards: CBBoard[] = [];
let vpX = 0, vpY = 0, vpScale = 1;
let selectedConId:  string | null = null;
let hoveredConId:   string | null = null;
let hoveredBoardId: string | null = null;

type DragState =
  | { type: 'board'; board: CBBoard; mx0: number; my0: number; bx0: number; by0: number }
  | { type: 'port';  board: CBBoard; port: CBPort; mx0: number; my0: number }
  | { type: 'pan';   mx0: number; my0: number; vx0: number; vy0: number }
  | null;

let drag: DragState = null;
let dragMoved = false;

let ctxConId: string | null = null;
let ctxPort:  { board: CBBoard; port: CBPort } | null = null;
let ctxBoard: CBBoard | null = null;

let noteFilenames: Set<string> = new Set();

function sanitizeConId(conId: string): string {
  return conId.replace(/[\\/:*?"<>|]/g, '_') || '_';
}
function hasNote(conId: string): boolean {
  return noteFilenames.has(sanitizeConId(conId));
}

// ── Canvas coordinate helper ───────────────────────────────────────────────────
function getCanvasXY(e: MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

// ── Layout helpers ─────────────────────────────────────────────────────────────
function boardHeight(b: CBBoard): number {
  return HEADER_H + Math.max(1, b.ports.length) * PORT_H + PAD_BOTTOM;
}

function calculateBoardWidth(name: string, ports: Array<{ refDes: string }>): number {
  const HPAD = 14;
  const DOT_GAP = PORT_R + 8;  // dot radius + gap
  ctx2d.font = `bold 12px sans-serif`;
  let w = ctx2d.measureText(name).width + HPAD * 2;
  ctx2d.font = `11px monospace`;
  for (const p of ports) {
    w = Math.max(w, ctx2d.measureText(p.refDes).width + DOT_GAP * 2 + 8);
  }
  return Math.max(MIN_W, Math.ceil(w) + 4);
}

// ── Rotation helpers ───────────────────────────────────────────────────────────
type Rot = 0 | 90 | 180 | 270;
const COS: Record<Rot, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<Rot, number> = { 0: 0, 90: 1, 180: 0,  270: -1 };

function portWorldPos(board: CBBoard, port: CBPort): { x: number; y: number } {
  const bw = board.width;
  const bh = boardHeight(board);
  const maxOY = bh - HEADER_H - PAD_BOTTOM;
  const oy = Math.max(0, Math.min(port.offsetY, maxOY));
  const lx = port.side === 'left' ? 0 : bw;
  const ly = HEADER_H + oy;
  const cos = COS[board.rotation], sin = SIN[board.rotation];
  const dx = lx - bw / 2, dy = ly - bh / 2;
  return {
    x: board.x + bw / 2 + dx * cos - dy * sin,
    y: board.y + bh / 2 + dx * sin + dy * cos,
  };
}

function worldToLocal(board: CBBoard, wx: number, wy: number): { lx: number; ly: number } {
  const bw = board.width, bh = boardHeight(board);
  const dx = wx - (board.x + bw / 2);
  const dy = wy - (board.y + bh / 2);
  const cos = COS[board.rotation], sin = SIN[board.rotation];
  // Inverse rotation: transpose of rotation matrix
  return { lx: dx * cos + dy * sin + bw / 2, ly: -dx * sin + dy * cos + bh / 2 };
}

// ── Coordinate conversion ─────────────────────────────────────────────────────
function s2w(cx: number, cy: number): { x: number; y: number } {
  return { x: (cx - vpX) / vpScale, y: (cy - vpY) / vpScale };
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
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  ctx2d.fillStyle = '#1e1e1e';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

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
    const pts   = ports.map(({ board, port }) => portWorldPos(board, port));
    const edges = mst(pts);
    const isSel = conId === selectedConId;
    const isHov = conId === hoveredConId;
    const color = isSel ? '#ffffff' : isHov ? '#ffee88' : conIdColor(conId);
    const lw    = (isSel || isHov ? 2.5 : 1.5) / vpScale;

    ctx2d.strokeStyle = color;
    ctx2d.lineWidth   = lw;
    ctx2d.beginPath();
    for (const [u, v] of edges) {
      ctx2d.moveTo(pts[u].x, pts[u].y);
      ctx2d.lineTo(pts[v].x, pts[v].y);
    }
    ctx2d.stroke();

    // Label at centroid
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const fs = 12 / vpScale;
    ctx2d.font         = `${fs}px monospace`;
    ctx2d.textAlign    = 'center';
    ctx2d.textBaseline = 'bottom';
    const tw = ctx2d.measureText(conId).width;
    ctx2d.fillStyle = 'rgba(30,30,30,0.78)';
    ctx2d.fillRect(cx - tw / 2 - 2 / vpScale, cy - fs - 3 / vpScale, tw + 4 / vpScale, fs + 2 / vpScale);
    ctx2d.fillStyle = color;
    ctx2d.fillText(conId, cx, cy - 2 / vpScale);
  }
}

function drawBoards() {
  for (const board of boards) {
    const bw  = board.width;
    const bh  = boardHeight(board);
    const cx  = board.x + bw / 2;
    const cy  = board.y + bh / 2;
    const hov = board.entityId === hoveredBoardId;

    ctx2d.save();
    ctx2d.translate(cx, cy);
    ctx2d.rotate(board.rotation * Math.PI / 180);
    ctx2d.translate(-bw / 2, -bh / 2);

    // Body
    ctx2d.fillStyle   = hov ? '#2c2c30' : '#252526';
    ctx2d.strokeStyle = hov ? '#888888' : '#555555';
    ctx2d.lineWidth   = (hov ? 1.5 : 1) / vpScale;
    ctx2d.beginPath(); ctx2d.rect(0, 0, bw, bh); ctx2d.fill(); ctx2d.stroke();

    // Header
    ctx2d.fillStyle = hov ? '#353538' : '#2d2d30';
    ctx2d.fillRect(0, 0, bw, HEADER_H);
    ctx2d.strokeStyle = '#444';
    ctx2d.lineWidth   = 1 / vpScale;
    ctx2d.beginPath();
    ctx2d.moveTo(0, HEADER_H); ctx2d.lineTo(bw, HEADER_H); ctx2d.stroke();

    // Board name (clipped to header)
    const fs = 12 / vpScale;
    ctx2d.save();
    ctx2d.beginPath(); ctx2d.rect(2 / vpScale, 0, bw - 4 / vpScale, HEADER_H); ctx2d.clip();
    ctx2d.font         = `bold ${fs}px sans-serif`;
    ctx2d.textAlign    = 'left';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillStyle    = '#cccccc';
    ctx2d.fillText(board.name, 7 / vpScale, HEADER_H / 2);
    ctx2d.restore();

    // Ports
    const pfs = 11 / vpScale;
    ctx2d.font         = `${pfs}px monospace`;
    ctx2d.textBaseline = 'middle';
    for (const port of board.ports) {
      const maxOY = bh - HEADER_H - PAD_BOTTOM;
      const oy    = Math.max(0, Math.min(port.offsetY, maxOY));
      const lx    = port.side === 'left' ? 0 : bw;
      const ly    = HEADER_H + oy;
      const hasCon = !!port.conId;

      // Dot
      ctx2d.beginPath(); ctx2d.arc(lx, ly, PORT_R / vpScale, 0, Math.PI * 2);
      ctx2d.fillStyle   = hasCon ? '#4ec9b0' : '#555555';
      ctx2d.fill();
      ctx2d.strokeStyle = hasCon ? '#6eddb0' : '#666666';
      ctx2d.lineWidth   = 1 / vpScale; ctx2d.stroke();

      // Label (clipped to board interior)
      const pad    = (PORT_R + 6) / vpScale;
      const labelX = port.side === 'left' ? lx + pad : lx - pad;
      ctx2d.save();
      ctx2d.beginPath(); ctx2d.rect(1 / vpScale, HEADER_H, bw - 2 / vpScale, bh - HEADER_H); ctx2d.clip();
      ctx2d.textAlign = port.side === 'left' ? 'left' : 'right';
      ctx2d.fillStyle = hasCon ? '#bbbbbb' : '#666666';
      ctx2d.fillText(port.refDes, labelX, ly);
      ctx2d.restore();
    }

    ctx2d.restore();
  }
}

// ── Hit testing ───────────────────────────────────────────────────────────────
type HitResult =
  | { type: 'port';       board: CBBoard; port: CBPort }
  | { type: 'connection'; conId: string }
  | { type: 'board';      board: CBBoard }
  | { type: 'none' };

function hitTest(cx: number, cy: number): HitResult {
  const w = s2w(cx, cy);

  // Ports first
  for (const board of [...boards].reverse()) {
    for (const port of board.ports) {
      const pp = portWorldPos(board, port);
      if (Math.hypot(w.x - pp.x, w.y - pp.y) < PORT_HIT_R / vpScale) {
        return { type: 'port', board, port };
      }
    }
  }

  // Board bodies (test in local space)
  for (const board of [...boards].reverse()) {
    const { lx, ly } = worldToLocal(board, w.x, w.y);
    if (lx >= 0 && lx <= board.width && ly >= 0 && ly <= boardHeight(board)) {
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
      if (pointSegDist(w.x, w.y, pts[u].x, pts[u].y, pts[v].x, pts[v].y) * vpScale < LINE_HIT_PX) {
        return { type: 'connection', conId };
      }
    }
  }

  return { type: 'none' };
}

// ── Mouse handlers ─────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (e) => {
  const [cx, cy] = getCanvasXY(e);

  // Middle mouse = pan
  if (e.button === 1) {
    e.preventDefault();
    drag = { type: 'pan', mx0: cx, my0: cy, vx0: vpX, vy0: vpY };
    dragMoved = false;
    return;
  }

  if (e.button !== 0) return;
  dragMoved = false;
  closeMenus();

  const hit = hitTest(cx, cy);

  if (e.ctrlKey && hit.type === 'port') {
    drag = { type: 'port', board: hit.board, port: hit.port, mx0: cx, my0: cy };
  } else if (hit.type === 'port' || hit.type === 'board') {
    const board = hit.board;
    drag = { type: 'board', board, mx0: cx, my0: cy, bx0: board.x, by0: board.y };
  } else {
    // Left click on empty — just deselect on mouseup (handled below)
    drag = { type: 'pan', mx0: cx, my0: cy, vx0: vpX, vy0: vpY };
  }
});

canvas.addEventListener('mousemove', (e) => {
  const [cx, cy] = getCanvasXY(e);

  if (!drag) {
    const hit       = hitTest(cx, cy);
    const newHovB   = hit.type === 'board' || hit.type === 'port' ? hit.board.entityId : null;
    const newHovC   = hit.type === 'connection' ? hit.conId : null;
    const newCursor = hit.type === 'port' ? (e.ctrlKey ? 'grab' : 'pointer')
                    : hit.type === 'board' ? 'move'
                    : hit.type === 'connection' ? 'pointer'
                    : 'default';
    canvas.style.cursor = newCursor;
    if (newHovB !== hoveredBoardId || newHovC !== hoveredConId) {
      hoveredBoardId = newHovB;
      hoveredConId   = newHovC;
      requestDraw();
    }
    return;
  }

  const dx = cx - drag.mx0, dy = cy - drag.my0;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;

  if (drag.type === 'board') {
    drag.board.x = drag.bx0 + dx / vpScale;
    drag.board.y = drag.by0 + dy / vpScale;
    requestDraw();
  } else if (drag.type === 'port') {
    const board = drag.board, port = drag.port;
    const bh    = boardHeight(board);
    const areaH = bh - HEADER_H - PAD_BOTTOM;
    // Convert current mouse pos to board local space
    const wPos  = s2w(cx, cy);
    const { lx, ly } = worldToLocal(board, wPos.x, wPos.y);
    port.side    = lx < board.width / 2 ? 'left' : 'right';
    port.offsetY = Math.max(PORT_H / 2, Math.min(areaH - PORT_H / 2, ly - HEADER_H));
    requestDraw();
  } else if (drag.type === 'pan') {
    vpX = drag.vx0 + dx;
    vpY = drag.vy0 + dy;
    requestDraw();
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (!drag) return;
  const wasDrag   = dragMoved;
  const savedDrag = drag;
  drag = null;
  canvas.style.cursor = 'default';

  if (wasDrag) {
    if (savedDrag.type === 'board' || savedDrag.type === 'port') notifyLayoutChanged();
    return;
  }

  // Click (no significant movement)
  if (e.button === 0) {
    const [cx, cy] = getCanvasXY(e);
    const hit = hitTest(cx, cy);
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
  hoveredBoardId = null; hoveredConId = null;
  if (drag?.type === 'pan') drag = null;
  requestDraw();
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  drag = null;
  const [cx, cy] = getCanvasXY(e);
  const hit = hitTest(cx, cy);
  if (hit.type === 'connection') {
    openConnMenu(e.clientX, e.clientY, hit.conId);
  } else if (hit.type === 'port') {
    openPortMenu(e.clientX, e.clientY, hit.board, hit.port);
  } else if (hit.type === 'board') {
    openBoardMenu(e.clientX, e.clientY, hit.board);
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [cx, cy] = getCanvasXY(e);
  const factor   = e.deltaY > 0 ? 0.9 : 1 / 0.9;
  const newScale = Math.max(0.1, Math.min(15, vpScale * factor));
  vpX     = cx - (cx - vpX) * newScale / vpScale;
  vpY     = cy - (cy - vpY) * newScale / vpScale;
  vpScale = newScale;
  requestDraw();
}, { passive: false });

// Prevent middle-click scroll
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

// ── Context menus ─────────────────────────────────────────────────────────────
function closeMenus() {
  connCtxMenu.classList.remove('open');
  portCtxMenu.classList.remove('open');
  boardCtxMenu.classList.remove('open');
}

function openConnMenu(x: number, y: number, conId: string) {
  ctxConId = conId;
  connCtxMenu.style.left = x + 'px'; connCtxMenu.style.top = y + 'px';
  connCtxMenu.classList.add('open');
}

function openPortMenu(x: number, y: number, board: CBBoard, port: CBPort) {
  ctxPort = { board, port };
  (document.getElementById('port-ctx-clear')!).style.display = port.conId ? '' : 'none';
  portCtxMenu.style.left = x + 'px'; portCtxMenu.style.top = y + 'px';
  portCtxMenu.classList.add('open');
}

function openBoardMenu(x: number, y: number, board: CBBoard) {
  ctxBoard = board;
  boardCtxMenu.style.left = x + 'px'; boardCtxMenu.style.top = y + 'px';
  boardCtxMenu.classList.add('open');
}

document.addEventListener('mousedown', (e) => {
  if (!(e.target as Element).closest('.ctx-menu')) closeMenus();
});

document.getElementById('conn-ctx-pinout')!.addEventListener('click', () => {
  closeMenus(); if (ctxConId) openPinout(ctxConId);
});
document.getElementById('conn-ctx-model')!.addEventListener('click', async () => {
  closeMenus(); if (ctxConId) await window.kondor.showInModel(ctxConId);
});
document.getElementById('conn-ctx-notes')!.addEventListener('click', async () => {
  closeMenus();
  if (!ctxConId) return;
  const res = await window.kondor.openNote(ctxConId);
  if (res.ok) {
    noteFilenames.add(sanitizeConId(ctxConId));
    renderConnectionList();
  } else {
    alert(res.error ?? 'Could not open note');
  }
});
document.getElementById('conn-ctx-rename')!.addEventListener('click', () => {
  closeMenus(); if (ctxConId) showRenameDialog(ctxConId);
});
document.getElementById('conn-ctx-delete')!.addEventListener('click', async () => {
  closeMenus(); if (ctxConId) await deleteConnection(ctxConId);
});

document.getElementById('port-ctx-set')!.addEventListener('click', () => {
  closeMenus(); if (ctxPort) showSetConIdDialog(ctxPort.board, ctxPort.port);
});
document.getElementById('port-ctx-clear')!.addEventListener('click', async () => {
  closeMenus(); if (ctxPort) await setPortConId(ctxPort.board, ctxPort.port, '');
});

document.getElementById('board-ctx-rotate')!.addEventListener('click', () => {
  closeMenus();
  if (!ctxBoard) return;
  ctxBoard.rotation = ((ctxBoard.rotation + 90) % 360) as 0 | 90 | 180 | 270;
  requestDraw();
  notifyLayoutChanged();
});
document.getElementById('board-ctx-model')!.addEventListener('click', async () => {
  closeMenus(); if (ctxBoard) await window.kondor.showBoardInModel(ctxBoard.entityId);
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
  conidInput.focus(); conidInput.select();

  const onOk = async () => {
    conidDialog.classList.remove('open');
    await setPortConId(board, port, conidInput.value.trim());
    cleanup();
  };
  const onCancel = () => { conidDialog.classList.remove('open'); cleanup(); };
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Enter') onOk(); if (ev.key === 'Escape') onCancel(); };

  conidOk.onclick = onOk; conidCancel.onclick = onCancel;
  conidInput.addEventListener('keydown', onKey);
  function cleanup() { conidInput.removeEventListener('keydown', onKey); }
}

function showRenameDialog(oldConId: string) {
  renameInput.value = oldConId;
  renameDialog.classList.add('open');
  renameInput.focus(); renameInput.select();

  const onOk = async () => {
    const newName = renameInput.value.trim();
    renameDialog.classList.remove('open');
    if (newName && newName !== oldConId) await renameConnection(oldConId, newName);
    cleanup();
  };
  const onCancel = () => { renameDialog.classList.remove('open'); cleanup(); };
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Enter') onOk(); if (ev.key === 'Escape') onCancel(); };

  renameOk.onclick = onOk; renameCancel.onclick = onCancel;
  renameInput.addEventListener('keydown', onKey);
  function cleanup() { renameInput.removeEventListener('keydown', onKey); }
}

// ── CONID operations ──────────────────────────────────────────────────────────
async function setPortConId(board: CBBoard, port: CBPort, value: string): Promise<void> {
  const res = await window.kondor.setConId(board.brdPath, port.refDes, value);
  if (!res.ok) { console.error('setConId failed:', res.error); return; }
  port.conId = value;
  requestDraw(); renderConnectionList(); notifyLayoutChanged();
}

async function renameConnection(oldConId: string, newConId: string): Promise<void> {
  for (const { board, port } of getConnections().get(oldConId) ?? []) {
    const res = await window.kondor.setConId(board.brdPath, port.refDes, newConId);
    if (res.ok) port.conId = newConId;
  }
  if (selectedConId === oldConId) selectedConId = newConId;
  requestDraw(); renderConnectionList(); notifyLayoutChanged();
}

async function deleteConnection(conId: string): Promise<void> {
  for (const { board, port } of getConnections().get(conId) ?? []) {
    const res = await window.kondor.setConId(board.brdPath, port.refDes, '');
    if (res.ok) port.conId = '';
  }
  if (selectedConId === conId) selectedConId = null;
  requestDraw(); renderConnectionList(); notifyLayoutChanged();
}

// ── PINOUT ────────────────────────────────────────────────────────────────────
function openPinout(conId: string) {
  const ports = getConnections().get(conId) ?? [];
  window.kondor.openPinout({
    conId,
    connectors: ports.map(({ board, port }) => ({
      boardName: board.name, connectorName: port.refDes, pins: port.pins,
    })),
  });
}

// ── Notes preview ─────────────────────────────────────────────────────────────
const noteModal     = document.getElementById('note-modal')!;
const noteModalTitle = document.getElementById('note-modal-title')!;
const noteModalBody  = document.getElementById('note-modal-body')!;
const noteModalEdit  = document.getElementById('note-modal-edit')!;
const noteModalClose = document.getElementById('note-modal-close')!;

let noteModalConId: string | null = null;

noteModalClose.addEventListener('click', () => noteModal.classList.remove('open'));
noteModal.addEventListener('mousedown', (e) => { if (e.target === noteModal) noteModal.classList.remove('open'); });
noteModalEdit.addEventListener('click', async () => {
  if (noteModalConId) await window.kondor.openNote(noteModalConId);
});

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function inlineMd(text: string, dir: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
      if (!/^(https?:|file:|\/)/i.test(src))
        src = `file:///${dir.replace(/\\/g, '/')}/${src}`;
      return `<img alt="${escHtml(alt)}" src="${src}">`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, (_m, c) => `<code>${escHtml(c)}</code>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function renderMarkdown(md: string, dir: string): string {
  const lines  = md.split('\n');
  const chunks: string[] = [];
  let inCode   = false;
  let codeLines: string[] = [];
  let paraLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  function flushPara() {
    if (!paraLines.length) return;
    chunks.push(`<p>${inlineMd(paraLines.join(' '), dir)}</p>`);
    paraLines = [];
  }
  function flushList() {
    if (!listItems.length) return;
    const tag = listOrdered ? 'ol' : 'ul';
    chunks.push(`<${tag}>${listItems.map(l => `<li>${inlineMd(l, dir)}</li>`).join('')}</${tag}>`);
    listItems = [];
  }

  for (const line of lines) {
    if (inCode) {
      if (line.startsWith('```')) {
        chunks.push(`<pre><code>${escHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = []; inCode = false;
      } else codeLines.push(line);
      continue;
    }
    if (line.startsWith('```')) { flushPara(); flushList(); inCode = true; continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (line.startsWith('---')) { flushPara(); flushList(); chunks.push('<hr>'); continue; }
    const hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) {
      flushPara(); flushList();
      const n = hm[1].length;
      chunks.push(`<h${n}>${inlineMd(hm[2], dir)}</h${n}>`);
      continue;
    }
    const ulm = line.match(/^\s*[-*]\s+(.*)/);
    if (ulm) { flushPara(); if (listItems.length && listOrdered) flushList(); listOrdered = false; listItems.push(ulm[1]); continue; }
    const olm = line.match(/^\s*\d+\.\s+(.*)/);
    if (olm) { flushPara(); if (listItems.length && !listOrdered) flushList(); listOrdered = true; listItems.push(olm[1]); continue; }
    flushList();
    paraLines.push(line);
  }
  flushPara(); flushList();
  return chunks.join('\n');
}

async function openNotePreview(conId: string): Promise<void> {
  const data = await window.kondor.readNote(conId);
  noteModalConId = conId;
  noteModalTitle.textContent = `Notes: ${conId}`;
  if (data) {
    noteModalBody.innerHTML = renderMarkdown(data.content, data.dir);
  } else {
    noteModalBody.innerHTML = '<p style="color:#555;font-style:italic">No notes yet. Use context menu → Notes… to create.</p>';
  }
  noteModal.classList.add('open');
}

// ── Left panel ────────────────────────────────────────────────────────────────
function renderBoardList() {
  boardListEl.innerHTML = '';
  if (!boards.length) {
    const e = document.createElement('div'); e.className = 'list-empty'; e.textContent = 'No boards';
    boardListEl.appendChild(e); return;
  }
  for (const board of boards) {
    const item = document.createElement('div');
    item.className = 'list-item'; item.textContent = board.name; item.title = board.brdPath;
    item.addEventListener('click', () => {
      const bh = boardHeight(board);
      vpX = canvas.width  / 2 - (board.x + board.width / 2) * vpScale;
      vpY = canvas.height / 2 - (board.y + bh / 2) * vpScale;
      requestDraw();
    });
    boardListEl.appendChild(item);
  }
}

function renderConnectionList() {
  connListEl.innerHTML = '';
  const conns = getConnections();
  if (!conns.size) {
    const e = document.createElement('div'); e.className = 'list-empty'; e.textContent = 'No connections';
    connListEl.appendChild(e); return;
  }
  for (const [conId, ports] of [...conns].sort(([a], [b]) => a.localeCompare(b))) {
    const item  = document.createElement('div');
    item.className     = 'list-item' + (conId === selectedConId ? ' selected' : '');
    item.dataset.conid = conId;

    const dot = document.createElement('span');
    dot.style.cssText  = `display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${conIdColor(conId)}`;

    const label = document.createElement('span');
    label.textContent  = `${conId} (${ports.length})`;
    label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

    item.append(dot, label);

    if (hasNote(conId)) {
      const noteBtn = document.createElement('button');
      noteBtn.className = 'note-icon'; noteBtn.title = 'Preview notes';
      noteBtn.textContent = '📄';
      noteBtn.addEventListener('click', (e) => {
        e.stopPropagation(); openNotePreview(conId);
      });
      item.appendChild(noteBtn);
    }

    item.addEventListener('click', () => {
      selectedConId = conId === selectedConId ? null : conId;
      renderConnectionList(); requestDraw();
    });
    connListEl.appendChild(item);
  }
}

// ── Layout persistence ────────────────────────────────────────────────────────
function getCurrentLayout(): ConButLayout {
  return {
    boards: boards.map(b => ({
      entityId: b.entityId, x: b.x, y: b.y, rotation: b.rotation,
      ports: b.ports.map(p => ({ refDes: p.refDes, side: p.side, offsetY: p.offsetY })),
    })),
  };
}

function applyLayout(layout: ConButLayout) {
  for (const entry of layout.boards) {
    const board = boards.find(b => b.entityId === entry.entityId);
    if (!board) continue;
    board.x = entry.x; board.y = entry.y;
    if (typeof entry.rotation === 'number') board.rotation = entry.rotation as Rot;
    for (const pl of entry.ports) {
      const port = board.ports.find(p => p.refDes === pl.refDes);
      if (port) { port.side = pl.side; port.offsetY = pl.offsetY; }
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
  refDes: string; conId: string; pins: Array<{ pin: string; signal: string }>;
}

function parseBrdForConBut(xmlContent: string): CBPortData[] {
  const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');

  // All pad/smd names per "library:package"
  const packagePins = new Map<string, string[]>();
  for (const lib of doc.querySelectorAll('libraries > library')) {
    const libName = lib.getAttribute('name') ?? '';
    for (const pkg of lib.querySelectorAll('packages > package')) {
      const pkgName = pkg.getAttribute('name') ?? '';
      const pins: string[] = [];
      for (const pad of pkg.querySelectorAll('pad, smd')) {
        const n = pad.getAttribute('name'); if (n) pins.push(n);
      }
      packagePins.set(`${libName}:${pkgName}`, pins);
    }
  }

  // Signal connections: refDes → pin → signal name
  const elementSigs = new Map<string, Map<string, string>>();
  for (const sig of doc.querySelectorAll('signal')) {
    const sigName = sig.getAttribute('name') ?? '';
    for (const cr of sig.querySelectorAll('contactref')) {
      const ref = cr.getAttribute('element') ?? '', pin = cr.getAttribute('pad') ?? '';
      if (!elementSigs.has(ref)) elementSigs.set(ref, new Map());
      elementSigs.get(ref)!.set(pin, sigName);
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
    if (conIdValue === null) continue;

    const refDes  = el.getAttribute('name')    ?? '';
    const libName = el.getAttribute('library') ?? '';
    const pkgName = el.getAttribute('package') ?? '';
    const sigs    = elementSigs.get(refDes) ?? new Map<string, string>();
    const allPins = packagePins.get(`${libName}:${pkgName}`);

    const pins: Array<{ pin: string; signal: string }> = allPins?.length
      ? allPins.map(p => ({ pin: p, signal: sigs.get(p) ?? '' }))
      : [...sigs.entries()].map(([pin, signal]) => ({ pin, signal })); // fallback

    result.push({ refDes, conId: conIdValue, pins });
  }
  return result;
}

// ── Initialisation ────────────────────────────────────────────────────────────
async function handleInit(data: ConButInitData): Promise<void> {
  boards = []; selectedConId = null;
  const GAP = 30;

  for (const info of data.boards) {
    const loaded = await window.kondor.loadBrd(info.brdPath);
    if (!loaded) continue;
    const portData = parseBrdForConBut(loaded.brdContent);
    const w = calculateBoardWidth(info.name, portData);
    boards.push({
      entityId: info.id, name: info.name, brdPath: info.brdPath,
      x: 0, y: 0, width: w, rotation: 0,
      ports: portData.map((p, i) => ({
        refDes: p.refDes, conId: p.conId, side: 'left' as const,
        offsetY: i * PORT_H + PORT_H / 2, pins: p.pins,
      })),
    });
  }

  // Default 2-column layout
  const maxW = boards.reduce((m, b) => Math.max(m, b.width), MIN_W);
  const COL1 = 50, COL2 = COL1 + maxW + GAP * 2;
  let y0 = 50, y1 = 50;
  for (const board of boards) {
    const bh = boardHeight(board);
    if (y0 <= y1) { board.x = COL1; board.y = y0; y0 += bh + GAP; }
    else          { board.x = COL2; board.y = y1; y1 += bh + GAP; }
  }

  if (data.layout) applyLayout(data.layout);

  noteFilenames = new Set(await window.kondor.listNotes());
  requestDraw(); renderBoardList(); renderConnectionList();
}

// ── Canvas resize ─────────────────────────────────────────────────────────────
function resizeCanvas() {
  const c = document.getElementById('canvas-container')!;
  canvas.width = c.clientWidth; canvas.height = c.clientHeight;
  requestDraw();
}
new ResizeObserver(resizeCanvas).observe(document.getElementById('canvas-container')!);
resizeCanvas();

// ── IPC ───────────────────────────────────────────────────────────────────────
window.kondor.onConButInit((data) => { handleInit(data); });
