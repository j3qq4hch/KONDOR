import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

declare global {
  interface Window {
    kondor: {
      openFile:       () => Promise<string | null>;
      openBrd:        () => Promise<{ brdPath: string; brdContent: string; brdMtime: number; glbPath: string | null } | null>;
      loadBrd:        (p: string) => Promise<{ brdPath: string; brdContent: string; brdMtime: number; glbPath: string | null } | null>;
      getMtime:       (p: string) => Promise<number | null>;
      updateBoard:    (p: string) => Promise<{ ok: boolean; glbPath?: string; brdContent?: string; brdMtime?: number; error?: string }>;
      openInEagle:    (p: string) => Promise<{ ok: boolean; error?: string }>;
      unwatchBoard:   (p: string) => Promise<void>;
      saveDevice:     (data: string, filePath?: string) => Promise<{ ok: boolean; filePath?: string }>;
      loadDevice:     () => Promise<{ ok: boolean; filePath?: string; data?: string } | null>;
      loadDeviceFile: (p: string) => Promise<{ ok: boolean; data?: string }>;
      getSettings:    () => Promise<Record<string, string>>;
      setSettings:    (d: Record<string, string>) => Promise<boolean>;
      onBrdModified:  (cb: (path: string) => void) => void;
      watchGlb:       (p: string) => Promise<void>;
      unwatchGlb:     (p: string) => Promise<void>;
      onGlbModified:  (cb: (path: string) => void) => void;
      exportScene:    (buf: ArrayBuffer) => Promise<{ ok: boolean; error?: string }>;
      openConBut:     (boards: Array<{ id: string; name: string; brdPath: string }>, layout: unknown) => Promise<void>;
      getConButLayout:() => Promise<unknown>;
      onShowConId:    (cb: (conId: string) => void) => void;
      onShowBoard:    (cb: (entityId: string) => void) => void;
    };
  }
}

interface ConnectorInfo {
  refDes: string;
  conId:  string;
  x: number; y: number;
  layer: 'top' | 'bottom';
  pins: Array<{ pin: string; signal: string }>;
}

interface Entity {
  id: string;
  name: string;
  object: THREE.Object3D;
  locked: boolean;
  brdPath?:      string;
  glbPath?:      string;
  brdMtime?:     number;
  modified?:     boolean;
  hidden?:       boolean;
  color?:        string;
  connectors?:   ConnectorInfo[];
  boardMinX?:    number;
  boardMinY?:    number;
  boardWidthMm?: number;
  boardHeightMm?: number;
}

interface EntityGroup { id: string; name: string; entityIds: string[]; }
let groups: EntityGroup[] = [];

// ── DOM ──────────────────────────────────────────────────────────────────────
const viewport      = document.getElementById('viewport')!;
const entityListEl  = document.getElementById('entity-list')!;
const groupListEl       = document.getElementById('group-list')!;
const btnNewGroup       = document.getElementById('btn-new-group')!;
const groupContextMenu  = document.getElementById('group-context-menu')!;
const grpCtxRename      = document.getElementById('grp-ctx-rename')!;
const grpCtxDelete      = document.getElementById('grp-ctx-delete')!;
const contextMenu       = document.getElementById('context-menu')!;
const ctxDelete         = document.getElementById('ctx-delete')!;
const ctxLock           = document.getElementById('ctx-lock')!;
const ctxEditBoard      = document.getElementById('ctx-edit-board')!;
const ctxUpdateBoard    = document.getElementById('ctx-update-board')!;
const ctxSepBrd         = document.getElementById('ctx-sep-brd')!;
const ctxToggleVisibility = document.getElementById('ctx-toggle-visibility')!;
const ctxSetColor       = document.getElementById('ctx-set-color')!;
const ctxSepColor       = document.getElementById('ctx-sep-color')!;
const colorPickerPopup  = document.getElementById('color-picker-popup')!;
const entityColorWheel  = document.getElementById('entity-color-wheel')  as HTMLInputElement;
const entityColorHex    = document.getElementById('entity-color-hex')    as HTMLInputElement;
const entityColorApply  = document.getElementById('entity-color-apply')!;
const entityColorCancel = document.getElementById('entity-color-cancel')!;
const entityColorReset  = document.getElementById('entity-color-reset')!;
const projLabel         = document.getElementById('proj-label')!;
const btnRotateLeft     = document.getElementById('btn-rotate-left')!;
const btnRotateRight    = document.getElementById('btn-rotate-right')!;
const btnHome           = document.getElementById('btn-home')!;
const btnAlign          = document.getElementById('btn-align')!;
const btnRotate         = document.getElementById('btn-rotate')!;
const btnSnapAlign      = document.getElementById('btn-snap-align')!;
const btnShowConnections = document.getElementById('btn-show-connections')!;
const alignHint         = document.getElementById('align-hint')!;
const conIdListEl       = document.getElementById('conid-list')!;
// File menu
const btnFile           = document.getElementById('btn-file')!;
const fileMenuEl        = document.getElementById('file-menu')!;
const fileImport3d      = document.getElementById('file-import-3d')!;
const fileImportBrd     = document.getElementById('file-import-brd')!;
const fileOpenConBut    = document.getElementById('file-open-conbut')!;
const fileExportScene   = document.getElementById('file-export-scene')!;
const fileSettings      = document.getElementById('file-settings')!;
// Settings modal
const settingsOverlay   = document.getElementById('settings-overlay')!;
const btnSettingsSave   = document.getElementById('btn-settings-save')!;
const btnSettingsCancel = document.getElementById('btn-settings-cancel')!;
const inputEaglePath    = document.getElementById('input-eagle-path')    as HTMLInputElement;
const inputEagleconCmd  = document.getElementById('input-eaglecon-cmd')  as HTMLInputElement;
const btnRestoreCmd        = document.getElementById('btn-restore-cmd')!;
const inputSnapMinRadius   = document.getElementById('input-snap-min-radius') as HTMLInputElement;
const inputTranslateStep   = document.getElementById('input-translate-step')  as HTMLInputElement;
const inputRotateStep      = document.getElementById('input-rotate-step')     as HTMLInputElement;
const inputLightIntensity  = document.getElementById('input-light-intensity') as HTMLInputElement;
const lightIntensityVal    = document.getElementById('light-intensity-val')!;

// ── RENDERER ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
viewport.appendChild(renderer.domElement);

// ── MAIN SCENE ───────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);

const AMBIENT_BASE = 0.6;
const SUN_BASE     = 1.2;
const FILL_BASE    = 0.4;
const CAM_BASE     = 0.25;
const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_BASE);
scene.add(ambientLight);
const sun = new THREE.DirectionalLight(0xffffff, SUN_BASE);
sun.position.set(1, 2, 1.5);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8899bb, FILL_BASE);
fill.position.set(-1, 0.5, -1);
scene.add(fill);
const camLight = new THREE.PointLight(0xffffff, CAM_BASE); // attached to perspCamera below

let lightIntensity = 0.4; // slider value in [0.1, 1.0]; 0.4 → multiplier 1.0 (unchanged)
function applyLightIntensity(v: number): void {
  const m = 0.5 + (v - 0.1) / 0.9 * 1.5; // maps [0.1,1.0] → [0.5,2.0]
  ambientLight.intensity = AMBIENT_BASE * m;
  sun.intensity          = SUN_BASE     * m;
  fill.intensity         = FILL_BASE    * m;
  camLight.intensity     = CAM_BASE     * m;
}
scene.add(new THREE.GridHelper(1, 10, 0x444444, 0x333333));

// ── DRAG HANDLE STATE (created early so all functions can reference it) ───────
const handleMesh = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgba(160,160,160,0.40)';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(220,220,220,0.90)';
  ctx.lineWidth = 5;
  ctx.strokeRect(2, 2, 60, 60);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(cv),
      transparent: true, side: THREE.DoubleSide,
      depthTest: false, depthWrite: false,
    })
  );
  m.renderOrder = 999;
  m.visible = false;
  scene.add(m);
  return m;
})();

const drag = {
  active:      false,
  entityId:    null as string | null,
  plane:       new THREE.Plane(),
  startWorld:  new THREE.Vector3(),
  startObjPos: new THREE.Vector3(),
};
let dragHandled = false;
let pointerDownX = 0, pointerDownY = 0;
let rmbDownX = 0, rmbDownY = 0;

// ── FACE ALIGN STATE (meshes created early alongside scene) ───────────────────
function makeAlignMat(hex: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hex, transparent: true, opacity: 0.50,
    side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  });
}
const alignHoverMesh  = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), makeAlignMat(0x4499ff));
const alignPickedMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), makeAlignMat(0x4499ff));
alignHoverMesh.renderOrder  = 998;
alignPickedMesh.renderOrder = 997;
alignPickedMesh.material.opacity = 0.30;
alignHoverMesh.visible  = false;
alignPickedMesh.visible = false;
scene.add(alignHoverMesh);
scene.add(alignPickedMesh);

const alignState = {
  active:      false,
  step:        0 as 0 | 1 | 2,
  srcEntityId: null as string | null,
  srcNormal:   new THREE.Vector3(),
  srcPoint:    new THREE.Vector3(),
};

// ── SNAP ALIGN STATE (declared early so deleteEntity can reference it) ─────────
interface SnapPt { world: THREE.Vector3; entityId: string; normal: THREE.Vector3 | null; }
const SNAP_PX_THRESHOLD = 24;
let snapMinHoleRadius = 0.002; // metres (default 2 mm)
let translateSnapStep = 0.001; // metres (default 1 mm)
let rotateSnapStep    = Math.PI / 12; // radians (default 15°)
const snapState = {
  active:      false,
  step:        0 as 0 | 1 | 2,
  srcEntityId: null as string | null,
  srcPt:       new THREE.Vector3(),
  srcNormal:   null as THREE.Vector3 | null,
  allPts:      [] as SnapPt[],
  idleMarkers: [] as THREE.Mesh[],
  hoverMarker: null as THREE.Mesh | null,
  srcMarker:   null as THREE.Mesh | null,
};

// ── UNDO / REDO ───────────────────────────────────────────────────────────────
interface TransformSnapshot {
  type: 'transform';
  entityId: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}
interface DeletionSnapshot {
  type: 'deletion';
  entity: Entity;
  index: number;
  groupIds: string[];
}
type UndoEntry = TransformSnapshot | DeletionSnapshot;
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
const MAX_UNDO = 50;

function snapshotOf(entity: Entity): TransformSnapshot {
  return {
    type:      'transform',
    entityId:   entity.id,
    position:   entity.object.position.clone(),
    quaternion: entity.object.quaternion.clone(),
  };
}

function pushUndo(entityId: string): void {
  const entity = entities.find(e => e.id === entityId);
  if (!entity) return;
  undoStack.push(snapshotOf(entity));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

function applyUndoEntry(entry: UndoEntry): UndoEntry | null {
  if (entry.type === 'transform') {
    const entity = entities.find(e => e.id === entry.entityId);
    if (!entity) return null;
    const prev = snapshotOf(entity);
    entity.object.position.copy(entry.position);
    entity.object.quaternion.copy(entry.quaternion);
    updateHandle();
    for (const b of selectionBoxes) b.update();
    return prev;
  } else {
    const existing = entities.find(e => e.id === entry.entity.id);
    if (existing) {
      // entity alive → delete it (redo path)
      const idx = entities.indexOf(existing);
      const savedGroupIds = groups.filter(g => g.entityIds.includes(existing.id)).map(g => g.id);
      if (existing.brdPath) window.kondor.unwatchBoard(existing.brdPath);
      unregisterConIds(existing.id);
      if (snapState.active  && snapState.srcEntityId  === existing.id) exitSnapAlignMode();
      if (rotSnapAxis?.entityId === existing.id) rotSnapAxis = null;
      scene.remove(existing.object);
      entities.splice(idx, 1);
      groups.forEach(g => { g.entityIds = g.entityIds.filter(id => id !== existing.id); });
      groups = groups.filter(g => g.entityIds.length > 0);
      renderGroupList();
      if (selectedIds.has(existing.id)) {
        selectedIds.delete(existing.id);
        if (selectedId === existing.id) selectedId = selectedIds.size > 0 ? [...selectedIds][0] : null;
        updateSelectionBoxes(); updateHandle();
      }
      renderList();
      return { type: 'deletion', entity: existing, index: idx, groupIds: savedGroupIds };
    } else {
      // entity gone → restore it (undo path)
      const insertAt = Math.min(entry.index, entities.length);
      entities.splice(insertAt, 0, entry.entity);
      scene.add(entry.entity.object);
      registerConIds(entry.entity);
      for (const gid of entry.groupIds) {
        const grp = groups.find(g => g.id === gid);
        if (grp && !grp.entityIds.includes(entry.entity.id)) grp.entityIds.push(entry.entity.id);
      }
      renderGroupList();
      renderList();
      return { type: 'deletion', entity: entry.entity, index: insertAt, groupIds: entry.groupIds };
    }
  }
}

// ── CAMERAS ──────────────────────────────────────────────────────────────────
const perspCamera = new THREE.PerspectiveCamera(
  50, viewport.clientWidth / viewport.clientHeight, 0.001, 1000
);
perspCamera.position.set(0.3, 0.3, 0.3);
perspCamera.add(camLight);
scene.add(perspCamera);

const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 1000);
let useOrtho = false;

function getCamera(): THREE.Camera {
  return useOrtho ? orthoCamera : perspCamera;
}

