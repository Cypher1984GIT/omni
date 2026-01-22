const { app, BrowserWindow, BrowserView, ipcMain, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Configure autoUpdater
autoUpdater.logger = require("electron-log");
autoUpdater.logger.transports.file.level = "info";
autoUpdater.autoDownload = false; // Disable auto download
autoUpdater.autoInstallOnAppQuit = false;
// Disable code signature verification for unsigned builds
autoUpdater.verifyUpdateCodeSignature = false;

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

    // Force Spellcheck Languages for every webContents created
    contents.session.setSpellCheckerLanguages(['es-ES', 'en-US']);

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
let footerHeight = 0;

// Split Mode State
let isSplitMode = false;
let activeViewId = null; // Left / Primary
let secondaryViewId = null; // Right / Secondary

function updatePositions() {
    if (!win) return;
    const { width, height } = win.getContentBounds();
    const contentHeight = height - headerHeight - footerHeight;
    const y = headerHeight;

    // Detach all known views first to clear the slate
    Object.values(views).forEach(view => {
        try {
            win.removeBrowserView(view);
        } catch (e) {
            // Ignore if already removed or not attached
        }
    });

    if (!isSplitMode) {
        // Single View Mode
        if (activeViewId && views[activeViewId]) {
            const v = views[activeViewId];
            try {
                win.addBrowserView(v);
                v.setBounds({ x: 0, y: y, width: width, height: contentHeight });
            } catch (e) {
                console.error("Failed to add view:", e);
            }
        }
    } else {
        // Split Mode
        const halfWidth = Math.trunc(width / 2);

        // Primary (Left)
        if (activeViewId && views[activeViewId]) {
            const v = views[activeViewId];
            try {
                win.addBrowserView(v);
                v.setBounds({ x: 0, y: y, width: halfWidth, height: contentHeight });
            } catch (e) {
                console.error("Failed to add primary view:", e);
            }
        }

        // Secondary (Right)
        if (secondaryViewId && views[secondaryViewId]) {
            const v = views[secondaryViewId];
            try {
                win.addBrowserView(v);
                v.setBounds({ x: halfWidth, y: y, width: width - halfWidth, height: contentHeight });
            } catch (e) {
                console.error("Failed to add secondary view:", e);
            }
        }
    }
}

const stateFilePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    try {
        if (fs.existsSync(stateFilePath)) {
            const data = fs.readFileSync(stateFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Failed to load window state:", e);
    }
    // Default fallback
    return { width: 1300, height: 900, isMaximized: true };
}

function saveWindowState() {
    if (!win) return;
    try {
        // If window is destroyed, don't try to get bounds
        if (win.isDestroyed()) return;

        const isMaximized = win.isMaximized();
        // If maximized, we don't want to save the maximized bounds as the 'normal' bounds
        // because unmaximizing would then keep it full screen size.
        // However, Electron's getBounds() returns the restored bounds if we use proper logic? 
        // Actually, getBounds() while maximized returns screen size.
        // We usually want to save the 'normal' bounds only if NOT maximized.

        let state = { isMaximized };

        if (!isMaximized) {
            const bounds = win.getBounds();
            state = { ...state, ...bounds };
        } else {
            // If currently maximized, try to read previous size to preserve 'restore' size
            // or just save the fact it is maximized and let next launch handle default restore size
            // But we should try to keep previous non-maximized bounds if possible.
            try {
                const previous = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
                state.x = previous.x;
                state.y = previous.y;
                state.width = previous.width;
                state.height = previous.height;
            } catch (e) { }
        }

        fs.writeFileSync(stateFilePath, JSON.stringify(state));
    } catch (e) {
        console.error("Failed to save window state:", e);
    }
}

function createWindow() {
    const state = loadWindowState();

    win = new BrowserWindow({
        width: state.width || 1300,
        height: state.height || 900,
        x: state.x,
        y: state.y,
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

    if (state.isMaximized) {
        win.maximize();
    }

    // Debounce save on resize/move
    let resizeTimeout;
    const handleResizeOrMove = () => {
        updatePositions();
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            saveWindowState();
        }, 500); // Save 500ms after last event
    };

    win.on('resize', handleResizeOrMove);
    win.on('move', handleResizeOrMove);

    // Also save on close to be sure
    win.on('close', () => {
        saveWindowState();
    });

    win.webContents.on('did-finish-load', () => {
        win.webContents.send('app-version', app.getVersion());
    });

    // Update events
    autoUpdater.on('checking-for-update', () => {
        if (win) win.webContents.send('update-status', 'Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
        const version = info.version;
        // Global release page for better reliability and manual download
        let downloadUrl = `https://github.com/Cypher1984GIT/omni/releases/tag/v${version}`;

        // Specifically for Windows, we can provide the direct link for background download
        if (process.platform === 'win32') {
            downloadUrl = `https://github.com/Cypher1984GIT/omni/releases/download/v${version}/Omni-Setup-${version}.exe`;
        }

        if (win) {
            win.webContents.send('update-available', { version, url: downloadUrl });
            win.webContents.send('update-status', `Update available: ${version}`);
        }
    });

    autoUpdater.on('update-not-available', (info) => {
        if (win) win.webContents.send('update-status', 'App is up to date.');
    });

    autoUpdater.on('error', (err) => {
        if (win) win.webContents.send('update-status', `Error in auto-updater: ${err.message || err}`);
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
    updatePositions();
});

// Trigger update check manually from renderer
ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdatesAndNotify();
});

// Install update (Modified to open external link)
ipcMain.on('install-update', (event, url) => {
    if (url) {
        require('electron').shell.openExternal(url);
    }
});

ipcMain.on('add-ai', (event, { id, url, isIncognito }) => {
    // If Incognito, use a non-persistent partition (RAM only). 
    // Otherwise use persist:...
    const partitionName = isIncognito
        ? `incognito_session_${id}_${Date.now()}` // Unique RAM session
        : `persist:ai_sessions_v2_${id}`;

    const view = new BrowserView({
        webPreferences: {
            partition: partitionName,
            preload: path.join(__dirname, 'preload.js'),
            spellcheck: true // Explicitly enable
        }
    });

    // Ensure dictionaries are loaded for Spanish and English
    view.webContents.session.setSpellCheckerLanguages(['es-ES', 'en-US']);

    // Explicitly set background to WHITE as requested to avoid black flash
    view.setBackgroundColor('#ffffff');

    views[id] = view;

    if (!isSplitMode) {
        activeViewId = id;
    } else {
        // In split mode, if we add a new one, does it go to Right?
        // Let's decide: New tabs in split mode fill the Secondary slot if empty, 
        // or replace secondary if full.
        secondaryViewId = id;
        // Ensure we have a primary
        if (!activeViewId) activeViewId = id;
    }

    updatePositions();

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
                    partition: partitionName,
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
        const menuTemplate = [];

        // 1. Spellcheck Suggestions
        if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
            params.dictionarySuggestions.forEach(suggestion => {
                menuTemplate.push({
                    label: suggestion,
                    click: () => view.webContents.replaceMisspelling(suggestion)
                });
            });
            menuTemplate.push({ type: 'separator' });
        }

        // 2. Navigation Controls
        if (view.webContents.canGoBack()) {
            menuTemplate.push({
                label: 'Back',
                click: () => view.webContents.goBack()
            });
        }
        if (view.webContents.canGoForward()) {
            menuTemplate.push({
                label: 'Forward',
                click: () => view.webContents.goForward()
            });
        }
        menuTemplate.push({
            label: 'Reload Frame',
            click: () => view.webContents.reload()
        });
        menuTemplate.push({ type: 'separator' });

        // 3. Editing Actions
        menuTemplate.push(
            { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
            { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
            { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
            { type: 'separator' }
        );

        // 4. Image Handling
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

        // 5. Link Handling
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

        // 6. Developer Tools (Inspect) - REMOVED per user request
        // menuTemplate.push({ label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) });

        const menu = Menu.buildFromTemplate(menuTemplate);
        if (menuTemplate.length > 0) {
            menu.popup({ window: win });
        }
    });
});





ipcMain.on('broadcast-prompt', (event, prompt) => {
    if (!prompt) return;

    // Iterate over all active views
    Object.values(views).forEach(view => {
        // Script to inject into each renderer
        const script = `
        (function() {
            const text = ${JSON.stringify(prompt)};
            
            function simulateEnter(element) {
                const eventInit = { bubbles: true, cancelable: true, view: window, keyCode: 13, which: 13, code: 'Enter', key: 'Enter', shiftKey: false };
                element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
                element.dispatchEvent(new KeyboardEvent('keypress', eventInit));
                
                setTimeout(() => {
                   element.dispatchEvent(new KeyboardEvent('keyup', eventInit));
                }, 50);
            }

            // 1. Try to find the input element
            let target = document.querySelector('textarea');
            if (!target) target = document.querySelector('div[contenteditable="true"]');
            if (!target) target = document.querySelector('input[type="text"]');
            
            // Prioritize focused element if it's valid
            const active = document.activeElement;
            if (active && (active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true' || active.tagName === 'INPUT')) {
                target = active;
            }

            if (target) {
                target.focus();
                
                // 2. Insert Text
                // Try execCommand first as it simulates user pasting best (triggers internal events)
                let success = document.execCommand('insertText', false, text);
                
                // Fallback: React/Vue value setters
                if (!success || (target.value !== undefined && !target.value.includes(text)) || (target.innerText && !target.innerText.includes(text))) {
                    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
                        const proto = window[target.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement'].prototype;
                        const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value").set;
                        if (nativeSetter) {
                            nativeSetter.call(target, text);
                        } else {
                            target.value = text;
                        }
                    } else {
                        // Contenteditable
                        target.innerText = text;
                    }
                    target.dispatchEvent(new Event('input', { bubbles: true }));
                }

                // 3. Submit (Small delay to let framework state sync)
                setTimeout(() => {
                    // Method A: Enter key
                    simulateEnter(target);
                    
                    // Method B: Look for specific 'Send' buttons if Enter fails (optional, heuristic)
                    setTimeout(() => {
                        const sendBtn = document.querySelector('button[aria-label*="Send"], button[aria-label*="Submit"], button[data-testid*="send"]');
                        if (sendBtn && !sendBtn.disabled) {
                            sendBtn.click();
                        }
                    }, 200);
                }, 100);
            }
        })();
        `;

        view.webContents.executeJavaScript(script).catch(err => console.log('Broadcast error:', err));
    });
});


ipcMain.on('hide-current-view', () => {
    // win.setBrowserViews([]) is not supported in this Electron version
    // Manually remove all views
    const currentViews = win.getBrowserViews();
    currentViews.forEach(view => {
        try {
            win.removeBrowserView(view);
        } catch (e) {
            // ignore
        }
    });
});

ipcMain.on('switch-tab', (event, id) => {
    if (!views[id]) return;

    if (!isSplitMode) {
        // Normal Mode: Just set as active
        activeViewId = id;
    } else {
        // Split Mode Handling
        if (activeViewId === id) {
            // User clicked the Primary tab -> Setup/Focus
            // Do nothing or maybe swap? Let's just keep it simple.
        } else if (secondaryViewId === id) {
            // User clicked the Secondary tab -> Toggle logic? 
            // Maybe make it primary? No, keep it there.
        } else {
            // User clicked a THIRD tab.
            // Behavior: Replace the Secondary view. Keep Primary fixed.
            secondaryViewId = id;
        }

        // Ensure at least one is "Primary" if we just started split mode and clicked something
        if (!activeViewId) activeViewId = id;
    }
    updatePositions();
});

ipcMain.on('toggle-split', () => {
    isSplitMode = !isSplitMode;

    if (!isSplitMode) {
        // Turn OFF: Clear secondary, revert to full screen primary
        secondaryViewId = null;
    } else {
        // Turn ON: 
        // Auto-select a secondary view if we have one available that isn't the primary
        if (!secondaryViewId) {
            const available = Object.keys(views);
            const next = available.find(id => id !== activeViewId);
            if (next) {
                secondaryViewId = next;
            }
        }
    }
    updatePositions();
});

ipcMain.on('remove-ai', (event, id) => {
    if (views[id]) {
        // If it was the active view
        if (activeViewId === id) {
            activeViewId = null;
            // If split, maybe promote secondary to primary?
            if (isSplitMode && secondaryViewId) {
                activeViewId = secondaryViewId;
                secondaryViewId = null;
            }
        }
        // If it was the secondary view
        if (secondaryViewId === id) {
            secondaryViewId = null;
        }

        // Cleanup view explicitly
        if (win) {
            win.removeBrowserView(views[id]);
        }
        // Destroy webContents to free resources immediately
        try {
            // views[id].webContents.destroy(); // Optional: might crash if async events pending, but good for cleanup
        } catch (e) { }

        delete views[id];

        // Auto-disable split mode if we drop below 2 views
        const remainingIds = Object.keys(views);
        if (isSplitMode && remainingIds.length < 2) {
            isSplitMode = false;
            secondaryViewId = null;
            if (remainingIds.length === 1) {
                activeViewId = remainingIds[0];
            }
            if (win) win.webContents.send('sync-split-state', false);
        }

        updatePositions();
    }
});

ipcMain.on('reload-ai', (event, id) => {
    if (views[id]) {
        views[id].webContents.reload();
    }
});

ipcMain.on('show-current-view', (event, id) => {
    updatePositions();
});

ipcMain.on('reload-all-ais', () => {
    Object.values(views).forEach(view => {
        view.webContents.reload();
    });
});

app.whenReady().then(() => {
    console.log('App starting with Clean Config...');
    createWindow();
    createMenu();
    // Check for updates shortly after startup
    setTimeout(() => {
        autoUpdater.checkForUpdates();
    }, 2000);
});

function createMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
        // { role: 'appMenu' }
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        // { role: 'fileMenu' }
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Tab',
                    accelerator: 'CommandOrControl+T',
                    click: () => { if (win) win.webContents.send('action-new-tab'); }
                },
                {
                    label: 'Close Tab',
                    accelerator: 'CommandOrControl+W',
                    click: () => { if (win) win.webContents.send('action-close-tab'); }
                },
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },
        // { role: 'viewMenu' }
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload Current AI',
                    accelerator: 'CommandOrControl+R',
                    click: () => { if (win) win.webContents.send('action-reload-current'); }
                },
                {
                    label: 'Force Reload App',
                    accelerator: 'CommandOrControl+Shift+R',
                    click: () => { if (win) win.reload(); }
                },
                { type: 'separator' },
                {
                    label: 'Next Tab',
                    accelerator: 'Control+Tab',
                    click: () => { if (win) win.webContents.send('action-next-tab'); }
                },
                {
                    label: 'Previous Tab',
                    accelerator: 'Control+Shift+Tab',
                    click: () => { if (win) win.webContents.send('action-prev-tab'); }
                },
                { type: 'separator' },
                { role: 'toggledevtools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        // Tab Navigation 1-9
        {
            label: 'Go',
            submenu: [
                { label: 'Tab 1', accelerator: 'CommandOrControl+1', click: () => win.webContents.send('action-jump-tab', 0) },
                { label: 'Tab 2', accelerator: 'CommandOrControl+2', click: () => win.webContents.send('action-jump-tab', 1) },
                { label: 'Tab 3', accelerator: 'CommandOrControl+3', click: () => win.webContents.send('action-jump-tab', 2) },
                { label: 'Tab 4', accelerator: 'CommandOrControl+4', click: () => win.webContents.send('action-jump-tab', 3) },
                { label: 'Tab 5', accelerator: 'CommandOrControl+5', click: () => win.webContents.send('action-jump-tab', 4) },
                { label: 'Tab 6', accelerator: 'CommandOrControl+6', click: () => win.webContents.send('action-jump-tab', 5) },
                { label: 'Tab 7', accelerator: 'CommandOrControl+7', click: () => win.webContents.send('action-jump-tab', 6) },
                { label: 'Tab 8', accelerator: 'CommandOrControl+8', click: () => win.webContents.send('action-jump-tab', 7) },
                { label: 'Tab 9', accelerator: 'CommandOrControl+9', click: () => win.webContents.send('action-jump-tab', 8) },
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}