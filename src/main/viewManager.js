const path = require('path');
const { shell } = require('electron');
const { SPELLCHECK_LANGUAGES, createPermissionHandler, isSafeExternalUrl } = require('./security');

class ViewManager {
    constructor({ app, BrowserView, Menu, clipboard, winRef, getTheme, sendToWindow }) {
        this.app = app;
        this.BrowserView = BrowserView;
        this.Menu = Menu;
        this.clipboard = clipboard;
        this.winRef = winRef;
        this.getTheme = getTheme;
        this.sendToWindow = sendToWindow;
        this.headerHeight = 70;
        this.footerHeight = 0;
        this.views = {};
        this.isSplitMode = false;
        this.activeViewId = null;
        this.secondaryViewId = null;
        this.cleanupTimeout = null;
        this._flashTimers = new WeakMap();
        this.viewPreloadPath = path.join(__dirname, '..', '..', 'preload-view.js');
    }

    getThemeBg(theme) {
        return theme === 'light' ? '#ffffff' : '#09090b';
    }

    getThemeCss(theme) {
        const bgColor = this.getThemeBg(theme);
        return `
            html { background-color: ${bgColor} !important; }
            body { background-color: ${bgColor} !important; }
        `;
    }

    /**
     * Temporary background only (avoids white/dark flash while a site loads).
     * Must be removed — a permanent !important bg fights each AI's own theme.
     */
    injectFlashCss(contents, theme, durationMs = 1500) {
        if (!contents || contents.isDestroyed()) {
            return;
        }

        const previous = this._flashTimers.get(contents);
        if (previous) {
            clearTimeout(previous.timeoutId);
            contents.removeInsertedCSS(previous.key).catch(() => {});
            this._flashTimers.delete(contents);
        }

        contents.insertCSS(this.getThemeCss(theme)).then((key) => {
            if (!contents || contents.isDestroyed()) {
                return;
            }

            const timeoutId = setTimeout(() => {
                this._flashTimers.delete(contents);
                if (!contents || contents.isDestroyed()) {
                    return;
                }
                contents.removeInsertedCSS(key).catch(() => {});
            }, durationMs);

            this._flashTimers.set(contents, { key, timeoutId });
        }).catch(() => {});
    }

    updateLayout({ headerHeight, footerHeight }) {
        this.headerHeight = headerHeight;
        this.footerHeight = footerHeight;
        this.updatePositions();
    }

    updatePositions() {
        const win = this.winRef();
        if (!win || win.isDestroyed()) {
            return;
        }

        const { width, height } = win.getContentBounds();
        const contentHeight = height - this.headerHeight - this.footerHeight;
        const bgColor = this.getThemeBg(this.getTheme());
        const viewsToShow = [];

        if (!this.isSplitMode) {
            if (this.activeViewId && this.views[this.activeViewId]) {
                viewsToShow.push({
                    view: this.views[this.activeViewId].view,
                    bounds: { x: 0, y: this.headerHeight, width, height: contentHeight }
                });
            }
        } else {
            const halfWidth = Math.trunc(width / 2);
            if (this.activeViewId && this.views[this.activeViewId]) {
                viewsToShow.push({
                    view: this.views[this.activeViewId].view,
                    bounds: { x: 0, y: this.headerHeight, width: halfWidth, height: contentHeight }
                });
            }
            if (this.secondaryViewId && this.views[this.secondaryViewId]) {
                viewsToShow.push({
                    view: this.views[this.secondaryViewId].view,
                    bounds: { x: halfWidth, y: this.headerHeight, width: width - halfWidth, height: contentHeight }
                });
            }
        }

        viewsToShow.forEach(({ view, bounds }) => {
            view.setBackgroundColor(bgColor);
            win.addBrowserView(view);
            view.setBounds(bounds);
        });

        clearTimeout(this.cleanupTimeout);
        this.cleanupTimeout = setTimeout(() => {
            const currentWin = this.winRef();
            if (!currentWin || currentWin.isDestroyed()) {
                return;
            }

            const keep = new Set();
            if (this.activeViewId && this.views[this.activeViewId]) {
                keep.add(this.views[this.activeViewId].view);
            }
            if (this.isSplitMode && this.secondaryViewId && this.views[this.secondaryViewId]) {
                keep.add(this.views[this.secondaryViewId].view);
            }

            currentWin.getBrowserViews().forEach((view) => {
                if (!keep.has(view)) {
                    currentWin.removeBrowserView(view);
                }
            });
        }, 100);
    }