function syncOrtho(): void {
  const dist = perspCamera.position.distanceTo(controls.target);
  const h    = dist * Math.tan((perspCamera.fov * Math.PI) / 360);
  const asp  = viewport.clientWidth / viewport.clientHeight;
  orthoCamera.left   = -h * asp;
  orthoCamera.right  =  h * asp;
  orthoCamera.top    =  h;
  orthoCamera.bottom = -h;
  orthoCamera.position.copy(perspCamera.position);
  orthoCamera.quaternion.copy(perspCamera.quaternion);
  orthoCamera.updateProjectionMatrix();
}

function toggleProjection(): void {
  useOrtho = !useOrtho;
  if (!useOrtho) {
    perspCamera.up.set(0, 1, 0);
    setStandardView(false);
  }
  projLabel.textContent = useOrtho ? 'ORTHOGRAPHIC' : 'PERSPECTIVE';
}

// ── ORBIT CONTROLS ───────────────────────────────────────────────────────────
const controls = new OrbitControls(perspCamera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// ── STANDARD-VIEW STATE ──────────────────────────────────────────────────────
let inStandardView = false;

function setStandardView(on: boolean): void {
  inStandardView = on;
  const vis = on ? 'visible' : 'hidden';
  btnRotateLeft.style.visibility  = vis;
  btnRotateRight.style.visibility = vis;
  if (!on) handleMesh.visible = false;
}

controls.addEventListener('start', () => {
  if (inStandardView && !drag.active) setStandardView(false);
});

// ── CAMERA ANIMATION ─────────────────────────────────────────────────────────
const anim = {
  active: false,
  progress: 0,
  // linear mode
  fromPos:    new THREE.Vector3(),
  toPos:      new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toTarget:   new THREE.Vector3(),
  fromUp:     new THREE.Vector3(0, 1, 0),
  toUp:       new THREE.Vector3(0, 1, 0),
  // arc mode (rotation around view axis)
  isArc:         false,
  arcAxis:       new THREE.Vector3(),
  arcAngle:      0,
  arcFromOffset: new THREE.Vector3(),
  arcFromUp:     new THREE.Vector3(),
};

function startAnim(toPos: THREE.Vector3, toTarget: THREE.Vector3, toUp: THREE.Vector3): void {
  anim.isArc = false;
  anim.fromPos.copy(perspCamera.position);
  anim.fromUp.copy(perspCamera.up);
  anim.fromTarget.copy(controls.target);
  anim.toPos.copy(toPos);
  anim.toTarget.copy(toTarget);
  anim.toUp.copy(toUp);
  anim.progress = 0;
  anim.active = true;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function tickAnimation(): void {
  if (!anim.active) return;
  anim.progress = Math.min(1, anim.progress + 0.07);
  const t = easeOut(anim.progress);
  perspCamera.position.lerpVectors(anim.fromPos, anim.toPos, t);
  controls.target.lerpVectors(anim.fromTarget, anim.toTarget, t);
  perspCamera.up.lerpVectors(anim.fromUp, anim.toUp, t).normalize();
  if (anim.progress >= 1) {
    perspCamera.up.copy(anim.toUp);
    anim.active = false;
    updateHandle();
  }
  controls.update();
}

// ── STANDARD VIEWS ───────────────────────────────────────────────────────────
const FACE_LABELS = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK'] as const;
type FaceName = typeof FACE_LABELS[number];

const STANDARD_VIEWS: Record<FaceName, { dir: THREE.Vector3; up: THREE.Vector3 }> = {
  TOP:    { dir: new THREE.Vector3( 0,  1,  0), up: new THREE.Vector3( 0,  0, -1) },
  BOTTOM: { dir: new THREE.Vector3( 0, -1,  0), up: new THREE.Vector3( 0,  0,  1) },
  FRONT:  { dir: new THREE.Vector3( 0,  0,  1), up: new THREE.Vector3( 0,  1,  0) },
  BACK:   { dir: new THREE.Vector3( 0,  0, -1), up: new THREE.Vector3( 0,  1,  0) },
  RIGHT:  { dir: new THREE.Vector3( 1,  0,  0), up: new THREE.Vector3( 0,  1,  0) },
  LEFT:   { dir: new THREE.Vector3(-1,  0,  0), up: new THREE.Vector3( 0,  1,  0) },
};

function navigateToView(dir: THREE.Vector3, up: THREE.Vector3): void {
  const dist  = perspCamera.position.distanceTo(controls.target);
  const toPos = controls.target.clone().addScaledVector(dir, dist);
  startAnim(toPos, controls.target.clone(), up);
  if (!useOrtho) toggleProjection();
  setStandardView(true);
}

function rotateView(sign: 1 | -1): void {
  const viewDir = new THREE.Vector3();
  perspCamera.getWorldDirection(viewDir); // points INTO screen
  const angle = sign * Math.PI / 2;

  const offset = perspCamera.position.clone().sub(controls.target);
  offset.applyAxisAngle(viewDir, angle);
  const newUp = perspCamera.up.clone().applyAxisAngle(viewDir, angle);
  const toPos = controls.target.clone().add(offset);
  startAnim(toPos, controls.target.clone(), newUp);
  setStandardView(true);
}

function resetToHome(): void {
  const newTarget = new THREE.Vector3();
  let newPos: THREE.Vector3;

  if (entities.length > 0) {
    const box = new THREE.Box3();
    entities.forEach(e => box.expandByObject(e.object));
    box.getCenter(newTarget);
    const size = box.getSize(new THREE.Vector3());
    const dist = (Math.max(size.x, size.y, size.z) / 2) / Math.tan((perspCamera.fov * Math.PI) / 360) * 1.8;
    newPos = newTarget.clone().add(new THREE.Vector3(dist * 0.6, dist * 0.5, dist * 0.8));
  } else {
    newPos = new THREE.Vector3(0.3, 0.3, 0.3);
  }

  startAnim(newPos, newTarget, new THREE.Vector3(0, 1, 0));
  if (useOrtho) toggleProjection();
  setStandardView(false);
}

// ── VIEWCUBE ─────────────────────────────────────────────────────────────────
const CUBE_PX  = 110;
const CUBE_PAD = 12;

const cubeScene = new THREE.Scene();
const cubeCam   = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20);
cubeScene.add(new THREE.AmbientLight(0xffffff, 1));

function makeFaceMaterial(label: string): THREE.MeshBasicMaterial {
  const cv  = document.createElement('canvas');
  cv.width  = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#505050';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 122, 122);
  ctx.fillStyle = '#bbb';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) });
}

const cubeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1.4, 1.4, 1.4),
  FACE_LABELS.map(l => makeFaceMaterial(l))
);
cubeScene.add(cubeMesh);

function updateCubeCam(): void {
  const dir = new THREE.Vector3();
  perspCamera.getWorldDirection(dir);
  cubeCam.position.copy(dir).negate().multiplyScalar(8);
  cubeCam.up.copy(perspCamera.up);
  cubeCam.lookAt(0, 0, 0);
}

function renderViewCube(): void {
  const dpr = window.devicePixelRatio;
  const px  = Math.round(renderer.domElement.clientWidth  * dpr);
  const py  = Math.round(renderer.domElement.clientHeight * dpr);
  const cs  = Math.round(CUBE_PX  * dpr);
  const pad = Math.round(CUBE_PAD * dpr);

  // Upper-right: WebGL Y is from bottom, so py - cs - pad = pad from top
  updateCubeCam();
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setScissor(px - cs - pad, py - cs - pad, cs, cs);
  renderer.setViewport(px - cs - pad, py - cs - pad, cs, cs);
  renderer.clear(false, true, false);
  renderer.render(cubeScene, cubeCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, px, py);
  renderer.autoClear = true;
}

function handleCubeClick(clientX: number, clientY: number): boolean {
  const rect    = renderer.domElement.getBoundingClientRect();
  const x       = clientX - rect.left;
  const y       = clientY - rect.top;
  const cubeLeft = rect.width  - CUBE_PX - CUBE_PAD;
  const cubeTop  = CUBE_PAD;

  if (x < cubeLeft || x > cubeLeft + CUBE_PX || y < cubeTop || y > cubeTop + CUBE_PX) {
    return false;
  }

  const nx =  ((x - cubeLeft) / CUBE_PX) * 2 - 1;
  const ny = -((y - cubeTop)  / CUBE_PX) * 2 + 1;

  const cubeRay = new THREE.Raycaster();
  cubeRay.setFromCamera(new THREE.Vector2(nx, ny), cubeCam);
  const hits = cubeRay.intersectObject(cubeMesh);
  if (hits.length > 0 && hits[0].face) {
    const face = FACE_LABELS[hits[0].face.materialIndex];
    const view = STANDARD_VIEWS[face];
    navigateToView(view.dir, view.up);
  }
  return true;
}

// ── ENTITY STATE ─────────────────────────────────────────────────────────────
const entities: Entity[] = [];
let selectedId: string | null = null;          // primary (for tools, gizmo orientation)
const selectedIds = new Set<string>();          // full multi-selection
let contextTargetId: string | null = null;
let selectionBoxes: THREE.BoxHelper[] = [];

const loader    = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── SELECTION ────────────────────────────────────────────────────────────────
function updateSelectionBoxes(): void {
  for (const b of selectionBoxes) scene.remove(b);
  selectionBoxes = [];
  for (const id of selectedIds) {
    const ent = entities.find(e => e.id === id);
    if (ent && !ent.hidden) { const b = new THREE.BoxHelper(ent.object, 0x0e639c); scene.add(b); selectionBoxes.push(b); }
  }
}

function updateToolbarState(): void {
  const n = selectedIds.size;
  (btnAlign    as HTMLButtonElement).disabled = n !== 1;
  (btnSnapAlign as HTMLButtonElement).disabled = n !== 2;
  (btnRotate   as HTMLButtonElement).disabled = n === 0;
}

function selectEntity(id: string | null, ctrl = false): void {
  if (ctrl && id !== null) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      if (selectedId === id) selectedId = selectedIds.size > 0 ? [...selectedIds][0] : null;
    } else {
      selectedIds.add(id);
      selectedId = id;
    }
  } else {
    selectedIds.clear();
    if (id !== null) selectedIds.add(id);
    selectedId = id;
  }
  updateSelectionBoxes();
  updateHandle();
  updateToolbarState();
  renderList();
}

// ── SIDEBAR ──────────────────────────────────────────────────────────────────
const SVG_EYE = `<svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1C4 1 1 5 1 5s3 4 6 4 6-4 6-4-3-4-6-4z" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="5" r="1.8" fill="currentColor"/></svg>`;
const SVG_EYE_OFF = `<svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1C4 1 1 5 1 5s3 4 6 4 6-4 6-4-3-4-6-4z" stroke="currentColor" stroke-width="1.2" opacity="0.35"/><line x1="1" y1="9.5" x2="13" y2="0.5" stroke="currentColor" stroke-width="1.2"/></svg>`;

function setEntityVisible(entity: Entity, visible: boolean): void {
  entity.hidden = !visible;
  entity.object.visible = visible;
}

function renderList(): void {
  entityListEl.innerHTML = '';
  for (const entity of entities) {
    const item = document.createElement('div');
    item.className = 'entity-item' + (selectedIds.has(entity.id) ? ' selected' : '');

    const dot = document.createElement('span');
    dot.className = 'entity-dot' + (entity.modified ? ' modified' : ' hidden');
    item.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'entity-name';
    name.textContent = (entity.locked ? '⚓ ' : '') + entity.name;
    item.appendChild(name);

    const eye = document.createElement('button');
    eye.className = 'entity-eye' + (entity.hidden ? ' is-hidden' : '');
    eye.innerHTML = entity.hidden ? SVG_EYE_OFF : SVG_EYE;
    eye.title = entity.hidden ? 'Show' : 'Hide';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      setEntityVisible(entity, !!entity.hidden);
      renderList();
      updateSelectionBoxes();
      updateHandle();
    });
    item.appendChild(eye);

    item.addEventListener('click', (e) => selectEntity(entity.id, e.ctrlKey));
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, entity.id);
    });
    entityListEl.appendChild(item);
  }
}

// ── ENTITY COLOR ─────────────────────────────────────────────────────────────
function applyEntityColor(entity: Entity, hex: string): void {
  const color = new THREE.Color(hex);
  entity.object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if ('color' in mat) { (mat as THREE.MeshStandardMaterial).color.copy(color); mat.needsUpdate = true; }
    }
  });
}

let colorPickerTargetId: string | null = null;

function showColorPicker(x: number, y: number, entityId: string): void {
  colorPickerTargetId = entityId;
  const entity = entities.find(e => e.id === entityId);
  const current = entity?.color ?? '#888888';
  entityColorWheel.value = current;
  entityColorHex.value   = current;
  colorPickerPopup.style.left = x + 'px';
  colorPickerPopup.style.top  = y + 'px';
  colorPickerPopup.classList.add('open');
}

function hideColorPicker(): void {
  colorPickerPopup.classList.remove('open');
  colorPickerTargetId = null;
}

entityColorWheel.addEventListener('input', () => {
  entityColorHex.value = entityColorWheel.value;
});

entityColorHex.addEventListener('input', () => {
  const v = entityColorHex.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) entityColorWheel.value = v;
});

entityColorApply.addEventListener('click', () => {
  if (!colorPickerTargetId) return;
  const entity = entities.find(e => e.id === colorPickerTargetId);
  if (!entity) return;
  const hex = entityColorWheel.value;
  entity.color = hex;
  applyEntityColor(entity, hex);
  hideColorPicker();
});

entityColorCancel.addEventListener('click', () => hideColorPicker());

