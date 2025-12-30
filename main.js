const { app, BrowserWindow, BrowserView, ipcMain, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Configure autoUpdater
autoUpdater.logger = require("electron-log");
autoUpdater.logger.transports.file.level = "info";
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Fix for Google Sign-In "This browser or app may not be secure"
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// app.commandLine.appendSwitch('disable-site-isolation-trials'); // Disabled as it reduces security
// app.commandLine.appendSwitch('ignore-certificate-errors'); 

// Global handler to ensure all created web contents have a clean User Agent
app.on('web-contents-created', (event, contents) => {
    // Dynamically strip "Electron" from the User Agent but keep the runtime version.
    // This handles the "Chrome 142" requirement natively without hardcoding numbers.
    const originalUserAgent = contents.getUserAgent();
    // Regex removes "Electron/x.y.z " string
    const cleanUserAgent = originalUserAgent.replace(/Electron\/\S+\s/, '');
    contents.setUserAgent(cleanUserAgent);

    // Inject minimal anti-bot scripts
    const antiBotScript = `
        try {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            // Don't nuke navigator.credentials or plugins excessively
        } catch(e) {}
    `;

    contents.executeJavaScript(antiBotScript).catch(() => { });
    contents.on('did-start-loading', () => {
        contents.executeJavaScript(antiBotScript).catch(() => { });
    });

    // ----------------------------------------------------
    // HEADER STRIPPING FOR NON-GOOGLE SITES (Grok, etc.)
    // ----------------------------------------------------
    contents.session.webRequest.onHeadersReceived((details, callback) => {
        const url = details.url || '';
        const responseHeaders = details.responseHeaders;

        // SKIP Google domains entirely to avoid 'Insecure App' detection
        if (url.includes('google.com') || url.includes('accounts.google.com') || url.includes('youtube.com') || url.includes('gstatic.com')) {
            callback({ cancel: false, responseHeaders });
            return;
        }

        // For others, strip embedding protections
        if (responseHeaders) {
            delete responseHeaders['x-frame-options'];
            delete responseHeaders['content-security-policy'];
            delete responseHeaders['cross-origin-resource-policy'];
            delete responseHeaders['cross-origin-opener-policy'];
        }

        callback({ cancel: false, responseHeaders });
    });
});

let win;
let views = {};
let headerHeight = 70;
let footerHeight = 24;

function createWindow() {
    win = new BrowserWindow({
        width: 1300,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile('index.html');
    win.maximize();

    win.on('resize', () => {
        const activeView = win.getBrowserView();
        if (activeView) {
            const bounds = win.getBounds();
            activeView.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight - footerHeight });
        }
    });

    // Update events
    autoUpdater.on('checking-for-update', () => {
        if (win) win.webContents.send('update-status', 'Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
        if (win) win.webContents.send('update-status', `Update available: ${info.version}`);
    });

    autoUpdater.on('update-not-available', (info) => {
        if (win) win.webContents.send('update-status', 'App is up to date.');
    });

    autoUpdater.on('error', (err) => {
        if (win) win.webContents.send('update-status', 'Error in auto-updater.');
    });

    autoUpdater.on('download-progress', (progressObj) => {
        let log_message = "Download speed: " + progressObj.bytesPerSecond;
        log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
        log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
        if (win) win.webContents.send('update-status', `Downloading: ${Math.round(progressObj.percent)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
        if (win) win.webContents.send('update-ready');
    });
}

ipcMain.on('update-layout', (event, { headerHeight: h, footerHeight: f }) => {
    headerHeight = h;
    footerHeight = f;
    const activeView = win.getBrowserView();
    if (activeView) {
        const bounds = win.getBounds();
        activeView.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight - footerHeight });
    }
});

// Trigger update check manually from renderer
ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdatesAndNotify();
});

// Install update
ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall();
});

ipcMain.on('add-ai', (event, { id, url }) => {
    // Use a NEW partition namespace 'persist:ai_sessions_v2' to ensure clean start
    // dropping old cookies/localStorage that might have been flagged by Google.
    const view = new BrowserView({
        webPreferences: {
            partition: `persist:ai_sessions_v2_${id}`,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    views[id] = view;
    win.setBrowserView(view);

    const bounds = win.getBounds();
    view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight - footerHeight });

    // The 'web-contents-created' global handler above will automatically 
    // set the correct User Agent and handle Header Stripping.
    // We do NOT need to duplicate logic here, reducing risk of conflicts.

    // Permission handling (needed for some AI features)
    view.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
    });

    view.webContents.setWindowOpenHandler(({ url }) => {
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                width: 600,
                height: 700,
                center: true,
                alwaysOnTop: true,
                autoHideMenuBar: true,
                webPreferences: {
                    partition: `persist:ai_sessions_v2_${id}`,
                    preload: path.join(__dirname, 'preload.js'),
                    nodeIntegration: false,
                    contextIsolation: true
                }
            }
        };
    });

    view.webContents.loadURL(url);

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        if (errorCode !== -3) {
            view.webContents.loadFile('error.html', { query: { url: validatedURL } });
        }
    });

    view.webContents.on('did-finish-load', async () => {
        try {
            const pageText = await view.webContents.executeJavaScript('document.body.innerText');
            if (pageText && (pageText.includes('Sorry, you have been blocked') || pageText.includes('You are unable to access copilot.microsoft.com'))) {
                view.webContents.loadFile('error.html', { query: { url: view.webContents.getURL() } });
            }
        } catch (e) {
            // console.error('Error checking page content:', e);
        }
    });

    view.webContents.on('did-start-loading', () => {
        if (win) win.webContents.send('ai-loading-status', { id, isLoading: true });
    });
    view.webContents.on('did-stop-loading', () => {
        if (win) win.webContents.send('ai-loading-status', { id, isLoading: false });
    });

    // Handle File Downloads (Native "Save As" Dialog)
    view.webContents.session.on('will-download', (event, item, webContents) => {
        item.setSaveDialogOptions({
            title: 'Save File',
            defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
            buttonLabel: 'Save'
        });

        // Ensure the Save Dialog appears
        // Electron handles this automatically if we don't preventDefault, 
        // but setting savePathDialogOptions ensures it looks correct.

        item.once('done', (event, state) => {
            if (state === 'completed') {
                console.log('Download successfully');
            } else {
                console.log(`Download failed: ${state}`);
            }
        });
    });

    // Custom Context Menu (Right-Click)
    view.webContents.on('context-menu', (event, params) => {
        const menuTemplate = [
            { label: 'Cut', role: 'cut' },
            { label: 'Copy', role: 'copy' },
            { label: 'Paste', role: 'paste' },
            { type: 'separator' }
        ];

        // If right-clicked on an image
        if (params.mediaType === 'image') {
            menuTemplate.push(
                {
                    label: 'Save Image As...',
                    click: () => {
                        view.webContents.downloadURL(params.srcURL);
                    }
                },
                {
                    label: 'Copy Image',
                    click: () => {
                        view.webContents.copyImageAt(params.x, params.y);
                    }
                },
                {
                    label: 'Copy Image Address',
                    click: () => {
                        clipboard.writeText(params.srcURL);
                    }
                },
                { type: 'separator' }
            );
        }

        // Check if there is text selected to show 'Search with Google' or similar if desired, 
        // or just basic text operations which are already covered by cut/copy/paste roles (if editable).
        // If it's just a link:
        if (params.linkURL) {
            menuTemplate.push(
                {
                    label: 'Open Link in Browser',
                    click: () => {
                        require('electron').shell.openExternal(params.linkURL);
                    }
                },
                {
                    label: 'Copy Link Address',
                    click: () => {
                        clipboard.writeText(params.linkURL);
                    }
                },
                { type: 'separator' }
            );
        }

        menuTemplate.push({ label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) });

        const menu = Menu.buildFromTemplate(menuTemplate);
        menu.popup({ window: win });
    });
});

ipcMain.on('switch-tab', (event, id) => {
    if (views[id]) {
        const bounds = win.getBounds();
        views[id].setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight - footerHeight });
        win.setBrowserView(views[id]);
    }
});

ipcMain.on('remove-ai', (event, id) => {
    if (views[id]) {
        if (win.getBrowserView() === views[id]) {
            win.setBrowserView(null);
        }
        // view.webContents.destroy() if needed, or let GC handle
        delete views[id];
    }
});

ipcMain.on('reload-ai', (event, id) => {
    if (views[id]) {
        views[id].webContents.reload();
    }
});

ipcMain.on('reload-all-ais', () => {
    Object.values(views).forEach(view => {
        view.webContents.reload();
    });
});

ipcMain.on('hide-current-view', () => {
    win.setBrowserView(null);
});

ipcMain.on('show-current-view', (event, id) => {
    if (views[id]) {
        const bounds = win.getBounds();
        views[id].setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight - footerHeight });
        win.setBrowserView(views[id]);
    }
});

app.whenReady().then(() => {
    console.log('App starting with Clean Config...');
    createWindow();
    // Check for updates shortly after startup
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 2000);
});