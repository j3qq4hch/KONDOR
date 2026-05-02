import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join, basename, extname } from 'path';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, watch } from 'fs';
import { spawn } from 'child_process';
const __dirname = dirname(fileURLToPath(import.meta.url));
// ── Settings ──────────────────────────────────────────────────────────────────
const settingsPath = join(app.getPath('userData'), 'settings.json');
function readSettings() {
    try {
        return JSON.parse(readFileSync(settingsPath, 'utf8'));
    }
    catch {
        return {};
    }
}
function writeSettings(data) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
}
// ── Eagle settings file ───────────────────────────────────────────────────────
function eagleSettingsArgs() {
    const p = join(app.getPath('appData'), 'CadSoft', 'EAGLE', 'eaglerc.usr');
    return existsSync(p) ? ['-U', p] : [];
}
// ── File watchers ─────────────────────────────────────────────────────────────
let mainWin = null;
const watchers = new Map();
const glbWatchers = new Map();
function watchBrd(brdPath) {
    if (watchers.has(brdPath))
        return;
    try {
        const w = watch(brdPath, () => {
            mainWin?.webContents.send('brd:modified', brdPath);
        });
        watchers.set(brdPath, w);
    }
    catch { /* file may not exist yet */ }
}
function unwatchBrd(brdPath) {
    watchers.get(brdPath)?.close();
    watchers.delete(brdPath);
}
function watchGlb(glbPath) {
    if (glbWatchers.has(glbPath))
        return;
    try {
        const w = watch(glbPath, () => {
            mainWin?.webContents.send('glb:modified', glbPath);
        });
        glbWatchers.set(glbPath, w);
    }
    catch { }
}
function unwatchGlb(glbPath) {
    glbWatchers.get(glbPath)?.close();
    glbWatchers.delete(glbPath);
}
// ── ConBut / Pinout windows ───────────────────────────────────────────────────
let conbutWin = null;
let pinoutWin = null;
let storedConButLayout = null;
function setConIdInXml(xml, refDes, newValue) {
    const safeRef = refDes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const safeVal = newValue
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return xml.replace(new RegExp(`(<element\\b(?=[^>]*\\bname="${safeRef}")[^>]*>[\\s\\S]*?</element>)`, 'g'), (block) => block.replace(/(<attribute\b(?=[^>]*\bname="CONID")[^>]*?)\/?>/i, (_, attrs) => {
        // Strip any existing value= then add the new one
        const clean = attrs.replace(/\s+value="[^"]*"/gi, '');
        return safeVal ? `${clean} value="${safeVal}"/>` : `${clean}/>`;
    }));
}
// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
    mainWin = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            sandbox: false,
        },
        title: 'Kondor',
        backgroundColor: '#1e1e1e',
    });
    mainWin.loadFile(join(__dirname, '../dist/renderer/index.html'));
    mainWin.on('closed', () => { mainWin = null; });
}
// ── IPC handlers ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    // Existing: open GLB/GLTF
    ipcMain.handle('dialog:openFile', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            filters: [{ name: '3D Models', extensions: ['glb', 'gltf'] }],
            properties: ['openFile'],
        });
        return canceled ? null : filePaths[0];
    });
    // Open BRD file dialog, return paths + BRD XML content + mtime
    ipcMain.handle('dialog:openBrd', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            filters: [{ name: 'Eagle Board', extensions: ['brd'] }],
            properties: ['openFile'],
        });
        if (canceled || !filePaths[0])
            return null;
        const brdPath = filePaths[0];
        const dir = dirname(brdPath);
        const stem = basename(brdPath, extname(brdPath));
        const glbPath = join(dir, stem + '.glb');
        const brdMtime = statSync(brdPath).mtimeMs;
        const brdContent = readFileSync(brdPath, 'utf8');
        const glbExists = existsSync(glbPath);
        watchBrd(brdPath);
        return {
            brdPath,
            brdContent,
            brdMtime,
            glbPath: glbExists ? glbPath : null,
        };
    });
    // Get current mtime of a file
    ipcMain.handle('board:getMtime', (_e, filePath) => {
        try {
            return statSync(filePath).mtimeMs;
        }
        catch {
            return null;
        }
    });
    // Regenerate GLB via eaglecon
    ipcMain.handle('board:update', async (_e, brdPath) => {
        const settings = readSettings();
        const eagleBin = settings.eagleBinPath;
        if (!eagleBin)
            return { ok: false, error: 'Eagle bin path not set in settings.' };
        const eaglecon = join(eagleBin, 'eaglecon.exe');
        if (!existsSync(eaglecon))
            return { ok: false, error: `eaglecon.exe not found at: ${eaglecon}` };
        const mtimeBefore = (() => {
            const dir = dirname(brdPath);
            const stem = basename(brdPath, extname(brdPath));
            try {
                return statSync(join(dir, stem + '.glb')).mtimeMs;
            }
            catch {
                return 0;
            }
        })();
        return new Promise(resolve => {
            const eagleconCmd = settings.eagleconCmd || "run export3D_raw.ulp '400'; UNDO; QUIT";
            const settingsArgs = eagleSettingsArgs();
            const proc = spawn(eaglecon, [...settingsArgs, '-C', eagleconCmd, brdPath], { detached: false });
            proc.on('close', () => {
                const dir = dirname(brdPath);
                const stem = basename(brdPath, extname(brdPath));
                const glbPath = join(dir, stem + '.glb');
                try {
                    const mtimeAfter = statSync(glbPath).mtimeMs;
                    if (mtimeAfter > mtimeBefore) {
                        const brdContent = readFileSync(brdPath, 'utf8');
                        const brdMtime = statSync(brdPath).mtimeMs;
                        resolve({ ok: true, glbPath, brdContent, brdMtime });
                    }
                    else {
                        resolve({ ok: false, error: 'GLB was not updated after eaglecon ran.' });
                    }
                }
                catch {
                    resolve({ ok: false, error: 'GLB file not found after eaglecon ran.' });
                }
            });
            proc.on('error', err => resolve({ ok: false, error: err.message }));
        });
    });
    // Open BRD in Eagle editor using the configured eagle.exe
    ipcMain.handle('board:openInEagle', async (_e, brdPath) => {
        const settings = readSettings();
        const eagleBin = settings.eagleBinPath;
        if (!eagleBin)
            return { ok: false, error: 'Eagle bin path not set in settings.' };
        const eagle = join(eagleBin, 'eagle.exe');
        if (!existsSync(eagle))
            return { ok: false, error: `eagle.exe not found at: ${eagle}` };
        spawn(eagle, [...eagleSettingsArgs(), brdPath], { detached: true, stdio: 'ignore' }).unref();
        return { ok: true };
    });
    // Stop watching a BRD file (called when entity is deleted)
    ipcMain.handle('board:unwatch', (_e, brdPath) => {
        unwatchBrd(brdPath);
    });
    // GLB file watching (for pure GLB model entities)
    ipcMain.handle('glb:watch', (_e, glbPath) => watchGlb(glbPath));
    ipcMain.handle('glb:unwatch', (_e, glbPath) => unwatchGlb(glbPath));
    // Load BRD from known path without dialog (used for device restore)
    ipcMain.handle('board:loadBrd', (_e, brdPath) => {
        if (!existsSync(brdPath))
            return null;
        const dir = dirname(brdPath);
        const stem = basename(brdPath, extname(brdPath));
        const glbPath = join(dir, stem + '.glb');
        const brdMtime = statSync(brdPath).mtimeMs;
        const brdContent = readFileSync(brdPath, 'utf8');
        watchBrd(brdPath);
        return { brdPath, brdContent, brdMtime, glbPath: existsSync(glbPath) ? glbPath : null };
    });
    // Save .kdev file — uses save dialog if no filePath given
    ipcMain.handle('device:save', async (_e, { data, filePath }) => {
        let target = filePath;
        if (!target) {
            const { canceled, filePath: chosen } = await dialog.showSaveDialog({
                filters: [{ name: 'Kondor Device', extensions: ['kdev'] }],
                defaultPath: 'device.kdev',
            });
            if (canceled || !chosen)
                return { ok: false };
            target = chosen;
        }
        try {
            writeFileSync(target, data, 'utf8');
            return { ok: true, filePath: target };
        }
        catch (e) {
            return { ok: false, error: String(e) };
        }
    });
    // Open .kdev file via dialog
    ipcMain.handle('device:load', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            filters: [{ name: 'Kondor Device', extensions: ['kdev'] }],
            properties: ['openFile'],
        });
        if (canceled || !filePaths[0])
            return null;
        try {
            return { ok: true, filePath: filePaths[0], data: readFileSync(filePaths[0], 'utf8') };
        }
        catch (e) {
            return { ok: false, error: String(e) };
        }
    });
    // Load .kdev from known path (auto-restore on startup)
    ipcMain.handle('device:loadFile', (_e, filePath) => {
        try {
            return { ok: true, data: readFileSync(filePath, 'utf8') };
        }
        catch {
            return { ok: false };
        }
    });
    // Export scene as GLB
    ipcMain.handle('scene:export', async (_e, buf) => {
        const { canceled, filePath } = await dialog.showSaveDialog({
            filters: [{ name: 'GL Binary', extensions: ['glb'] }],
            defaultPath: 'scene.glb',
        });
        if (canceled || !filePath)
            return { ok: false };
        try {
            writeFileSync(filePath, Buffer.from(buf));
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: String(e) };
        }
    });
    // Settings
    ipcMain.handle('settings:get', () => readSettings());
    ipcMain.handle('settings:set', (_e, data) => {
        writeSettings(data);
        return true;
    });
    // ── ConBut ──────────────────────────────────────────────────────────────────
    ipcMain.handle('conbut:open', (_e, payload) => {
        if (conbutWin && !conbutWin.isDestroyed()) {
            conbutWin.focus();
            conbutWin.webContents.send('conbut:init', payload);
            return;
        }
        conbutWin = new BrowserWindow({
            width: 1000, height: 680,
            webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
            title: 'Connection Butler',
            backgroundColor: '#1e1e1e',
        });
        conbutWin.loadFile(join(__dirname, '../dist/renderer/conbut.html'));
        conbutWin.on('closed', () => { conbutWin = null; });
        conbutWin.webContents.once('did-finish-load', () => {
            conbutWin?.webContents.send('conbut:init', payload);
        });
    });
    ipcMain.handle('conbut:show-in-model', (_e, conId) => {
        mainWin?.webContents.send('conbut:show-conid', conId);
    });
    ipcMain.handle('conbut:show-board', (_e, entityId) => {
        mainWin?.webContents.send('conbut:show-board', entityId);
    });
    // ── Notes (sidecar .md files in device_notes/ next to .kdev) ───────────────
    function sanitizeForFilename(name) {
        return name.replace(/[\\/:*?"<>|]/g, '_') || '_';
    }
    function getNotesDir() {
        const kdev = readSettings().lastDevicePath;
        if (!kdev)
            return null;
        return join(dirname(kdev), 'device_notes');
    }
    ipcMain.handle('notes:open', async (_e, conId) => {
        const dir = getNotesDir();
        if (!dir)
            return { ok: false, error: 'Save the device file first' };
        mkdirSync(dir, { recursive: true });
        const filePath = join(dir, sanitizeForFilename(conId) + '.md');
        if (!existsSync(filePath)) {
            writeFileSync(filePath, `# ${conId}\n\n`, 'utf8');
        }
        await shell.openPath(filePath);
        return { ok: true };
    });
    ipcMain.handle('notes:read', (_e, conId) => {
        const dir = getNotesDir();
        if (!dir)
            return null;
        const filePath = join(dir, sanitizeForFilename(conId) + '.md');
        if (!existsSync(filePath))
            return null;
        try {
            return { content: readFileSync(filePath, 'utf8'), dir };
        }
        catch {
            return null;
        }
    });
    ipcMain.handle('notes:list', () => {
        const dir = getNotesDir();
        if (!dir || !existsSync(dir))
            return [];
        try {
            return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
        }
        catch {
            return [];
        }
    });
    ipcMain.handle('conbut:open-pinout', (_e, data) => {
        if (pinoutWin && !pinoutWin.isDestroyed()) {
            pinoutWin.focus();
            pinoutWin.webContents.send('pinout:init', data);
            return;
        }
        pinoutWin = new BrowserWindow({
            width: 800, height: 500,
            webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
            title: 'Pinout',
            backgroundColor: '#1e1e1e',
        });
        pinoutWin.loadFile(join(__dirname, '../dist/renderer/pinout.html'));
        pinoutWin.on('closed', () => { pinoutWin = null; });
        pinoutWin.webContents.once('did-finish-load', () => {
            pinoutWin?.webContents.send('pinout:init', data);
        });
    });
    ipcMain.handle('conbut:update-layout', (_e, layout) => {
        storedConButLayout = layout;
    });
    ipcMain.handle('conbut:get-layout', () => storedConButLayout);
    // Write CONID value into BRD XML (string replacement, no full serialization)
    ipcMain.handle('brd:set-conid', (_e, { brdPath, refDes, value }) => {
        try {
            const xml = readFileSync(brdPath, 'utf8');
            const updated = setConIdInXml(xml, refDes, value);
            writeFileSync(brdPath, updated, 'utf8');
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: String(e) };
        }
    });
    createWindow();
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
});