entityColorReset.addEventListener('click', () => {
  const id = colorPickerTargetId;
  hideColorPicker();
  if (!id) return;
  const entity = entities.find(e => e.id === id);
  if (!entity) return;
  entity.color = undefined;
  reloadGlb(id);
});

document.addEventListener('pointerdown', (e) => {
  if (colorPickerPopup.classList.contains('open') && !colorPickerPopup.contains(e.target as Node)) {
    hideColorPicker();
  }
});

// ── CONTEXT MENU ─────────────────────────────────────────────────────────────
function showContextMenu(x: number, y: number, entityId: string): void {
  contextTargetId = entityId;
  selectEntity(entityId);
  const entity = entities.find(e => e.id === entityId);
  const locked  = entity?.locked ?? false;
  const hasBrd = !!entity?.brdPath;
  const hasGlb = !!entity?.glbPath && !hasBrd;
  ctxLock.innerHTML = (locked ? 'Unlock' : 'Lock') + '<span class="menu-hotkey">L</span>';
  ctxToggleVisibility.innerHTML = (entity?.hidden ? 'Show' : 'Hide') + '<span class="menu-hotkey">H</span>';
  ctxEditBoard.style.display   = hasBrd          ? 'block' : 'none';
  ctxUpdateBoard.style.display = (hasBrd||hasGlb) ? 'block' : 'none';
  ctxSepBrd.style.display      = (hasBrd||hasGlb) ? 'block' : 'none';
  ctxSetColor.style.display    = hasGlb          ? 'block' : 'none';
  ctxSepColor.style.display    = hasGlb          ? 'block' : 'none';
  contextMenu.style.left = x + 'px';
  contextMenu.style.top  = y + 'px';
  contextMenu.style.display = 'block';
  const r = contextMenu.getBoundingClientRect();
  if (r.right  > window.innerWidth)  contextMenu.style.left = (x - r.width)  + 'px';
  if (r.bottom > window.innerHeight) contextMenu.style.top  = (y - r.height) + 'px';
}

function hideContextMenu(): void {
  contextMenu.style.display = 'none';
  contextTargetId = null;
}

ctxLock.addEventListener('click', () => {
  if (!contextTargetId) return;
  const entity = entities.find(e => e.id === contextTargetId);
  if (entity) { entity.locked = !entity.locked; renderList(); updateHandle(); }
  hideContextMenu();
});

ctxToggleVisibility.addEventListener('click', () => {
  if (!contextTargetId) return;
  const entity = entities.find(e => e.id === contextTargetId);
  if (entity) { setEntityVisible(entity, !!entity.hidden); renderList(); updateSelectionBoxes(); updateHandle(); }
  hideContextMenu();
});

ctxDelete.addEventListener('click', () => {
  if (contextTargetId) { deleteEntity(contextTargetId); hideContextMenu(); }
});

document.addEventListener('pointerdown', (e) => {
  if (contextMenu.style.display === 'block' && !contextMenu.contains(e.target as Node)) {
    hideContextMenu();
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────
function deleteEntity(id: string): void {
  const idx = entities.findIndex(e => e.id === id);
  if (idx === -1) return;
  const entity = entities[idx];
  if (entity.brdPath) window.kondor.unwatchBoard(entity.brdPath);
  if (entity.glbPath && !entity.brdPath) window.kondor.unwatchGlb(entity.glbPath);
  unregisterConIds(id);
  if (snapState.active && snapState.srcEntityId === id) exitSnapAlignMode();
  if (rotSnapAxis?.entityId === id) rotSnapAxis = null;
  if (rotateState.active && rotateState.isDragging && selectedId === id) exitRotateMode();
  scene.remove(entity.object);
  entities.splice(idx, 1);
  groups.forEach(g => { g.entityIds = g.entityIds.filter(eid => eid !== id); });
  groups = groups.filter(g => g.entityIds.length > 0);
  renderGroupList();
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    if (selectedId === id) selectedId = selectedIds.size > 0 ? [...selectedIds][0] : null;
    updateSelectionBoxes();
    updateHandle();
  }
  renderList();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (alignState.active || snapState.active || rotateState.active) {
      exitAlignMode(); exitSnapAlignMode(); exitRotateMode(true);
    } else {
      if (selectedConIds.size > 0) {
        selectedConIds.clear();
        clearConIdViz();
        renderConIdList();
      } else {
        selectEntity(null);
      }
    }
    return;
  }
  if (e.key === 'Enter'  && rotateState.active) { exitRotateMode(false); return; }
  if (e.code === 'KeyH' && !e.ctrlKey && !e.altKey && !e.metaKey && selectedIds.size > 0 && !(e.target instanceof HTMLInputElement)) {
    const anyVisible = [...selectedIds].some(id => !entities.find(en => en.id === id)?.hidden);
    for (const id of selectedIds) { const en = entities.find(en => en.id === id); if (en) setEntityVisible(en, !anyVisible); }
    renderList(); updateSelectionBoxes(); updateHandle(); return;
  }
  if (e.code === 'KeyL' && !e.ctrlKey && !e.altKey && !e.metaKey && selectedIds.size > 0 && !(e.target instanceof HTMLInputElement)) {
    const anyUnlocked = [...selectedIds].some(id => !entities.find(en => en.id === id)?.locked);
    for (const id of selectedIds) { const en = entities.find(en => en.id === id); if (en) en.locked = anyUnlocked; }
    renderList(); updateHandle(); return;
  }
  if (e.code === 'KeyC' && !e.ctrlKey && !e.altKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) {
    showConnectionsTool(); return;
  }
  if (e.key === 'Delete' && selectedIds.size > 0 && !(e.target instanceof HTMLInputElement)) {
    const toDelete = [...selectedIds];
    for (const id of toDelete) {
      const idx = entities.findIndex(e => e.id === id);
      if (idx === -1) continue;
      const gids = groups.filter(g => g.entityIds.includes(id)).map(g => g.id);
      undoStack.push({ type: 'deletion', entity: entities[idx], index: idx, groupIds: gids });
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    redoStack.length = 0;
    for (const id of toDelete) deleteEntity(id);
  }
  if (e.code === 'KeyP' && !(e.target instanceof HTMLInputElement)) toggleProjection();
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) {
    if (e.code === 'KeyA') { e.preventDefault(); alignState.active ? exitAlignMode() : enterAlignMode(); return; }
    if (e.code === 'KeyS') { e.preventDefault(); snapState.active  ? exitSnapAlignMode() : enterSnapAlignMode(); return; }
    if (e.code === 'KeyR') { e.preventDefault(); rotateState.active ? exitRotateMode(true) : enterRotateMode(); return; }
    if (e.code === 'KeyG') {
      e.preventDefault();
      if (selectedIds.size > 0) {
        const ids = [...selectedIds];
        startInlineGroupName((name) => { groups.push({ id: generateId(), name, entityIds: ids }); });
      }
      return;
    }
  }
  if (e.code === 'KeyB' && !e.ctrlKey && !e.altKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); openConBut(); return; }
  if (e.ctrlKey && e.code === 'KeyN') { e.preventDefault(); newDevice(); return; }
  if (e.ctrlKey && e.code === 'KeyO') { e.preventDefault(); openDevice(); return; }
  if (e.ctrlKey && e.code === 'KeyS' && !e.shiftKey) { e.preventDefault(); saveDevice(); return; }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); saveDevice(true); return; }
  if (e.ctrlKey && e.code === 'KeyB') { e.preventDefault(); importBrd(); return; }
  if (e.ctrlKey && e.code === 'KeyM') { e.preventDefault(); addModel(); return; }
  if (e.ctrlKey && e.code === 'KeyZ' && !e.shiftKey) {
    e.preventDefault();
    const snap = undoStack.pop();
    if (!snap) return;
    const prev = applyUndoEntry(snap);
    if (prev) redoStack.push(prev);
  }
  if (e.ctrlKey && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
    e.preventDefault();
    const snap = redoStack.pop();
    if (!snap) return;
    const prev = applyUndoEntry(snap);
    if (prev) undoStack.push(prev);
  }
});

// ── DRAG HANDLE LOGIC ────────────────────────────────────────────────────────
function updateHandle(): void {
  handleMesh.visible = false;
}

function getWorldOnDragPlane(clientX: number, clientY: number): THREE.Vector3 | null {
  const rect = renderer.domElement.getBoundingClientRect();
  const nx   =  ((clientX - rect.left) / rect.width)  * 2 - 1;
  const ny   = -((clientY - rect.top)  / rect.height) * 2 + 1;
  const ray  = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), getCamera());
  const pt = new THREE.Vector3();
  return ray.ray.intersectPlane(drag.plane, pt) ? pt : null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !handleMesh.visible || !selectedId) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const nx   =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  const ny   = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  const ray  = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), getCamera());
  if (ray.intersectObject(handleMesh).length === 0) return;

  const entity = entities.find(en => en.id === selectedId)!;
  if (entity.locked) return;
  const camDir = new THREE.Vector3();
  perspCamera.getWorldDirection(camDir);
  drag.plane.setFromNormalAndCoplanarPoint(camDir, handleMesh.position);
  const startPt = getWorldOnDragPlane(e.clientX, e.clientY);
  if (!startPt) return;

  pushUndo(selectedId);
  drag.active = true;
  drag.entityId = selectedId;
  drag.startWorld.copy(startPt);
  drag.startObjPos.copy(entity.object.position);
  dragHandled = true;
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
}, { capture: true });

renderer.domElement.addEventListener('pointermove', (e) => {
  if (drag.active) {
    const pt = getWorldOnDragPlane(e.clientX, e.clientY);
    if (!pt) return;
    const entity = entities.find(en => en.id === drag.entityId);
    if (!entity) return;
    entity.object.position.copy(drag.startObjPos).add(pt.clone().sub(drag.startWorld));
    updateHandle();
    for (const b of selectionBoxes) b.update();
    return;
  }
  if (gizmoDrag.active) { moveGizmoDrag(e.clientX, e.clientY, e.shiftKey); return; }
  applyGizmoHover(hitTestGizmo(e.clientX, e.clientY));
  if (rotateState.isDragging && rotateState.axis && rotateState.startStates.size > 0) {
    const angle = getAngleOnPlane(e.clientX, e.clientY);
    if (angle !== null) {
      let delta = angle - rotateState.startAngle;
      while (delta >  Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (e.shiftKey) delta = Math.round(delta / rotateSnapStep) * rotateSnapStep;
      const q = new THREE.Quaternion().setFromAxisAngle(rotateState.axis.dir, delta);
      for (const [id, start] of rotateState.startStates) {
        const en = entities.find(en => en.id === id);
        if (!en) continue;
        const offset = start.pos.clone().sub(rotateState.axis!.point).applyQuaternion(q);
        en.object.position.copy(rotateState.axis!.point).add(offset);
        en.object.quaternion.copy(start.quat).premultiply(q);
      }
      updateHandle();
      for (const b of selectionBoxes) b.update();
    }
    return;
  }
  updateAlignHover(e.clientX, e.clientY);
  updateSnapHover(e.clientX, e.clientY);
  updateRotateHover(e.clientX, e.clientY);
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (gizmoDrag.active) {
    gizmoDrag.active = false;
    controls.enabled = true;
    renderer.domElement.releasePointerCapture(e.pointerId);
    return;
  }
  if (rotateState.isDragging) {
    rotateState.isDragging = false;
    controls.enabled = true;
    renderer.domElement.releasePointerCapture(e.pointerId);
    return;
  }
  if (!drag.active) return;
  drag.active = false;
  controls.enabled = true;
  renderer.domElement.releasePointerCapture(e.pointerId);
});

// ── FACE ALIGN LOGIC ─────────────────────────────────────────────────────────

function enterAlignMode(): void {
  if (selectedIds.size > 1) return;
  exitSnapAlignMode();
  exitRotateMode();
  alignState.active = true;
  alignState.step   = 1;
  alignHint.textContent  = 'Align — step 1: click the face to move';
  alignHint.style.display = 'block';
  btnAlign.classList.add('active');
}

function exitAlignMode(): void {
  alignState.active      = false;
  alignState.step        = 0;
  alignState.srcEntityId = null;
  alignHoverMesh.visible  = false;
  alignPickedMesh.visible = false;
  alignHint.style.display = 'none';
  btnAlign.classList.remove('active');
}

function getAlignHit(clientX: number, clientY: number): { entity: Entity; normal: THREE.Vector3; point: THREE.Vector3 } | null {
  const rect = renderer.domElement.getBoundingClientRect();
  const nx   =  ((clientX - rect.left) / rect.width)  * 2 - 1;
  const ny   = -((clientY - rect.top)  / rect.height) * 2 + 1;
  const ray  = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), getCamera());
  const meshes: THREE.Object3D[] = [];
  entities.forEach(en => en.object.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o); }));
  const hits = ray.intersectObjects(meshes, false);
  if (!hits.length || !hits[0].face) return null;
  const hit    = hits[0];
  const entity = getEntityByObject(hit.object);
  if (!entity) return null;
  const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
  return { entity, normal, point: hit.point.clone() };
}

function updateAlignHover(clientX: number, clientY: number): void {
  if (!alignState.active) return;
  const result = getAlignHit(clientX, clientY);
  if (!result || (alignState.step === 2 && result.entity.id === alignState.srcEntityId)) {
    alignHoverMesh.visible = false;
    return;
  }
  const { entity, normal, point } = result;
  const box  = new THREE.Box3().setFromObject(entity.object);
  const size = box.getSize(new THREE.Vector3());
  const s    = Math.max(size.x, size.y, size.z) * 0.40;
  const mat  = alignHoverMesh.material as THREE.MeshBasicMaterial;
  mat.color.setHex(alignState.step === 1 ? 0x4499ff : 0x44cc88);
  alignHoverMesh.position.copy(point).addScaledVector(normal, 0.002);
  alignHoverMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  alignHoverMesh.scale.setScalar(Math.max(s, 0.005));
  alignHoverMesh.visible = true;
}

