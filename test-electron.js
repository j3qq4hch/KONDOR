const {app, BrowserWindow} = require('electron/main'); console.log('app:', typeof app); app.whenReady().then(() => { console.log('ready'); app.quit(); });
