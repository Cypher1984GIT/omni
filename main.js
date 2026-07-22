const path = require('path');
const { app, BrowserWindow, BrowserView, Menu, clipboard, ipcMain, nativeTheme } = require('electron');
const { createWindowStateStore } = require('./src/main/windowState');
const { configureGlobalWebContents } = require('./src/main/security');
const { createUpdater } = require('./src/main/updater');
const { createAppMenu } = require('./src/main/menu');
const { ViewManager } = require('./src/main/viewManager');

let win;
let currentTheme = 'dark';

configureGlobalWebContents(app);

const stateStore = createWindowStateStore(app);
const updater = createUpdater({
    winRef: () => win
});

const viewManager = new ViewManager({
    app,
    BrowserView,
    Menu,
    clipboard,
    winRef: () => win,
    getTheme: () => currentTheme,
    sendToWindow: (channel, payload) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    }
});

function createWindow() {
    const state = stateStore.load();
    currentTheme = state.theme || 'dark';
    nativeTheme.themeSource = currentTheme;

    win = new BrowserWindow({
        width: state.width || 1300,
        height: state.height || 900,
        x: state.x,
        y: state.y,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, 'icon.png'),
        autoHideMenuBar: true,
        backgroundColor: currentTheme === 'light' ? '#ffffff' : '#09090b',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload-app.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        }
    });

    win.loadFile('index.html');

    if (state.isMaximized) {
        win.maximize();
    }

    win.once('ready-to-show', () => {
        win.show();
    });

    let resizeTimeout;
    const handleResizeOrMove = () => {
        viewManager.updatePositions();
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            stateStore.save(win, currentTheme);
        }, 500);
    };

    win.on('resize', handleResizeOrMove);
    win.on('move', handleResizeOrMove);
    win.on('close', () => {
        stateStore.save(win, currentTheme);
    });
    win.on('closed', () => {
        viewManager.reset();
        win = null;
    });

    win.webContents.on('did-finish-load', () => {
        win.webContents.send('app-version', app.getVersion());
    });
}

ipcMain.on('update-layout', (_event, layout) => {
    viewManager.updateLayout(layout);
});

ipcMain.on('check-for-updates', () => {
    updater.checkForUpdatesAndNotify();
});

ipcMain.on('install-update', (_event, url) => {
    updater.openInstallUrl(url);
});

ipcMain.on('open-external', (_event, url) => {
    updater.openInstallUrl(url);
});

ipcMain.on('add-ai', (_event, payload) => {
    viewManager.addAI(payload);
});

ipcMain.on('broadcast-prompt', (_event, prompt) => {
    viewManager.broadcastPrompt(prompt);
});

ipcMain.on('hide-current-view', () => {
    viewManager.hideCurrentView();
});

ipcMain.on('switch-tab', (_event, id) => {
    viewManager.switchTab(id);
});

ipcMain.on('toggle-split', () => {
    viewManager.toggleSplit();
});

ipcMain.on('remove-ai', (_event, id) => {
    viewManager.removeAI(id);
});

ipcMain.on('reload-ai', (_event, id) => {
    viewManager.reloadAI(id);
});

ipcMain.on('show-current-view', () => {
    viewManager.showCurrentView();
});

ipcMain.on('reload-all-ais', () => {
    viewManager.reloadAllAIs();
});

ipcMain.on('get-omni-theme', (event) => {
    event.returnValue = currentTheme === 'light' ? 'light' : 'dark';
});

ipcMain.on('theme-changed', (_event, theme) => {
    nativeTheme.themeSource = theme;
    currentTheme = theme;
    stateStore.save(win, currentTheme);
    viewManager.applyTheme(theme);
});

ipcMain.on('reset-all', () => {
    currentTheme = 'dark';
    nativeTheme.themeSource = currentTheme;
    viewManager.reset();
    stateStore.save(win, currentTheme);
});

app.whenReady().then(() => {
    createWindow();
    createAppMenu({ app, winRef: () => win });
    updater.registerListeners();
    setTimeout(() => {
        updater.checkForUpdates().catch((error) => {
            console.error('Failed to check for updates:', error);
        });
    }, 2000);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