function executeAlign(srcEntityId: string, srcNormal: THREE.Vector3, srcPoint: THREE.Vector3,
                      _dst: Entity, dstNormal: THREE.Vector3, dstPoint: THREE.Vector3): void {
  const src = entities.find(e => e.id === srcEntityId);
  if (!src) return;
  pushUndo(srcEntityId);

  // Rotate around bbox centre so the src face normal becomes -dstNormal (face-to-face)
  const q       = new THREE.Quaternion().setFromUnitVectors(srcNormal, dstNormal.clone().negate());
  const center0 = new THREE.Box3().setFromObject(src.object).getCenter(new THREE.Vector3());
  src.object.position.copy(
    center0.clone().add(src.object.position.clone().sub(center0).applyQuaternion(q))
  );
  src.object.quaternion.premultiply(q);

  // Find where the clicked source point ended up after rotation (pivot = center0)
  const rotatedSrcPt = center0.clone().add(srcPoint.clone().sub(center0).applyQuaternion(q));

  // Translate along dstNormal so rotatedSrcPt lies exactly on the destination plane
  src.object.position.addScaledVector(
    dstNormal,
    dstPoint.dot(dstNormal) - rotatedSrcPt.dot(dstNormal)
  );

  updateHandle();
  for (const b of selectionBoxes) b.update();
}

function handleAlignClick(clientX: number, clientY: number): void {
  const result = getAlignHit(clientX, clientY);
  if (!result) return;
  const { entity, normal, point } = result;

  if (alignState.step === 1) {
    if (entity.locked) return;
    alignState.srcEntityId = entity.id;
    alignState.srcNormal.copy(normal);
    alignState.srcPoint.copy(point);
    alignState.step = 2;
    // freeze picked-face indicator
    alignPickedMesh.position.copy(alignHoverMesh.position);
    alignPickedMesh.quaternion.copy(alignHoverMesh.quaternion);
    alignPickedMesh.scale.copy(alignHoverMesh.scale);
    alignPickedMesh.visible = true;
    alignHint.textContent = 'Align — step 2: click the target face  (Esc to cancel)';
    selectEntity(entity.id);
  } else if (alignState.step === 2) {
    if (entity.id === alignState.srcEntityId) return;
    executeAlign(alignState.srcEntityId!, alignState.srcNormal, alignState.srcPoint, entity, normal, point);
    exitAlignMode();
  }
}

// ── CUBE & ROTATION BUTTONS ──────────────────────────────────────────────────
btnRotateLeft.addEventListener('click',  () => rotateView(-1));
btnRotateRight.addEventListener('click', () => rotateView( 1));
btnHome.addEventListener('click', resetToHome);
btnAlign.addEventListener('click', () => alignState.active ? exitAlignMode() : enterAlignMode());

function showConnectionsTool(): void {
  const brdEntities = [...selectedIds]
    .map(id => entities.find(e => e.id === id))
    .filter((e): e is Entity => !!e?.brdPath);

  if (brdEntities.length === 0) return;

  selectedConIds.clear();

  if (brdEntities.length === 1) {
    const conIds = [...new Set((brdEntities[0].connectors ?? []).map(c => c.conId))].sort();
    for (const conId of conIds) selectedConIds.set(conId, nextColorIdx());
  } else {
    const conIdEntityMap = new Map<string, Set<string>>();
    for (const entity of brdEntities) {
      for (const conn of (entity.connectors ?? [])) {
        if (!conIdEntityMap.has(conn.conId)) conIdEntityMap.set(conn.conId, new Set());
        conIdEntityMap.get(conn.conId)!.add(entity.id);
      }
    }
    const shared = [...conIdEntityMap.entries()]
      .filter(([, ids]) => ids.size >= 2)
      .map(([conId]) => conId)
      .sort();
    for (const conId of shared) selectedConIds.set(conId, nextColorIdx());
  }

  if (selectedConIds.size > 0) refreshConIdViz(); else clearConIdViz();
  renderConIdList();
}

btnShowConnections.addEventListener('click', showConnectionsTool);

let rotSnapAxis: { normal: THREE.Vector3; pivot: THREE.Vector3; entityId: string } | null = null;

// ── SNAP ALIGN ────────────────────────────────────────────────────────────────
function makeSnapMarker(color: number, scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.001 * scale, 6, 4),
    new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
  );
  m.renderOrder = 1000;
  scene.add(m);
  return m;
}

function detectCircles(mesh: THREE.Mesh): Array<{ center: THREE.Vector3; normal: THREE.Vector3 }> {
  const geo = mesh.geometry;
  if (!geo.attributes.position || !geo.index) return [];
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const indices = geo.index.array;
  const n = posAttr.count;
  const MERGE = 0.0005;

  const grid = new Map<string, number>();
  const canon: THREE.Vector3[] = [];
  const vMap = new Int32Array(n);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    tmp.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
    const key = `${Math.round(tmp.x / MERGE)},${Math.round(tmp.y / MERGE)},${Math.round(tmp.z / MERGE)}`;
    if (grid.has(key)) { vMap[i] = grid.get(key)!; continue; }
    const ci = canon.length;
    canon.push(tmp.clone());
    grid.set(key, ci);
    vMap[i] = ci;
  }

  const edgeCnt = new Map<string, number>();
  const edgeVerts = new Map<string, [number, number]>();
  const faceCount = indices.length / 3;
  for (let f = 0; f < faceCount; f++) {
    const a = vMap[indices[f * 3]], b = vMap[indices[f * 3 + 1]], c = vMap[indices[f * 3 + 2]];
    const edges: [number, number][] = [
      [Math.min(a, b), Math.max(a, b)],
      [Math.min(b, c), Math.max(b, c)],
      [Math.min(c, a), Math.max(c, a)],
    ];
    for (const [u, v] of edges) {
      const k = `${u}_${v}`;
      edgeCnt.set(k, (edgeCnt.get(k) ?? 0) + 1);
      if (!edgeVerts.has(k)) edgeVerts.set(k, [u, v]);
    }
  }

  const adj = new Map<number, number[]>();
  for (const [k, cnt] of edgeCnt) {
    if (cnt !== 1) continue;
    const [u, v] = edgeVerts.get(k)!;
    if (!adj.has(u)) adj.set(u, []); adj.get(u)!.push(v);
    if (!adj.has(v)) adj.set(v, []); adj.get(v)!.push(u);
  }

  const visited = new Set<number>();
  const centers: Array<{ center: THREE.Vector3; normal: THREE.Vector3 }> = [];
  for (const [start] of adj) {
    if (visited.has(start)) continue;
    const loop = [start];
    visited.add(start);
    let cur = start, prev = -1;
    for (let s = 0; s < 10000; s++) {
      const next = (adj.get(cur) ?? []).find(nb => nb !== prev && !visited.has(nb));
      if (next === undefined) break;
      loop.push(next); visited.add(next); prev = cur; cur = next;
    }
    if (loop.length < 8) continue;
    const pts = loop.map(i => canon[i]);
    const centroid = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const dists = pts.map(p => p.distanceTo(centroid));
    const meanR = dists.reduce((s, d) => s + d, 0) / pts.length;
    if (meanR < snapMinHoleRadius) continue;
    const residual = Math.sqrt(dists.reduce((s, d) => s + (d - meanR) ** 2, 0) / pts.length);
    if (residual / meanR > 0.12) continue;
    const newell = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      newell.x += (a.y - b.y) * (a.z + b.z);
      newell.y += (a.z - b.z) * (a.x + b.x);
      newell.z += (a.x - b.x) * (a.y + b.y);
    }
    centers.push({ center: centroid, normal: newell.normalize() });
  }
  return centers;
}

function buildEntitySnaps(entity: Entity): SnapPt[] {
  const pts: SnapPt[] = [];
  const center = new THREE.Box3().setFromObject(entity.object).getCenter(new THREE.Vector3());
  pts.push({ world: center, entityId: entity.id, normal: null });
  entity.object.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.index) return;
    for (const c of detectCircles(mesh))
      pts.push({ world: c.center, entityId: entity.id, normal: c.normal });
  });
  return pts;
}

function worldToScreen(worldPt: THREE.Vector3): THREE.Vector2 {
  const rect = renderer.domElement.getBoundingClientRect();
  const v = worldPt.clone().project(getCamera());
  return new THREE.Vector2(
    (v.x + 1) / 2 * rect.width  + rect.left,
    (-v.y + 1) / 2 * rect.height + rect.top,
  );
}

function nearestSnapPt(cx: number, cy: number, excludeId: string | null): SnapPt | null {
  let best: SnapPt | null = null, bestD = SNAP_PX_THRESHOLD;
  for (const pt of snapState.allPts) {
    if (pt.entityId === excludeId) continue;
    const s = worldToScreen(pt.world);
    const d = Math.hypot(s.x - cx, s.y - cy);
    if (d < bestD) { bestD = d; best = pt; }
  }
  return best;
}

function snapClearMarkers(): void {
  for (const m of snapState.idleMarkers) scene.remove(m);
  snapState.idleMarkers.length = 0;
  if (snapState.srcMarker) { scene.remove(snapState.srcMarker); snapState.srcMarker = null; }
}

function snapShowMarkersFor(entityIds: string[]): void {
  snapClearMarkers();
  snapState.allPts = entityIds
    .map(id => entities.find(e => e.id === id))
    .filter((e): e is Entity => !!e)
    .flatMap(e => buildEntitySnaps(e));
  for (const p of snapState.allPts) {
    const m = makeSnapMarker(0x44aaff);
    m.position.copy(p.world); m.visible = true;
    snapState.idleMarkers.push(m);
  }
}

function exitSnapAlignMode(): void {
  if (!snapState.active) return;
  snapClearMarkers();
  if (snapState.hoverMarker) { scene.remove(snapState.hoverMarker); snapState.hoverMarker = null; }
  snapState.active = false; snapState.step = 0; snapState.srcEntityId = null;
  alignHint.style.display = 'none';
  btnSnapAlign.classList.remove('active');
  selectEntity(null);
}

function enterSnapAlignMode(): void {
  if (selectedIds.size !== 2) return;
  const [id1, id2] = [...selectedIds];
  const e1 = entities.find(e => e.id === id1);
  const e2 = entities.find(e => e.id === id2);
  if (!e1 || !e2 || (e1.locked && e2.locked)) return;
  exitAlignMode();
  exitRotateMode();

  snapState.active      = true;
  snapState.step        = 1;
  snapState.srcEntityId = null;
  snapShowMarkersFor([id1, id2]);
  alignHint.textContent   = 'Snap — step 1: click point on the object to move  (Esc to cancel)';
  alignHint.style.display = 'block';
  btnSnapAlign.classList.add('active');
}

function updateSnapHover(cx: number, cy: number): void {
  if (!snapState.active) return;
  const pt = nearestSnapPt(cx, cy, null);
  if (!snapState.hoverMarker) snapState.hoverMarker = makeSnapMarker(0xffff44, 1.8);
  snapState.hoverMarker.visible = !!pt;
  if (pt) snapState.hoverMarker.position.copy(pt.world);
}

function handleSnapAlignClick(cx: number, cy: number): void {
  if (snapState.step === 1) {
    const pt = nearestSnapPt(cx, cy, null);
    if (!pt) return;
    if (!selectedIds.has(pt.entityId)) return;
    const src = entities.find(e => e.id === pt.entityId);
    if (!src || src.locked) return;
    const dstId = [...selectedIds].find(id => id !== pt.entityId)!;

    snapState.srcEntityId = pt.entityId;
    snapState.srcPt.copy(pt.world);
    snapState.srcNormal = pt.normal ? pt.normal.clone() : null;
    snapState.step = 2;

    snapState.srcMarker = makeSnapMarker(0x44ff88, 1.8);
    snapState.srcMarker.position.copy(pt.world); snapState.srcMarker.visible = true;

    snapShowMarkersFor([dstId]);
    alignHint.textContent = 'Snap — step 2: click target snap point  (Esc to cancel)';

  } else if (snapState.step === 2) {
    const pt = nearestSnapPt(cx, cy, null);
    if (!pt) return;
    const src = entities.find(e => e.id === snapState.srcEntityId);
    if (!src) { exitSnapAlignMode(); return; }

    pushUndo(snapState.srcEntityId!);

    if (snapState.srcNormal && pt.normal) {
      const ns = snapState.srcNormal;
      const nd = pt.normal;
      const targetDir = ns.dot(nd) >= 0 ? nd.clone() : nd.clone().negate();
      if (ns.distanceTo(targetDir) > 1e-6) {
        const q = new THREE.Quaternion().setFromUnitVectors(ns, targetDir);
        const offset = src.object.position.clone().sub(snapState.srcPt);
        offset.applyQuaternion(q);
        src.object.position.copy(snapState.srcPt).add(offset);
        src.object.quaternion.premultiply(q);
      }
    }
    src.object.position.add(pt.world.clone().sub(snapState.srcPt));

    updateHandle();
    for (const b of selectionBoxes) b.update();

    // reset to step 1 — rebuild markers for both selected objects in updated positions
    snapClearMarkers();
    snapState.step = 1;
    snapState.srcEntityId = null;
    snapShowMarkersFor([...selectedIds]);
    alignHint.textContent = 'Snap — step 1: click point on the object to move  (Esc to cancel)';
  }
}