    createView(id, url, isIncognito) {
        const partition = isIncognito
            ? `incognito_session_${id}_${Date.now()}`
            : `persist:ai_sessions_v3_${id}`;

        const view = new this.BrowserView({
            webPreferences: {
                partition,
                preload: this.viewPreloadPath,
                spellcheck: true,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
            }
        });

        const session = view.webContents.session;
        const contents = view.webContents;
        session.setSpellCheckerLanguages(SPELLCHECK_LANGUAGES);
        session.setPermissionRequestHandler(createPermissionHandler());

        const theme = this.getTheme();
        view.setBackgroundColor(this.getThemeBg(theme));
        this.injectFlashCss(contents, theme);

        contents.on('did-navigate', () => {
            this.injectFlashCss(contents, this.getTheme());
        });
        contents.on('did-finish-load', () => {
            const currentTheme = this.getTheme();
            this.injectFlashCss(contents, currentTheme, 800);
            this.syncManagedSiteTheme(contents, currentTheme);
            [100, 500, 1500, 3000].forEach((ms) => {
                setTimeout(() => this.syncManagedSiteTheme(contents, this.getTheme()), ms);
            });
        });

        view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
            if (isSafeExternalUrl(targetUrl)) {
                shell.openExternal(targetUrl).catch(() => {});
            }

            return { action: 'deny' };
        });

        view.webContents.on('will-navigate', (event, targetUrl) => {
            if (!isSafeExternalUrl(targetUrl)) {
                event.preventDefault();
            }
        });

        view.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL) => {
            if (errorCode !== -3) {
                view.webContents.loadFile('error.html', { query: { url: validatedURL } });
            }
        });

        view.webContents.on('did-finish-load', async () => {
            try {
                const pageText = await view.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true);
                if (pageText && (pageText.includes('Sorry, you have been blocked') || pageText.includes('You are unable to access copilot.microsoft.com'))) {
                    view.webContents.loadFile('error.html', { query: { url: view.webContents.getURL() } });
                }
            } catch {
                // Ignore remote script execution errors from restricted pages.
            }
        });

        view.webContents.on('did-start-loading', () => {
            this.sendToWindow('ai-loading-status', { id, isLoading: true });
        });

        view.webContents.on('did-stop-loading', () => {
            this.sendToWindow('ai-loading-status', { id, isLoading: false });
        });

        session.on('will-download', (_event, item) => {
            item.setSaveDialogOptions({
                title: 'Save File',
                defaultPath: path.join(this.app.getPath('downloads'), item.getFilename()),
                buttonLabel: 'Save'
            });
        });

        view.webContents.on('context-menu', (_event, params) => {
            const items = [];

            if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
                params.dictionarySuggestions.forEach((suggestion) => {
                    items.push({
                        label: suggestion,
                        click: () => view.webContents.replaceMisspelling(suggestion)
                    });
                });
                items.push({ type: 'separator' });
            }

            if (view.webContents.canGoBack()) {
                items.push({ label: 'Back', click: () => view.webContents.goBack() });
            }
            if (view.webContents.canGoForward()) {
                items.push({ label: 'Forward', click: () => view.webContents.goForward() });
            }
            items.push({ label: 'Reload Frame', click: () => view.webContents.reload() });
            items.push({ type: 'separator' });

            items.push(
                { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
                { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
                { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
                { type: 'separator' }
            );

            if (params.mediaType === 'image') {
                items.push(
                    { label: 'Save Image As...', click: () => view.webContents.downloadURL(params.srcURL) },
                    { label: 'Copy Image', click: () => view.webContents.copyImageAt(params.x, params.y) },
                    { label: 'Copy Image Address', click: () => this.clipboard.writeText(params.srcURL) },
                    { type: 'separator' }
                );
            }

            if (params.linkURL) {
                items.push(
                    { label: 'Open Link in Browser', click: () => shell.openExternal(params.linkURL).catch(() => {}) },
                    { label: 'Copy Link Address', click: () => this.clipboard.writeText(params.linkURL) },
                    { type: 'separator' }
                );
            }

            if (items.length > 0) {
                this.Menu.buildFromTemplate(items).popup({ window: this.winRef() });
            }
        });

        view.webContents.loadURL(url);
        return { view, partition };
    }

    addAI({ id, url, isIncognito }) {
        if (this.views[id]) {
            return;
        }

        this.views[id] = this.createView(id, url, isIncognito);

        if (!this.isSplitMode) {
            this.activeViewId = id;
        } else {
            this.secondaryViewId = id;
            if (!this.activeViewId) {
                this.activeViewId = id;
            }
        }

        setTimeout(() => this.updatePositions(), 150);
    }

    removeAI(id) {
        const entry = this.views[id];
        if (!entry) {
            return;
        }

        const win = this.winRef();
        if (win && !win.isDestroyed()) {
            try {
                win.removeBrowserView(entry.view);
            } catch {
                // Ignore if detached already.
            }
        }

        try {
            entry.view.webContents.close({ waitForBeforeUnload: false });
        } catch {
            // Ignore close errors and keep destroying.
        }

        try {
            entry.view.webContents.destroy();
        } catch {
            // Ignore destroy races during shutdown.
        }

        delete this.views[id];

        if (this.activeViewId === id) {
            this.activeViewId = null;
            if (this.isSplitMode && this.secondaryViewId) {
                this.activeViewId = this.secondaryViewId;
                this.secondaryViewId = null;
            }
        }

        if (this.secondaryViewId === id) {
            this.secondaryViewId = null;
        }

        const remainingIds = Object.keys(this.views);
        if (this.isSplitMode && remainingIds.length < 2) {
            this.isSplitMode = false;
            this.secondaryViewId = null;
            if (remainingIds.length === 1) {
                this.activeViewId = remainingIds[0];
            }
            this.sendToWindow('sync-split-state', false);
        } else if (!this.activeViewId && remainingIds.length > 0) {
            this.activeViewId = remainingIds[0];
        }

        this.updatePositions();
    }

    reset() {
        Object.keys(this.views).forEach((id) => {
            this.removeAI(id);
        });
        this.views = {};
        this.isSplitMode = false;
        this.activeViewId = null;
        this.secondaryViewId = null;
    }

    hideCurrentView() {
        const win = this.winRef();
        if (!win || win.isDestroyed()) {
            return;
        }

        win.getBrowserViews().forEach((view) => {
            try {
                win.removeBrowserView(view);
            } catch {
                // Ignore removal errors.
            }
        });
    }

    switchTab(id) {
        if (!this.views[id]) {
            return;
        }

        if (!this.isSplitMode) {
            this.activeViewId = id;
        } else if (this.activeViewId !== id && this.secondaryViewId !== id) {
            this.secondaryViewId = id;
            if (!this.activeViewId) {
                this.activeViewId = id;
            }
        }

        this.updatePositions();
    }

    toggleSplit() {
        this.isSplitMode = !this.isSplitMode;

        if (!this.isSplitMode) {
            this.secondaryViewId = null;
        } else if (!this.secondaryViewId) {
            const next = Object.keys(this.views).find((id) => id !== this.activeViewId);
            if (next) {
                this.secondaryViewId = next;
            }
        }

        this.sendToWindow('sync-split-state', this.isSplitMode);
        this.updatePositions();
    }

    reloadAI(id) {
        const entry = this.views[id];
        if (entry) {
            entry.view.webContents.reload();
        }
    }

    showCurrentView() {
        this.updatePositions();
    }

    reloadAllAIs() {
        Object.values(this.views).forEach(({ view }) => {
            view.webContents.reload();
        });
    }

    broadcastPrompt(prompt) {
        if (!prompt) {
            return;
        }

        const script = `
            (function() {
                const text = ${JSON.stringify(prompt)};

                function simulateEnter(element) {
                    const eventInit = {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        keyCode: 13,
                        which: 13,
                        code: 'Enter',
                        key: 'Enter',
                        shiftKey: false
                    };
                    element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
                    element.dispatchEvent(new KeyboardEvent('keypress', eventInit));
                    setTimeout(() => {
                        element.dispatchEvent(new KeyboardEvent('keyup', eventInit));
                    }, 50);
                }

                let target = document.querySelector('textarea');
                if (!target) target = document.querySelector('div[contenteditable="true"]');
                if (!target) target = document.querySelector('input[type="text"]');

                const active = document.activeElement;
                if (active && (active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true' || active.tagName === 'INPUT')) {
                    target = active;
                }

                if (!target) return;

                target.focus();
                const usedExecCommand = document.execCommand && document.execCommand('insertText', false, text);

                if (!usedExecCommand || (target.value !== undefined && !target.value.includes(text)) || (target.innerText && !target.innerText.includes(text))) {
                    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
                        const proto = window[target.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement'].prototype;
                        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                        if (nativeSetter) {
                            nativeSetter.call(target, text);
                        } else {
                            target.value = text;
                        }
                    } else {
                        target.innerText = text;
                    }
                    target.dispatchEvent(new Event('input', { bubbles: true }));
                }

                setTimeout(() => {
                    simulateEnter(target);
                    setTimeout(() => {
                        const sendBtn = document.querySelector('button[aria-label*="Send"], button[aria-label*="Submit"], button[data-testid*="send"]');
                        if (sendBtn && !sendBtn.disabled) {
                            sendBtn.click();
                        }
                    }, 200);
                }, 100);
            })();
        `;

        Object.values(this.views).forEach(({ view }) => {
            view.webContents.executeJavaScript(script).catch((error) => {
                console.log('Broadcast error:', error);
            });
        });
    }

    buildManagedThemeSyncScript(theme) {
        const resolved = theme === 'light' ? 'light' : 'dark';
        return `
            (function() {
                const hosts = ['chat.qwen.ai', 'chat.z.ai', 'app.blackbox.ai', 'www.blackbox.ai', 'blackbox.ai'];
                if (!hosts.includes(location.hostname)) return;
                const resolved = ${JSON.stringify(resolved)};
                const bgMap = {
                    'chat.qwen.ai': { dark: '#171717', light: '#ffffff' },
                    'chat.z.ai': { dark: '#09090b', light: '#ffffff' },
                    'app.blackbox.ai': { dark: '#000000', light: '#ffffff' },
                    'www.blackbox.ai': { dark: '#000000', light: '#ffffff' },
                    'blackbox.ai': { dark: '#000000', light: '#ffffff' }
                };
                const bg = (bgMap[location.hostname] || { dark: '#09090b', light: '#ffffff' })[resolved];
                try {
                    localStorage.setItem('theme', resolved);
                    sessionStorage.setItem('theme', resolved);
                } catch (e) {}
                const root = document.documentElement;
                root.classList.remove('light', 'dark');
                root.classList.add(resolved);
                root.style.colorScheme = resolved;
                root.style.backgroundColor = bg;
                if (document.body) {
                    document.body.classList.remove('light', 'dark');
                    document.body.classList.add(resolved);
                    document.body.style.backgroundColor = bg;
                }
                const meta = document.querySelector('meta[name="theme-color"]');
                if (meta) meta.setAttribute('content', bg);
                try {
                    window.dispatchEvent(new StorageEvent('storage', {
                        key: 'theme', newValue: resolved, storageArea: localStorage
                    }));
                } catch (e) {}
            })();
        `;
    }

    syncManagedSiteTheme(contents, theme) {
        if (!contents || contents.isDestroyed()) {
            return;
        }
        contents.executeJavaScript(this.buildManagedThemeSyncScript(theme)).catch(() => {});
    }

    applyTheme(theme) {
        const bgColor = this.getThemeBg(theme);

        Object.values(this.views).forEach((entry) => {
            try {
                entry.view.setBackgroundColor(bgColor);
                this.injectFlashCss(entry.view.webContents, theme, 600);
                this.syncManagedSiteTheme(entry.view.webContents, theme);
                [100, 500, 1500].forEach((ms) => {
                    setTimeout(() => this.syncManagedSiteTheme(entry.view.webContents, theme), ms);
                });
            } catch {
                // Ignore views that are closing.
            }
        });
    }
}

module.exports = {
    ViewManager
};