btnSnapAlign.addEventListener('click', () =>
  snapState.active ? exitSnapAlignMode() : enterSnapAlignMode()
);

// ── ROTATE TOOL ────────────────────────────────────────────────────────────────
interface RotateCandidate {
  point: THREE.Vector3;
  dir:   THREE.Vector3;
  segA:  THREE.Vector3;
  segB:  THREE.Vector3;
}

let rotateCandidates: RotateCandidate[] = [];

const rotateState = {
  active:      false,
  step:        0 as 0 | 1 | 2,
  axis:        null as RotateCandidate | null,
  planeU:      new THREE.Vector3(),
  planeV:      new THREE.Vector3(),
  startAngle:  0,
  startPos:    new THREE.Vector3(),   // kept for single-entity compat
  startQuat:   new THREE.Quaternion(),
  isDragging:  false,
  startStates: new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>(),
};

function makeRotLine(color: number): THREE.Line {
  const positions = new Float32Array(6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geo,
    new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false }));
  line.renderOrder = 1001;
  line.visible = false;
  scene.add(line);
  return line;
}

function setRotLinePoints(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3): void {
  const pos = line.geometry.attributes.position as THREE.BufferAttribute;
  pos.setXYZ(0, a.x, a.y, a.z);
  pos.setXYZ(1, b.x, b.y, b.z);
  pos.needsUpdate = true;
}

const rotHoverLine = makeRotLine(0xffaa00);
const rotAxisLine  = makeRotLine(0xff6600);

function screenDistToSeg(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function buildRotateCandidates(): void {
  rotateCandidates = [];
  const MIN_LEN = 0.003;
  for (const entity of entities) {
    entity.object.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;

      const eg = new THREE.EdgesGeometry(mesh.geometry, 30);
      const pos = eg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 2) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i    ).applyMatrix4(mesh.matrixWorld);
        const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
        if (a.distanceTo(b) < MIN_LEN) continue;
        const dir   = b.clone().sub(a).normalize();
        const point = a.clone().lerp(b, 0.5);
        rotateCandidates.push({ point, dir, segA: a.clone(), segB: b.clone() });
      }
      eg.dispose();

      if (mesh.geometry.index) {
        for (const c of detectCircles(mesh)) {
          const EXT = 0.015;
          rotateCandidates.push({
            point: c.center,
            dir:   c.normal,
            segA:  c.center.clone().addScaledVector(c.normal, -EXT),
            segB:  c.center.clone().addScaledVector(c.normal,  EXT),
          });
        }
      }
    });
  }
}

function findNearestRotateCandidate(cx: number, cy: number): RotateCandidate | null {
  let best: RotateCandidate | null = null;
  let bestD = 15;
  for (const cand of rotateCandidates) {
    const sa = worldToScreen(cand.segA);
    const sb = worldToScreen(cand.segB);
    const d  = screenDistToSeg(sa.x, sa.y, sb.x, sb.y, cx, cy);
    if (d < bestD) { bestD = d; best = cand; }
  }
  return best;
}

function getAngleOnPlane(cx: number, cy: number): number | null {
  if (!rotateState.axis) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const nx =  ((cx - rect.left) / rect.width)  * 2 - 1;
  const ny = -((cy - rect.top)  / rect.height) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), getCamera());
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    rotateState.axis.dir, rotateState.axis.point);
  const pt = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, pt)) return null;
  const diff = pt.sub(rotateState.axis.point);
  return Math.atan2(diff.dot(rotateState.planeV), diff.dot(rotateState.planeU));
}

function updateRotateHover(cx: number, cy: number): void {
  if (!rotateState.active || rotateState.step !== 1) { rotHoverLine.visible = false; return; }
  const cand = findNearestRotateCandidate(cx, cy);
  if (cand) {
    setRotLinePoints(rotHoverLine, cand.segA, cand.segB);
    rotHoverLine.visible = true;
  } else {
    rotHoverLine.visible = false;
  }
}

function exitRotateMode(revert = false): void {
  if (!rotateState.active) return;
  if (revert) {
    for (const [id, start] of rotateState.startStates) {
      const en = entities.find(e => e.id === id);
      if (en) { en.object.position.copy(start.pos); en.object.quaternion.copy(start.quat); }
    }
    for (const b of selectionBoxes) b.update();
  }
  rotateState.active     = false;
  rotateState.step       = 0;
  rotateState.axis       = null;
  rotateState.isDragging = false;
  rotateState.startStates.clear();
  rotHoverLine.visible   = false;
  rotAxisLine.visible    = false;
  alignHint.style.display = 'none';
  btnRotate.classList.remove('active');
}

function handleRotateAxisClick(cx: number, cy: number): void {
  const cand = findNearestRotateCandidate(cx, cy);
  if (!cand) return;
  rotateState.axis = cand;
  rotateState.step = 2;

  const arb = Math.abs(cand.dir.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  rotateState.planeU.copy(arb).addScaledVector(cand.dir, -arb.dot(cand.dir)).normalize();
  rotateState.planeV.crossVectors(cand.dir, rotateState.planeU).normalize();

  const EXT = 0.05;
  setRotLinePoints(rotAxisLine,
    cand.segA.clone().addScaledVector(cand.dir, -EXT),
    cand.segB.clone().addScaledVector(cand.dir,  EXT),
  );
  rotAxisLine.visible  = true;
  rotHoverLine.visible = false;
  alignHint.textContent = `Rotate — drag to rotate, Shift = ${Math.round(rotateSnapStep * 180 / Math.PI)}° snap  ·  Enter = confirm  ·  Esc = cancel`;
}

function enterRotateMode(): void {
  if (selectedIds.size === 0) return;
  exitAlignMode();
  exitSnapAlignMode();
  rotateState.active     = true;
  rotateState.step       = 1;
  rotateState.axis       = null;
  rotateState.isDragging = false;
  buildRotateCandidates();
  alignHint.textContent   = 'Rotate — hover an edge or hole, click to set axis  ·  Esc = cancel';
  alignHint.style.display = 'block';
  btnRotate.classList.add('active');
}

// Rotate drag — pointerdown (capture, fires before handle-drag handler)
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !rotateState.active || rotateState.step !== 2 || rotateState.isDragging) return;
  if (selectedIds.size === 0) return;
  const angle = getAngleOnPlane(e.clientX, e.clientY);
  if (angle === null) return;

  rotateState.startStates.clear();
  for (const id of selectedIds) {
    const en = entities.find(en => en.id === id);
    if (en && !en.locked) {
      pushUndo(id);
      rotateState.startStates.set(id, { pos: en.object.position.clone(), quat: en.object.quaternion.clone() });
    }
  }
  if (rotateState.startStates.size === 0) return;

  rotateState.startAngle = angle;
  rotateState.isDragging = true;
  dragHandled = true;
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
}, { capture: true });

btnRotate.addEventListener('click', () =>
  rotateState.active ? exitRotateMode() : enterRotateMode()
);

// ── RAYCASTING ───────────────────────────────────────────────────────────────
function getEntityByObject(object: THREE.Object3D): Entity | undefined {
  return entities.find(e => {
    let o: THREE.Object3D | null = object;
    while (o) { if (o === e.object) return true; o = o.parent; }
    return false;
  });
}

function castMain(clientX: number, clientY: number): Entity | undefined {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((clientY - rect.top)  / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, getCamera());
  const meshes: THREE.Mesh[] = [];
  entities.forEach(en => en.object.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); }));
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length > 0 ? getEntityByObject(hits[0].object) : undefined;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 0) { pointerDownX = e.clientX; pointerDownY = e.clientY; }
  if (e.button === 2) { rmbDownX = e.clientX; rmbDownY = e.clientY; }
});

renderer.domElement.addEventListener('click', (e) => {
  if (dragHandled) { dragHandled = false; return; }
  const dx = e.clientX - pointerDownX, dy = e.clientY - pointerDownY;
  if (dx * dx + dy * dy > 25) return; // ignore if mouse moved >5px (camera drag)
  if (contextMenu.style.display === 'block') return;
  if (handleCubeClick(e.clientX, e.clientY)) return;
  if (rotateState.active) {
    if (rotateState.step === 1) handleRotateAxisClick(e.clientX, e.clientY);
    return;
  }
  if (snapState.active)  { handleSnapAlignClick(e.clientX, e.clientY); return; }
  if (alignState.active) { handleAlignClick(e.clientX, e.clientY); return; }
  selectEntity((castMain(e.clientX, e.clientY) ?? null)?.id ?? null, e.ctrlKey);
});

renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const dx = e.clientX - rmbDownX, dy = e.clientY - rmbDownY;
  if (dx * dx + dy * dy > 25) return;
  if (handleCubeClick(e.clientX, e.clientY)) return;
  const entity = castMain(e.clientX, e.clientY);
  if (entity) showContextMenu(e.clientX, e.clientY, entity.id);
});

// ── GROUPS ───────────────────────────────────────────────────────────────────
function renderGroupList(): void {
  groupListEl.innerHTML = '';
  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'conid-empty';
    empty.textContent = 'No groups';
    groupListEl.appendChild(empty);
    return;
  }
  for (const grp of groups) {
    const alive = grp.entityIds.filter(id => entities.find(e => e.id === id));
    const item = document.createElement('div');
    item.className = 'group-item';
    item.textContent = `${grp.name}  (${alive.length})`;
    item.addEventListener('click', (e) => {
      if (e.ctrlKey) {
        for (const id of alive) selectEntity(id, true);
      } else {
        selectEntity(null);
        for (const id of alive) selectEntity(id, true);
      }
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      showGroupContextMenu(e.clientX, e.clientY, grp.id);
    });
    groupListEl.appendChild(item);
  }
}

let groupContextTargetId: string | null = null;

function showGroupContextMenu(x: number, y: number, groupId: string): void {
  groupContextTargetId = groupId;
  groupContextMenu.style.left = x + 'px';
  groupContextMenu.style.top  = y + 'px';
  groupContextMenu.style.display = 'block';
  const r = groupContextMenu.getBoundingClientRect();
  if (r.right  > window.innerWidth)  groupContextMenu.style.left = (x - r.width)  + 'px';
  if (r.bottom > window.innerHeight) groupContextMenu.style.top  = (y - r.height) + 'px';
}

function hideGroupContextMenu(): void {
  groupContextMenu.style.display = 'none';
  groupContextTargetId = null;
}

function startInlineGroupName(
  onConfirm: (name: string) => void,
  initialValue = '',
): void {
  groupListEl.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:4px 8px;';
  const input = document.createElement('input');
  input.type  = 'text';
  input.value = initialValue;
  input.style.cssText = 'width:100%;padding:3px 6px;background:#1e1e1e;border:1px solid #0e639c;color:#ccc;border-radius:3px;font-size:12px;outline:none;box-sizing:border-box;';
  wrapper.appendChild(input);
  groupListEl.appendChild(wrapper);
  input.focus();
  input.select();

  const finish = (commit: boolean) => {
    const val = input.value.trim();
    if (commit && val) onConfirm(val);
    renderGroupList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); finish(true);  }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(false));
}

btnNewGroup.addEventListener('click', () => {
  if (selectedIds.size === 0) return;
  const ids = [...selectedIds];
  startInlineGroupName((name) => {
    groups.push({ id: generateId(), name, entityIds: ids });
  });
});

grpCtxRename.addEventListener('click', () => {
  const grp = groups.find(g => g.id === groupContextTargetId);
  hideGroupContextMenu();
  if (!grp) return;
  startInlineGroupName((name) => { grp.name = name; }, grp.name);
});

grpCtxDelete.addEventListener('click', () => {
  groups = groups.filter(g => g.id !== groupContextTargetId);
  renderGroupList();
  hideGroupContextMenu();
});

document.addEventListener('pointerdown', (e) => {
  if (groupContextMenu.style.display === 'block' && !groupContextMenu.contains(e.target as Node))
    hideGroupContextMenu();
});

// ── CONID VISUALIZATION ───────────────────────────────────────────────────────
const CONID_COLORS = [
  0xff3b3b, // red
  0x3bff5a, // green
  0x3b9eff, // blue
  0xffa63b, // orange
  0xd43bff, // purple
  0x3bfff0, // cyan
  0xffee3b, // yellow
  0xff3bb5, // pink
];

const conIdVizObjects: THREE.Object3D[] = [];

type HighlightEntry = { mesh: THREE.Mesh; matIndex: number | null; origMat: THREE.Material };
const conIdHighlights: HighlightEntry[] = [];

function clearConIdHighlights(): void {
  for (const { mesh, matIndex, origMat } of conIdHighlights) {
    if (matIndex === null) mesh.material = origMat;
    else (mesh.material as THREE.Material[])[matIndex] = origMat;
  }
  conIdHighlights.length = 0;
}

function highlightConnectorMesh(entity: Entity, refDes: string, color: number): void {
  const node = entity.object.getObjectByName(refDes);
  if (!node) return;
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (Array.isArray(child.material)) {
      child.material.forEach((mat, i) => {
        const m = mat as THREE.MeshStandardMaterial;
        if (!m.emissive) return;
        const clone = m.clone() as THREE.MeshStandardMaterial;
        clone.emissive.set(color);
        clone.emissiveIntensity = 0.7;
        conIdHighlights.push({ mesh: child, matIndex: i, origMat: mat });
        (child.material as THREE.Material[])[i] = clone;
      });
    } else {
      const m = child.material as THREE.MeshStandardMaterial;
      if (!m.emissive) return;
      const clone = m.clone() as THREE.MeshStandardMaterial;
      clone.emissive.set(color);
      clone.emissiveIntensity = 0.7;
      conIdHighlights.push({ mesh: child, matIndex: null, origMat: child.material });
      child.material = clone;
    }
  });
}

function clearConIdViz(): void {
  for (const o of conIdVizObjects) scene.remove(o);
  conIdVizObjects.length = 0;
  clearConIdHighlights();
}

function getConnectorWorldPos(entity: Entity, connector: ConnectorInfo): THREE.Vector3 {
  entity.object.updateMatrixWorld();
  // Eagle mm → Three.js local: X stays X, Eagle Y → Three.js -Z, Y≈0 is board plane
  const local = new THREE.Vector3(connector.x / 1000, 0.003, -connector.y / 1000);
  return local.applyMatrix4(entity.object.matrixWorld);
}

function mstEdges(pts: THREE.Vector3[]): Array<[number, number]> {
  if (pts.length < 2) return [];
  const inTree = new Set([0]);
  const edges: Array<[number, number]> = [];
  while (inTree.size < pts.length) {
    let best = Infinity, bi = -1, bj = -1;
    for (const i of inTree) {
      for (let j = 0; j < pts.length; j++) {
        if (inTree.has(j)) continue;
        const d = pts[i].distanceTo(pts[j]);
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    if (bj === -1) break;
    edges.push([bi, bj]);
    inTree.add(bj);
  }
  return edges;
}

function showSingleConIdViz(conId: string, color: number): void {
  const refs = conIdRegistry.get(conId);
  if (!refs) return;

  const pts: THREE.Vector3[] = [];
  for (const ref of refs) {
    const entity = entities.find(e => e.id === ref.entityId);
    if (!entity?.connectors) continue;
    const conn = entity.connectors.find(c => c.conId === conId && c.refDes === ref.refDes);
    if (!conn) continue;
    pts.push(getConnectorWorldPos(entity, conn));
    highlightConnectorMesh(entity, ref.refDes, color);
  }
  if (pts.length === 0) return;

  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const geo = new THREE.SphereGeometry(0.0008, 8, 6);
  for (const pt of pts) {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pt);
    m.renderOrder = 999;
    scene.add(m);
    conIdVizObjects.push(m);
  }

  const lineMat = new THREE.LineBasicMaterial({ color, depthTest: false });
  for (const [i, j] of mstEdges(pts)) {
    const lineGeo = new THREE.BufferGeometry().setFromPoints([pts[i], pts[j]]);
    const line = new THREE.Line(lineGeo, lineMat);
    line.renderOrder = 999;
    scene.add(line);
    conIdVizObjects.push(line);
  }
}

function refreshConIdViz(): void {
  clearConIdViz();
  for (const [conId, colorIdx] of selectedConIds) {
    showSingleConIdViz(conId, CONID_COLORS[colorIdx % CONID_COLORS.length]);
  }
}

// ── CONID REGISTRY ───────────────────────────────────────────────────────────
const conIdRegistry = new Map<string, Array<{ entityId: string; refDes: string }>>();
const selectedConIds = new Map<string, number>(); // conId → color index

function nextColorIdx(): number {
  const used = new Set(selectedConIds.values());
  for (let i = 0; ; i++) if (!used.has(i)) return i;
}

function registerConIds(entity: Entity): void {
  if (!entity.connectors) return;
  for (const c of entity.connectors) {
    if (!conIdRegistry.has(c.conId)) conIdRegistry.set(c.conId, []);
    conIdRegistry.get(c.conId)!.push({ entityId: entity.id, refDes: c.refDes });
  }
  renderConIdList();
}

function unregisterConIds(entityId: string): void {
  for (const [key, arr] of conIdRegistry) {
    const filtered = arr.filter(a => a.entityId !== entityId);
    if (filtered.length === 0) { conIdRegistry.delete(key); selectedConIds.delete(key); }
    else conIdRegistry.set(key, filtered);
  }
  if (selectedConIds.size === 0) clearConIdViz(); else refreshConIdViz();
  renderConIdList();
}

function flyToConId(conId: string): void {
  const refs = conIdRegistry.get(conId);
  if (!refs) return;
  const pts: THREE.Vector3[] = [];
  for (const ref of refs) {
    const entity = entities.find(e => e.id === ref.entityId);
    if (!entity?.connectors) continue;
    const conn = entity.connectors.find(c => c.conId === conId && c.refDes === ref.refDes);
    if (conn) pts.push(getConnectorWorldPos(entity, conn));
  }
  if (pts.length === 0) return;
  const center = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
  const maxDist = Math.max(...pts.map(p => p.distanceTo(center)), 0.01);
  const dist = maxDist * 4 + 0.05;
  const dir = perspCamera.position.clone().sub(controls.target).normalize();
  const toPos = center.clone().addScaledVector(dir, dist);
  startAnim(toPos, center, perspCamera.up.clone());
}

let conIdClickTimer: ReturnType<typeof setTimeout> | null = null;

function renderConIdList(): void {
  conIdListEl.innerHTML = '';
  if (conIdRegistry.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'conid-empty';
    empty.textContent = 'No connections found';
    conIdListEl.appendChild(empty);
    return;
  }
  const sorted = [...conIdRegistry.keys()].sort();
  for (const conId of sorted) {
    const refs    = conIdRegistry.get(conId)!;
    const colorIdx = selectedConIds.get(conId);
    const isSelected = colorIdx !== undefined;
    const item = document.createElement('div');
    item.className = 'conid-item' + (isSelected ? ' selected' : '');
    item.title = refs.map(r => r.refDes).join(', ');

    if (isSelected) {
      const dot = document.createElement('span');
      dot.className = 'conid-dot';
      dot.style.background = '#' + CONID_COLORS[colorIdx % CONID_COLORS.length].toString(16).padStart(6, '0');
      item.appendChild(dot);
    }
    const label = document.createElement('span');
    label.textContent = conId + (refs.length > 1 ? ` (${refs.length})` : '');
    item.appendChild(label);

    item.addEventListener('click', (e) => {
      if (conIdClickTimer) return;
      conIdClickTimer = setTimeout(() => {
        conIdClickTimer = null;
        if (e.ctrlKey || e.metaKey) {
          if (isSelected) selectedConIds.delete(conId);
          else selectedConIds.set(conId, nextColorIdx());
        } else {
          selectedConIds.clear();
          if (!isSelected) selectedConIds.set(conId, 0);
        }
        if (selectedConIds.size > 0) refreshConIdViz(); else clearConIdViz();
        renderConIdList();
      }, 220);
    });
    item.addEventListener('dblclick', () => {
      if (conIdClickTimer) { clearTimeout(conIdClickTimer); conIdClickTimer = null; }
      if (!isSelected) selectedConIds.set(conId, selectedConIds.size === 0 ? 0 : nextColorIdx());
      refreshConIdViz();
      renderConIdList();
      flyToConId(conId);
    });
    conIdListEl.appendChild(item);
  }
}

// ── BRD PARSER ───────────────────────────────────────────────────────────────
interface BrdParseResult {
  widthMm:    number;
  heightMm:   number;
  minX:       number;
  minY:       number;
  connectors: ConnectorInfo[];
}

function parseBrd(xmlContent: string): BrdParseResult {
  const doc = new DOMParser().parseFromString(xmlContent, 'text/xml');

  // Board outline from layer 20 wires → bounding box → dimensions
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const wires = doc.querySelectorAll('wire[layer="20"]');
  for (const w of wires) {
    const x1 = parseFloat(w.getAttribute('x1') ?? '0');
    const y1 = parseFloat(w.getAttribute('y1') ?? '0');
    const x2 = parseFloat(w.getAttribute('x2') ?? '0');
    const y2 = parseFloat(w.getAttribute('y2') ?? '0');
    minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
  }
  const widthMm  = isFinite(maxX - minX) ? maxX - minX : 50;
  const heightMm = isFinite(maxY - minY) ? maxY - minY : 30;

  // Build signal→pin map: signal name → Map<refDes, Set<pin>>
  const signalPins = new Map<string, Map<string, string>>();
  for (const sig of doc.querySelectorAll('signal')) {
    const sigName = sig.getAttribute('name') ?? '';
    for (const cr of sig.querySelectorAll('contactref')) {
      const ref = cr.getAttribute('element') ?? '';
      const pin = cr.getAttribute('pad')     ?? '';
      if (!signalPins.has(sigName)) signalPins.set(sigName, new Map());
      signalPins.get(sigName)!.set(ref + ':' + pin, pin);
    }
  }

  // Build per-element pin→signal lookup
  const elementPins = new Map<string, Array<{ pin: string; signal: string }>>();
  for (const [sigName, refs] of signalPins) {
    for (const [refPin] of refs) {
      const [ref, pin] = refPin.split(':');
      if (!elementPins.has(ref)) elementPins.set(ref, []);
      elementPins.get(ref)!.push({ pin, signal: sigName });
    }
  }

  // Extract elements with CONID attribute.
  // Eagle stores user attributes as child <attribute name="CONID" value="..."/> elements.
  const connectors: ConnectorInfo[] = [];
  for (const el of doc.querySelectorAll('element')) {
    // Check both: direct XML attribute (rare) and child <attribute> element (common)
    let conIdAttr = el.getAttribute('CONID') ?? el.getAttribute('conid');
    if (!conIdAttr) {
      const childAttr = [...el.querySelectorAll('attribute')].find(
        a => (a.getAttribute('name') ?? '').toUpperCase() === 'CONID'
      );
      conIdAttr = childAttr?.getAttribute('value') ?? null;
    }
    if (!conIdAttr) continue;
    const refDes = el.getAttribute('name') ?? '';
    const x      = parseFloat(el.getAttribute('x') ?? '0');
    const y      = parseFloat(el.getAttribute('y') ?? '0');
    const rot    = el.getAttribute('rot') ?? '';
    const layer: 'top' | 'bottom' = rot.startsWith('M') ? 'bottom' : 'top';
    const pins   = elementPins.get(refDes) ?? [];
    connectors.push({ refDes, conId: conIdAttr, x, y, layer, pins });
  }

  return { widthMm, heightMm, minX: isFinite(minX) ? minX : 0, minY: isFinite(minY) ? minY : 0, connectors };
}

// ── EDGE LINES ────────────────────────────────────────────────────────────────
function addEdges(object: THREE.Object3D): void {
  object.updateMatrixWorld(true);
  const invRoot = object.matrixWorld.clone().invert();
  const geoms: THREE.BufferGeometry[] = [];

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const eg = new THREE.EdgesGeometry(child.geometry, 15);
    eg.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invRoot, child.matrixWorld));
    geoms.push(eg);
  });

  if (geoms.length === 0) return;
  const merged = mergeGeometries(geoms, false);
  geoms.forEach(g => g.dispose());
  if (merged) {
    object.add(new THREE.LineSegments(merged, new THREE.LineBasicMaterial({ color: 0x000000 })));
  }
}

// ── PLACEHOLDER (green PCB box) ───────────────────────────────────────────────
function makePlaceholder(widthMm: number, heightMm: number): THREE.Object3D {
  const W = widthMm  / 1000;
  const H = heightMm / 1000;
  const T = 0.0016; // 1.6 mm PCB thickness
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(W, T, H),
    new THREE.MeshBasicMaterial({ color: 0x1a7a1a, transparent: true, opacity: 0.85 }),
  );
  mesh.position.y = T / 2;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

// ── IMPORT BRD ───────────────────────────────────────────────────────────────
async function importBrd(): Promise<void> {
  const result = await window.kondor.openBrd();
  if (!result) return;
  const { brdPath, brdContent, brdMtime, glbPath } = result;

  const parsed = parseBrd(brdContent);
  const name   = brdPath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');

  function finishImport(object: THREE.Object3D): void {
    addEdges(object);
    scene.add(object);
    const entity: Entity = {
      id:         generateId(),
      name,
      object,
      locked:        false,
      brdPath,
      brdMtime,
      modified:      false,
      connectors:    parsed.connectors,
      boardMinX:     parsed.minX,
      boardMinY:     parsed.minY,
      boardWidthMm:  parsed.widthMm,
      boardHeightMm: parsed.heightMm,
    };
    entities.push(entity);
    registerConIds(entity);
    selectEntity(entity.id);
    renderList();
    fitCamera(object);
  }

  if (glbPath) {
    loader.load(
      'file:///' + glbPath.replace(/\\/g, '/'),
      (gltf) => finishImport(gltf.scene),
      undefined,
      (err) => {
        console.error('Failed to load GLB:', err);
        finishImport(makePlaceholder(parsed.widthMm, parsed.heightMm));
      },
    );
  } else {
    finishImport(makePlaceholder(parsed.widthMm, parsed.heightMm));
  }
}

// ── UPDATE BOARD ─────────────────────────────────────────────────────────────
async function updateBoard(entityId: string): Promise<void> {
  const entity = entities.find(e => e.id === entityId);
  if (!entity?.brdPath) return;

  ctxUpdateBoard.textContent = 'Updating…';
  const res = await window.kondor.updateBoard(entity.brdPath);
  ctxUpdateBoard.textContent = 'Update to latest';

  if (!res.ok) { alert('Update failed: ' + res.error); return; }
  if (!res.glbPath) return;

  const savedPos = entity.object.position.clone();
  const savedQuat = entity.object.quaternion.clone();

  loader.load(
    'file:///' + res.glbPath.replace(/\\/g, '/'),
    (gltf) => {
      scene.remove(entity.object);
      entity.object = gltf.scene;
      addEdges(entity.object);
      entity.object.position.copy(savedPos);
      entity.object.quaternion.copy(savedQuat);
      entity.modified = false;
      if (res.brdContent) {
        unregisterConIds(entityId);
        const parsed = parseBrd(res.brdContent);
        entity.connectors    = parsed.connectors;
        entity.boardMinX     = parsed.minX;
        entity.boardMinY     = parsed.minY;
        entity.boardWidthMm  = parsed.widthMm;
        entity.boardHeightMm = parsed.heightMm;
        entity.brdMtime      = res.brdMtime;
        registerConIds(entity);
        if (selectedConIds.size > 0) refreshConIdViz();
      }
      scene.add(entity.object);
      updateSelectionBoxes();
      updateHandle();
      renderList();
    },
    undefined,
    (err) => console.error('Failed to reload GLB:', err),
  );
}

// Context menu: Edit board / Update to latest
ctxEditBoard.addEventListener('click', async () => {
  if (!contextTargetId) return;
  const entity = entities.find(e => e.id === contextTargetId);
  if (entity?.brdPath) {
    const r = await window.kondor.openInEagle(entity.brdPath);
    if (!r.ok) alert('Could not open Eagle: ' + r.error);
  }
  hideContextMenu();
});

ctxSetColor.addEventListener('click', () => {
  const id = contextTargetId;
  const x = parseInt(contextMenu.style.left);
  const y = parseInt(contextMenu.style.top);
  hideContextMenu();
  if (id) showColorPicker(x, y, id);
});

ctxUpdateBoard.addEventListener('click', () => {
  const id = contextTargetId;
  hideContextMenu();
  if (!id) return;
  const entity = entities.find(e => e.id === id);
  if (entity?.brdPath) updateBoard(id);
  else if (entity?.glbPath) reloadGlb(id);
});

async function reloadGlb(entityId: string): Promise<void> {
  const entity = entities.find(e => e.id === entityId);
  if (!entity?.glbPath) return;
  const savedPos  = entity.object.position.clone();
  const savedQuat = entity.object.quaternion.clone();
  loader.load(
    'file:///' + entity.glbPath.replace(/\\/g, '/'),
    (gltf) => {
      scene.remove(entity.object);
      entity.object = gltf.scene;
      addEdges(entity.object);
      entity.object.position.copy(savedPos);
      entity.object.quaternion.copy(savedQuat);
      entity.modified = false;
      if (entity.color) applyEntityColor(entity, entity.color);
      scene.add(entity.object);
      updateSelectionBoxes();
      updateHandle();
      renderList();
    },
    undefined,
    (err) => console.error('Failed to reload GLB:', err),
  );
}

// ── BRD FILE-CHANGE LISTENER ──────────────────────────────────────────────────
window.kondor.onBrdModified((brdPath: string) => {
  const entity = entities.find(e => e.brdPath === brdPath);
  if (!entity) return;
  entity.modified = true;
  renderList();
});

// ── GLB FILE-CHANGE LISTENER ──────────────────────────────────────────────────
window.kondor.onGlbModified((glbPath: string) => {
  const entity = entities.find(e => e.glbPath === glbPath && !e.brdPath);
  if (!entity) return;
  entity.modified = true;
  renderList();
});

// ── CONNECTION BUTLER INTEGRATION ────────────────────────────────────────────
window.kondor.onShowConId((conId: string) => {
  if (!selectedConIds.has(conId)) {
    selectedConIds.set(conId, selectedConIds.size === 0 ? 0 : nextColorIdx());
  }
  refreshConIdViz();
  renderConIdList();
  flyToConId(conId);
});

window.kondor.onShowBoard((entityId: string) => {
  selectEntity(entityId);
  const entity = entities.find(e => e.id === entityId);
  if (entity) fitCamera(entity.object);
});

async function openConBut(): Promise<void> {
  const boards = entities
    .filter(e => e.brdPath)
    .map(e => ({ id: e.id, name: e.name, brdPath: e.brdPath! }));
  const layout = await window.kondor.getConButLayout();
  await window.kondor.openConBut(boards, layout);
}

// ── FILE MENU ─────────────────────────────────────────────────────────────────
const DEFAULT_EAGLECON_CMD = "run export3D_raw.ulp '400'; UNDO; QUIT";

function openFileMenu(): void {
  const r = btnFile.getBoundingClientRect();
  fileMenuEl.style.left = r.left + 'px';
  fileMenuEl.style.top  = r.bottom + 2 + 'px';
  fileMenuEl.classList.add('open');
  btnFile.classList.add('open');
}

function closeFileMenu(): void {
  fileMenuEl.classList.remove('open');
  btnFile.classList.remove('open');
}

btnFile.addEventListener('click', (e) => {
  e.stopPropagation();
  fileMenuEl.classList.contains('open') ? closeFileMenu() : openFileMenu();
});

document.addEventListener('pointerdown', (e) => {
  if (fileMenuEl.classList.contains('open') && !fileMenuEl.contains(e.target as Node) && e.target !== btnFile) {
    closeFileMenu();
  }
});

const fileNewDevice  = document.getElementById('file-new-device')!;
const fileLoadDevice = document.getElementById('file-load-device')!;
const fileSaveDevice   = document.getElementById('file-save-device')!;
const fileSaveDeviceAs = document.getElementById('file-save-device-as')!;

fileNewDevice.addEventListener('click',  () => { closeFileMenu(); newDevice(); });
fileLoadDevice.addEventListener('click', () => { closeFileMenu(); openDevice(); });
fileSaveDevice.addEventListener('click',   () => { closeFileMenu(); saveDevice(); });
fileSaveDeviceAs.addEventListener('click', () => { closeFileMenu(); saveDevice(true); });
fileImport3d.addEventListener('click',   () => { closeFileMenu(); addModel(); });
fileImportBrd.addEventListener('click',  () => { closeFileMenu(); importBrd(); });
fileOpenConBut.addEventListener('click', () => { closeFileMenu(); openConBut(); });
fileExportScene.addEventListener('click', () => { closeFileMenu(); exportSceneGlb(); });
inputLightIntensity.addEventListener('input', () => {
  const v = parseFloat(inputLightIntensity.value);
  lightIntensityVal.textContent = v.toFixed(2);
  applyLightIntensity(v);
});

function exportSceneGlb(): void {
  const group = new THREE.Group();
  for (const entity of entities) {
    group.add(entity.object.clone());
  }
  new GLTFExporter().parse(
    group,
    (result) => {
      const buf = result as ArrayBuffer;
      window.kondor.exportScene(buf).then(res => {
        if (!res.ok && res.error) console.error('Export failed:', res.error);
      });
    },
    (err) => console.error('GLTFExporter error:', err),
    { binary: true }
  );
}

fileSettings.addEventListener('click', async () => {
  closeFileMenu();
  const settings = await window.kondor.getSettings();
  inputEaglePath.value        = settings.eagleBinPath      ?? '';
  inputEagleconCmd.value      = settings.eagleconCmd       ?? DEFAULT_EAGLECON_CMD;
  inputSnapMinRadius.value    = settings.snapMinHoleMm     ?? '2';
  inputTranslateStep.value    = settings.translateStepMm   ?? '1';
  inputRotateStep.value       = settings.rotateStepDeg     ?? '15';
  inputLightIntensity.value   = settings.lightIntensity    ?? String(lightIntensity);
  lightIntensityVal.textContent = parseFloat(inputLightIntensity.value).toFixed(2);
  settingsOverlay.classList.add('open');
});

// ── SETTINGS ─────────────────────────────────────────────────────────────────
btnRestoreCmd.addEventListener('click', () => {
  inputEagleconCmd.value = DEFAULT_EAGLECON_CMD;
});

btnSettingsCancel.addEventListener('click', () => {
  settingsOverlay.classList.remove('open');
});

btnSettingsSave.addEventListener('click', async () => {
  const snapMm   = Math.max(0.1, parseFloat(inputSnapMinRadius.value)  || 2);
  const transMm  = Math.max(0.01, parseFloat(inputTranslateStep.value) || 1);
  const rotDeg   = Math.max(1,   parseFloat(inputRotateStep.value)     || 15);
  const lightV   = Math.min(1, Math.max(0.1, parseFloat(inputLightIntensity.value) || 0.4));
  snapMinHoleRadius = snapMm  / 1000;
  translateSnapStep = transMm / 1000;
  rotateSnapStep    = rotDeg  * Math.PI / 180;
  lightIntensity    = lightV;
  applyLightIntensity(lightV);
  await window.kondor.setSettings({
    eagleBinPath:     inputEaglePath.value.trim(),
    eagleconCmd:      inputEagleconCmd.value.trim() || DEFAULT_EAGLECON_CMD,
    snapMinHoleMm:    String(snapMm),
    translateStepMm:  String(transMm),
    rotateStepDeg:    String(rotDeg),
    lightIntensity:   String(lightV),
  });
  settingsOverlay.classList.remove('open');
});

settingsOverlay.addEventListener('pointerdown', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove('open');
});

// ── DEVICE SAVE / LOAD ───────────────────────────────────────────────────────
interface KDevEntity {
  name: string;
  brdPath?: string;
  glbPath?: string;
  position:   [number, number, number];
  quaternion: [number, number, number, number];
  locked: boolean;
  hidden?: boolean;
  color?: string;
  boardMinX?: number;
  boardMinY?: number;
  boardWidthMm?: number;
  boardHeightMm?: number;
}
interface KDevGroup { name: string; entityIndices: number[]; }
interface KDevFile { version: 1; entities: KDevEntity[]; groups?: KDevGroup[]; conbutLayout?: unknown; }

let currentDevicePath: string | null = null;

async function serializeDevice(): Promise<string> {
  const conbutLayout = await window.kondor.getConButLayout();
  const kdev: KDevFile = {
    version: 1,
    entities: entities.map(e => ({
      name:       e.name,
      brdPath:    e.brdPath,
      glbPath:    e.brdPath ? undefined : e.glbPath,
      position:   [e.object.position.x, e.object.position.y, e.object.position.z],
      quaternion: [e.object.quaternion.x, e.object.quaternion.y, e.object.quaternion.z, e.object.quaternion.w],
      locked:       e.locked,
      hidden:       e.hidden,
      color:        e.color,
      boardMinX:    e.boardMinX,
      boardMinY:    e.boardMinY,
      boardWidthMm: e.boardWidthMm,
      boardHeightMm: e.boardHeightMm,
    })),
    groups: groups.map(g => ({
      name: g.name,
      entityIndices: g.entityIds
        .map(id => entities.findIndex(e => e.id === id))
        .filter(i => i >= 0),
    })),
    conbutLayout,
  };
  return JSON.stringify(kdev, null, 2);
}

function loadGlbAsync(glbPath: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    loader.load('file:///' + glbPath.replace(/\\/g, '/'), g => resolve(g.scene), undefined, reject);
  });
}

async function restoreDevice(kdev: KDevFile): Promise<void> {
  for (const e of [...entities]) deleteEntity(e.id);

  for (const entry of kdev.entities) {
    let object: THREE.Object3D | null = null;
    let connectors: ConnectorInfo[]   = [];
    let brdMtime: number | undefined;

    if (entry.brdPath) {
      const brd = await window.kondor.loadBrd(entry.brdPath);
      if (brd) {
        const parsed = parseBrd(brd.brdContent);
        connectors   = parsed.connectors;
        brdMtime     = brd.brdMtime;
        try {
          object = brd.glbPath ? await loadGlbAsync(brd.glbPath) : makePlaceholder(parsed.widthMm, parsed.heightMm);
        } catch {
          object = makePlaceholder(parsed.widthMm, parsed.heightMm);
        }
      }
    } else if (entry.glbPath) {
      try { object = await loadGlbAsync(entry.glbPath); } catch { /* skip */ }
    }

    if (!object) continue;

    addEdges(object);
    object.position.set(...entry.position);
    object.quaternion.set(...entry.quaternion);
    scene.add(object);

    const entity: Entity = {
      id:         generateId(),
      name:       entry.name,
      object,
      locked:     entry.locked,
      brdPath:    entry.brdPath,
      glbPath:    entry.glbPath,
      brdMtime,
      modified:   false,
      color:         entry.color,
      connectors,
      boardMinX:     entry.boardMinX,
      boardMinY:     entry.boardMinY,
      boardWidthMm:  entry.boardWidthMm,
      boardHeightMm: entry.boardHeightMm,
    };
    entities.push(entity);
    registerConIds(entity);
    if (entry.hidden) setEntityVisible(entity, false);
    if (entity.color) applyEntityColor(entity, entity.color);
    if (entity.glbPath && !entity.brdPath) window.kondor.watchGlb(entity.glbPath);
  }

  groups = (kdev.groups ?? []).map(g => ({
    id: generateId(),
    name: g.name,
    entityIds: (g.entityIndices ?? [])
      .filter(i => i >= 0 && i < entities.length)
      .map(i => entities[i].id),
  })).filter(g => g.entityIds.length > 0);
  renderGroupList();
  selectEntity(null);
  renderList();
}

async function saveDevice(saveAs = false): Promise<void> {
  const data   = await serializeDevice();
  const path   = saveAs ? undefined : currentDevicePath ?? undefined;
  const res    = await window.kondor.saveDevice(data, path);
  if (res?.ok && res.filePath) {
    currentDevicePath = res.filePath;
    const settings = await window.kondor.getSettings();
    await window.kondor.setSettings({ ...settings, lastDevicePath: res.filePath });
  }
}

async function openDevice(): Promise<void> {
  const res = await window.kondor.loadDevice();
  if (!res?.ok || !res.data || !res.filePath) return;
  try {
    await restoreDevice(JSON.parse(res.data) as KDevFile);
    currentDevicePath = res.filePath;
    const settings = await window.kondor.getSettings();
    await window.kondor.setSettings({ ...settings, lastDevicePath: res.filePath });
  } catch (e) { alert('Failed to load device: ' + e); }
}

function newDevice(): void {
  if (entities.length > 0 && !confirm('Close current device without saving?')) return;
  for (const e of [...entities]) deleteEntity(e.id);
  clearConIdViz();
  selectedConIds.clear();
  currentDevicePath = null;
  rotSnapAxis       = null;
  exitRotateMode();
  undoStack.length  = 0;
  redoStack.length  = 0;
  groups = [];
  renderGroupList();
}

// ── ADD MODEL ────────────────────────────────────────────────────────────────
async function addModel(): Promise<void> {
  const filePath = await window.kondor.openFile();
  if (!filePath) return;
  const name = filePath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
  loader.load(
    'file:///' + filePath.replace(/\\/g, '/'),
    (gltf) => {
      const object = gltf.scene;
      addEdges(object);
      scene.add(object);
      const entity: Entity = { id: generateId(), name, object, locked: false, glbPath: filePath };
      entities.push(entity);
      window.kondor.watchGlb(filePath);
      selectEntity(entity.id);
      renderList();
      fitCamera(object);
    },
    undefined,
    (err) => console.error('Failed to load model:', err),
  );
}

function fitCamera(object: THREE.Object3D): void {
  const box    = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const dist   = (Math.max(size.x, size.y, size.z) / 2) / Math.tan((perspCamera.fov * Math.PI) / 360) * 1.8;
  perspCamera.position.copy(center).add(new THREE.Vector3(dist * 0.6, dist * 0.5, dist * 0.8));
  controls.target.copy(center);
  controls.update();
}


// ── RESIZE ───────────────────────────────────────────────────────────────────
new ResizeObserver(() => {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  perspCamera.aspect = w / h;
  perspCamera.updateProjectionMatrix();
  renderer.setSize(w, h);
}).observe(viewport);

// ── AUTO-RESTORE LAST DEVICE ─────────────────────────────────────────────────
(async () => {
  const settings = await window.kondor.getSettings();
  const storedMm = parseFloat(settings.snapMinHoleMm ?? '2');
  snapMinHoleRadius = (isFinite(storedMm) && storedMm > 0 ? storedMm : 2) / 1000;
  const storedTrans = parseFloat(settings.translateStepMm ?? '1');
  translateSnapStep = (isFinite(storedTrans) && storedTrans > 0 ? storedTrans : 1) / 1000;
  const storedRot = parseFloat(settings.rotateStepDeg ?? '15');
  rotateSnapStep = (isFinite(storedRot) && storedRot > 0 ? storedRot : 15) * Math.PI / 180;
  const storedLight = parseFloat(settings.lightIntensity ?? '0.4');
  lightIntensity = (isFinite(storedLight) && storedLight >= 0.1 && storedLight <= 1 ? storedLight : 0.4);
  applyLightIntensity(lightIntensity);
  const last = settings.lastDevicePath;
  if (!last) return;
  const res = await window.kondor.loadDeviceFile(last);
  if (!res.ok || !res.data) return;
  try {
    await restoreDevice(JSON.parse(res.data) as KDevFile);
    currentDevicePath = last;
  } catch { /* corrupt file — ignore */ }
})();

// ── TRANSLATION GIZMO ────────────────────────────────────────────────────────
type GizmoAxis = 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz';

const GIZMO_COLORS: Record<GizmoAxis, number> = {
  x: 0xff3333, y: 0x33ff33, z: 0x3399ff,
  xy: 0xffff44, xz: 0xff88ff, yz: 0x44ffff,
};

const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

// Arrow geometry in LOCAL space: total length = 1.
// Shaft occupies [0, 0.78], cone [0.78, 1.0].
function makeArrow(color: number): THREE.Object3D {
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 8), mat);
  shaft.position.y = 0.39;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 8), mat);
  cone.position.y = 0.89;
  g.add(shaft, cone);
  g.renderOrder = 500;
  g.visible = false;
  scene.add(g);
  return g;
}

function makeSquare(color: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.40,
      side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
  );
  m.renderOrder = 499;
  m.visible = false;
  scene.add(m);
  return m;
}

const gizmoMeshes: Partial<Record<GizmoAxis, THREE.Object3D>> = {};
gizmoMeshes.x  = makeArrow(GIZMO_COLORS.x);
gizmoMeshes.y  = makeArrow(GIZMO_COLORS.y);
gizmoMeshes.z  = makeArrow(GIZMO_COLORS.z);
gizmoMeshes.xy = makeSquare(GIZMO_COLORS.xy);
gizmoMeshes.xz = makeSquare(GIZMO_COLORS.xz);
gizmoMeshes.yz = makeSquare(GIZMO_COLORS.yz);

let hoveredGizmoAxis: GizmoAxis | null = null;

function applyGizmoHover(axis: GizmoAxis | null): void {
  if (axis === hoveredGizmoAxis) return;
  if (hoveredGizmoAxis !== null) {
    const orig = GIZMO_COLORS[hoveredGizmoAxis];
    const isPlane = hoveredGizmoAxis.length === 2;
    gizmoMeshes[hoveredGizmoAxis]?.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(orig);
      if (isPlane) mat.opacity = 0.40;
    });
  }
  hoveredGizmoAxis = axis;
  if (axis !== null) {
    const isPlane = axis.length === 2;
    gizmoMeshes[axis]?.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(0xffffff);
      if (isPlane) mat.opacity = 0.70;
    });
  }
}

const gizmoDrag = {
  active:           false,
  axis:             null as GizmoAxis | null,
  plane:            new THREE.Plane(),
  planeU:           new THREE.Vector3(),
  startWorld:       new THREE.Vector3(),
  startObjPositions: new Map<string, THREE.Vector3>(),
};

function getSelectionCenter(): THREE.Vector3 | null {
  if (selectedIds.size === 0) return null;
  const combined = new THREE.Box3();
  for (const id of selectedIds) {
    const ent = entities.find(e => e.id === id);
    if (ent) combined.expandByObject(ent.object);
  }
  return combined.isEmpty() ? null : combined.getCenter(new THREE.Vector3());
}

// Gizmo size scales with camera distance so it's always readable on screen.
function gizmoSize(): number {
  const center = getSelectionCenter();
  if (!center) return 0.05;
  return perspCamera.position.distanceTo(center) * 0.14;
}

function updateGizmo(): void {
  const primary = selectedId ? entities.find(e => e.id === selectedId) ?? null : null;
  const anyUnlocked = primary && [...selectedIds].some(id => {
    const e = entities.find(en => en.id === id); return e && !e.locked;
  });
  const show = !!anyUnlocked && !alignState.active && !snapState.active && !rotateState.active;

  if (!show) {
    for (const m of Object.values(gizmoMeshes)) if (m) m.visible = false;
    applyGizmoHover(null);
    return;
  }

  const s      = gizmoSize();
  const origin = getSelectionCenter()!;
  const q      = selectedIds.size === 1 ? primary!.object.quaternion : new THREE.Quaternion();

  const lx = _axisX.clone().applyQuaternion(q);
  const ly = _axisY.clone().applyQuaternion(q);
  const lz = _axisZ.clone().applyQuaternion(q);

  const placeArrow = (obj: THREE.Object3D, dir: THREE.Vector3) => {
    obj.position.copy(origin);
    obj.scale.setScalar(s);
    obj.quaternion.setFromUnitVectors(_axisY, dir.lengthSq() > 0 ? dir : _axisY);
    obj.visible = true;
  };
  placeArrow(gizmoMeshes.x!, lx);
  placeArrow(gizmoMeshes.y!, ly);
  placeArrow(gizmoMeshes.z!, lz);

  const SQ = 0.32;
  const placeSquare = (obj: THREE.Object3D, d1: THREE.Vector3, d2: THREE.Vector3, n: THREE.Vector3) => {
    obj.position.copy(origin).addScaledVector(d1, s * SQ).addScaledVector(d2, s * SQ);
    obj.scale.setScalar(s * SQ * 0.85);
    obj.quaternion.setFromUnitVectors(_axisZ, n.lengthSq() > 0 ? n : _axisZ);
    obj.visible = true;
  };
  placeSquare(gizmoMeshes.xy!, lx, ly, lz);
  placeSquare(gizmoMeshes.xz!, lx, lz, ly);
  placeSquare(gizmoMeshes.yz!, ly, lz, lx);
}

function hitTestGizmo(clientX: number, clientY: number): GizmoAxis | null {
  if (selectedIds.size === 0) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const nx =  ((clientX - rect.left) / rect.width)  * 2 - 1;
  const ny = -((clientY - rect.top)  / rect.height) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), getCamera());
  ray.params.Line = { threshold: 0.002 };

  const axes:   GizmoAxis[] = ['x', 'y', 'z'];
  const planes: GizmoAxis[] = ['xy', 'xz', 'yz'];

  for (const k of planes) {
    const m = gizmoMeshes[k];
    if (!m?.visible) continue;
    if (ray.intersectObject(m, true).length) return k;
  }
  for (const k of axes) {
    const m = gizmoMeshes[k];
    if (!m?.visible) continue;
    if (ray.intersectObject(m, true).length) return k;
  }
  return null;
}

function startGizmoDrag(axis: GizmoAxis, clientX: number, clientY: number): boolean {
  const primary = selectedId ? entities.find(e => e.id === selectedId) ?? null : null;
  if (!primary) return false;

  const q  = selectedIds.size === 1 ? primary.object.quaternion : new THREE.Quaternion();
  const lx = _axisX.clone().applyQuaternion(q);
  const ly = _axisY.clone().applyQuaternion(q);
  const lz = _axisZ.clone().applyQuaternion(q);

  let planeNormal: THREE.Vector3;
  let moveDir: THREE.Vector3 | null = null;

  const camDir = new THREE.Vector3();
  perspCamera.getWorldDirection(camDir);

  if      (axis === 'x')  { moveDir = lx; planeNormal = lx.clone().cross(camDir).cross(lx).normalize(); }
  else if (axis === 'y')  { moveDir = ly; planeNormal = ly.clone().cross(camDir).cross(ly).normalize(); }
  else if (axis === 'z')  { moveDir = lz; planeNormal = lz.clone().cross(camDir).cross(lz).normalize(); }
  else if (axis === 'xy') { planeNormal = lz; }
  else if (axis === 'xz') { planeNormal = ly; }
  else                    { planeNormal = lx; }

  const origin = getSelectionCenter()!;
  gizmoDrag.plane.setFromNormalAndCoplanarPoint(planeNormal, origin);
  gizmoDrag.planeU.copy(moveDir ?? new THREE.Vector3());

  const rect = renderer.domElement.getBoundingClientRect();
  const nx =  ((clientX - rect.left) / rect.width)  * 2 - 1;
  const ny = -((clientY - rect.top)  / rect.height) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), getCamera());
  const startPt = new THREE.Vector3();
  if (!ray.ray.intersectPlane(gizmoDrag.plane, startPt)) return false;

  for (const id of selectedIds) pushUndo(id);
  gizmoDrag.active = true;
  gizmoDrag.axis   = axis;
  gizmoDrag.startWorld.copy(startPt);
  gizmoDrag.startObjPositions.clear();
  for (const id of selectedIds) {
    const e = entities.find(en => en.id === id);
    if (e) gizmoDrag.startObjPositions.set(id, e.object.position.clone());
  }
  return true;
}

function moveGizmoDrag(clientX: number, clientY: number, shift: boolean): void {
  if (selectedIds.size === 0) return;

  const rect = renderer.domElement.getBoundingClientRect();
  const nx =  ((clientX - rect.left) / rect.width)  * 2 - 1;
  const ny = -((clientY - rect.top)  / rect.height) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), getCamera());
  const curPt = new THREE.Vector3();
  if (!ray.ray.intersectPlane(gizmoDrag.plane, curPt)) return;

  let delta = curPt.clone().sub(gizmoDrag.startWorld);

  const isAxisDrag = ['x', 'y', 'z'].includes(gizmoDrag.axis!);
  if (isAxisDrag) {
    const proj    = delta.dot(gizmoDrag.planeU);
    const snapped = shift ? Math.round(proj / translateSnapStep) * translateSnapStep : proj;
    delta = gizmoDrag.planeU.clone().multiplyScalar(snapped);
  } else if (shift) {
    delta.x = Math.round(delta.x / translateSnapStep) * translateSnapStep;
    delta.y = Math.round(delta.y / translateSnapStep) * translateSnapStep;
    delta.z = Math.round(delta.z / translateSnapStep) * translateSnapStep;
  }

  for (const id of selectedIds) {
    const e = entities.find(en => en.id === id);
    const startPos = gizmoDrag.startObjPositions.get(id);
    if (e && startPos && !e.locked) e.object.position.copy(startPos).add(delta);
  }
  for (const b of selectionBoxes) b.update();
}

// Wire gizmo into existing pointer handlers
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || gizmoDrag.active) return;
  const hit = hitTestGizmo(e.clientX, e.clientY);
  if (!hit) return;
  if (!startGizmoDrag(hit, e.clientX, e.clientY)) return;
  applyGizmoHover(null);
  dragHandled = true;
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
}, { capture: true });

// ── RENDER LOOP ──────────────────────────────────────────────────────────────
function animate(): void {
  requestAnimationFrame(animate);
  tickAnimation();
  controls.update();
  if (useOrtho) syncOrtho();
  for (const b of selectionBoxes) b.update();
  updateGizmo();
  renderer.render(scene, getCamera());
  renderViewCube();
}
animate();
