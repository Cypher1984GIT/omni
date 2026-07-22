var omni = window.omni || {
    send() {},
    on() { return () => {}; },
    openExternal(url) {
        if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }
};
const tabsContainer = document.getElementById('tabs');

const header = document.getElementById('header');
// Footer removed

const resizeObserver = new ResizeObserver(entries => {
    const headerHeight = header.offsetHeight;
    omni.send('update-layout', { headerHeight, footerHeight: 0 });
});
resizeObserver.observe(header);

omni.on('sync-split-state', (isActive) => {
    const btn = document.getElementById('split-btn');
    if (btn) {
        if (isActive) {
            btn.classList.add('active', 'bg-blue-600', 'text-white', 'border-blue-500', 'shadow-blue-900/20', 'shadow-lg');
            btn.classList.remove('bg-zinc-800', 'text-zinc-400', 'border-zinc-700/50', 'hover:bg-zinc-700', 'hover:text-zinc-100');
        } else {
            btn.classList.remove('active', 'bg-blue-600', 'text-white', 'border-blue-500', 'shadow-blue-900/20', 'shadow-lg');
            btn.classList.add('bg-zinc-800', 'text-zinc-400', 'border-zinc-700/50', 'hover:bg-zinc-700', 'hover:text-zinc-100');
        }
    }
    // Re-check buttons state (Ask All, etc.)
    checkEmptyState();
});

// --- KEYBOARD SHORTCUTS HANDLERS ---
omni.on('action-new-tab', () => {
    openLauncher();
});

omni.on('action-close-tab', () => {
    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) {
        // Find the close button inside the active tab and click it
        const closeIcon = activeBtn.querySelector('.close-tab');
        if (closeIcon) closeIcon.click();
    } else {
        // If in launcher, close launcher?
        closeLauncher();
    }
});

omni.on('action-reload-current', () => {
    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) {
        const reloadIcon = activeBtn.querySelector('.reload-tab');
        if (reloadIcon) reloadIcon.click();
    } else {
        // Maybe reload launcher? No need.
    }
});

omni.on('action-next-tab', () => {
    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) {
        const next = activeBtn.nextElementSibling;
        if (next) next.click();
        else {
            // Cycle to start
            const first = tabsContainer.firstElementChild;
            if (first) first.click();
        }
    } else if (tabsContainer.firstElementChild) {
        tabsContainer.firstElementChild.click();
    }
});

omni.on('action-prev-tab', () => {
    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) {
        const prev = activeBtn.previousElementSibling;
        if (prev) prev.click();
        else {
            // Cycle to end
            const last = tabsContainer.lastElementChild;
            if (last) last.click();
        }
    } else if (tabsContainer.lastElementChild) {
        tabsContainer.lastElementChild.click();
    }
});

omni.on('action-jump-tab', (index) => {
    const buttons = tabsContainer.querySelectorAll('button');
    if (buttons[index]) {
        buttons[index].click();
    }
});

// Global Keyboard Listeners
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        // 1. Priority: Close open modals
        const modals = [
            { id: 'broadcast-modal', close: closeBroadcastModal },
            { id: 'custom-app-modal', close: closeCustomModal },
            { id: 'alert-modal', close: closeAlertModal },
            { id: 'confirmation-modal', close: closeModal },
            { id: 'help-modal', close: closeHelpModal },
            { id: 'about-modal', close: closeAboutModal }
        ];

        for (const modal of modals) {
            const el = document.getElementById(modal.id);
            if (el && !el.classList.contains('hidden')) {
                modal.close();
                if (document.activeElement) document.activeElement.blur();
                return;
            }
        }

        // 2. If no modals, try to close Launcher
        const launcher = document.getElementById('app-launcher');
        if (launcher && !launcher.classList.contains('hidden')) {
            closeLauncher();
            if (document.activeElement) document.activeElement.blur();
        }
    }
});
// -----------------------------------




omni.on('ai-loading-status', ({ id, isLoading }) => {
    const btn = document.querySelector(`button[data-id="${id}"]`);
    if (btn) {
        const reloadIcon = btn.querySelector('.reload-tab');
        // Use Tailwind's animate-spin class instead of custom 'spinning'
        if (isLoading) {
            reloadIcon.classList.add('animate-spin');
        } else {
            reloadIcon.classList.remove('animate-spin');
        }
    }
});

const allAIs = [
    { name: 'ChatGPT', url: 'https://chatgpt.com' },
    { name: 'Gemini', url: 'https://gemini.google.com' },
    { name: 'Grok', url: 'https://grok.com', requiresLogin: true },
    { name: 'Copilot', url: 'https://copilot.microsoft.com', requiresLogin: true },
    { name: 'Claude', url: 'https://claude.ai', requiresLogin: true },
    { name: 'Perplexity', url: 'https://www.perplexity.ai', requiresLogin: true },
    { name: 'Poe', url: 'https://poe.com', requiresLogin: true },
    { name: 'DeepSeek', url: 'https://chat.deepseek.com', requiresLogin: true },
    { name: 'Mistral', url: 'https://chat.mistral.ai', requiresLogin: true },
    { name: 'HuggingChat', url: 'https://huggingface.co/chat', requiresLogin: true },
    { name: 'Meta AI', url: 'https://www.meta.ai', requiresLogin: true },
    { name: 'Duck.ai', url: 'https://duck.ai', isPrivate: true },
    { name: 'Lumo', url: 'https://lumo.proton.me', isPrivate: true }
];

function showIncognitoLoginRequiredAlert(name) {
    showAlert(
        'Mode Restricted',
        `${name} does not support Incognito Mode because it requires a persistent login session.`
    );
}

function slugify(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'tab';
}

function stableHash(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

function parseAppUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function buildTabId(name, url, isIncognito) {
    const normalized = `${slugify(name)}-${stableHash(url)}`;
    return isIncognito ? `${normalized}-incog` : normalized;
}

function createIconElement(url, className) {
    const img = document.createElement('img');
    img.src = `https://www.google.com/s2/favicons?sz=64&domain=${url.hostname}`;
    img.className = className;
    img.alt = '';
    return img;
}

function createTab(name, url, isIncognito = false, isActive = false) {
    const parsedUrl = parseAppUrl(url);
    if (!parsedUrl) {
        showAlert('Invalid URL', 'Please enter a valid http or https URL.');
        return null;
    }

    const id = buildTabId(name, parsedUrl.toString(), isIncognito);

    // Verificar si ya existe
    const existingBtn = document.querySelector(`button[data-id="${id}"]`);
    if (existingBtn) {
        existingBtn.click();
        return existingBtn;
    }

    const btn = document.createElement('button');
    btn.dataset.id = id; // Guardar ID para verificar duplicados
    btn.dataset.url = parsedUrl.toString(); // Save URL for persistence
    btn.dataset.name = name; // Save Name for persistence
    btn.dataset.incognito = isIncognito; // Save mode

    // Tailwind-based classes for the tab button
    // 'group' allows children to react to button hover
    // Base classes common to both states
    const baseClasses = "group relative flex items-center h-9 px-3 min-w-[140px] max-w-[200px] border rounded-lg transition-all cursor-pointer select-none snap-start";

    // Active state classes
    const activeClasses = "active bg-zinc-300 dark:bg-zinc-600 text-zinc-900 dark:text-white border-zinc-400 dark:border-zinc-500 shadow-md ring-1 ring-black/5 dark:ring-white/10";

    // Inactive state classes
    const inactiveClasses = "bg-zinc-200 dark:bg-zinc-800/50 hover:bg-zinc-300 dark:hover:bg-zinc-800 border-zinc-300 dark:border-zinc-700/50 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200";

    btn.className = `${baseClasses} ${isActive ? activeClasses : inactiveClasses}`;

    if (isIncognito) {
        const incognitoBadge = document.createElement('span');
        incognitoBadge.className = 'text-xs mr-2 opacity-60';
        incognitoBadge.textContent = '🕵️';
        btn.appendChild(incognitoBadge);
    }

    btn.appendChild(createIconElement(parsedUrl, 'w-4 h-4 rounded-sm mr-2 opacity-70 group-hover:opacity-100 transition-opacity'));

    const nameLabel = document.createElement('span');
    nameLabel.className = 'text-xs font-medium truncate flex-1 text-left';
    nameLabel.textContent = name;
    btn.appendChild(nameLabel);

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2';
    actions.innerHTML = `
        <span class="reload-tab p-1 rounded-md hover:bg-zinc-300 dark:hover:bg-zinc-600/80 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white transition-colors" title="Reload">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </span>
        <span class="close-tab p-1 rounded-md hover:bg-red-200 dark:hover:bg-red-500/20 text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Close">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </span>
    `;
    btn.appendChild(actions);

    // Event listeners for actions
    const reloadBtn = btn.querySelector('.reload-tab');
    const closeBtn = btn.querySelector('.close-tab');

    // No need for JS hover effects anymore, Tailwind handles it.

    reloadBtn.onclick = (e) => {
        e.stopPropagation();
        // Add spinning class via Tailwind animation
        reloadBtn.classList.add('animate-spin');
        omni.send('reload-ai', id);
    };

    closeBtn.onclick = (e) => {
        e.stopPropagation(); // Evitar que seleccione la pestaña al cerrarla

        let alreadyRemoved = false;
        // Si la pestaña estaba activa, intentar cambiar a otra
        if (btn.classList.contains('active')) {
            const sibling = btn.previousElementSibling || btn.nextElementSibling;
            if (sibling) sibling.click();
            else {
                omni.send('remove-ai', id); // Si era la única, enviamos remove igual y quedará vacío
                alreadyRemoved = true;
            }
        }

        btn.remove();
        if (!alreadyRemoved) {
            omni.send('remove-ai', id);
        }
        saveTabs();
        checkEmptyState();
    };

    btn.onclick = () => {
        // Reset siblings to inactive
        document.querySelectorAll('#tabs button').forEach(b => {
            b.classList.remove('active', 'bg-zinc-300', 'dark:bg-zinc-600', 'text-zinc-900', 'dark:text-white', 'border-zinc-400', 'dark:border-zinc-500', 'shadow-md', 'ring-1', 'ring-black/5', 'dark:ring-white/10');
            b.classList.add('bg-zinc-200', 'dark:bg-zinc-800/50', 'text-zinc-600', 'dark:text-zinc-400', 'border-zinc-300', 'dark:border-zinc-700/50', 'hover:bg-zinc-300', 'dark:hover:bg-zinc-800');
        });

        // Set active
        btn.classList.remove('bg-zinc-200', 'dark:bg-zinc-800/50', 'text-zinc-600', 'dark:text-zinc-400', 'border-zinc-300', 'dark:border-zinc-700/50', 'hover:bg-zinc-300', 'dark:hover:bg-zinc-800');
        btn.classList.add('active', 'bg-zinc-300', 'dark:bg-zinc-600', 'text-zinc-900', 'dark:text-white', 'border-zinc-400', 'dark:border-zinc-500', 'shadow-md', 'ring-1', 'ring-black/5', 'dark:ring-white/10');

        localStorage.setItem('omni-active-tab', id); // Save active tab
        omni.send('switch-tab', id);

        // Ensure launcher is hidden when switching to a tab
        const launcher = document.getElementById('app-launcher');
        launcher.classList.add('hidden');
        launcher.classList.remove('flex');

        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    };

    // Drag and Drop
    btn.draggable = true;
    btn.addEventListener('dragstart', () => {
        btn.classList.add('dragging');
    });
    btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        saveTabs();
    });

    tabsContainer.appendChild(btn);
    omni.send('add-ai', { id, url: parsedUrl.toString(), isIncognito });
    updateScrollButtons();
    checkEmptyState();
    saveTabs();
    return btn;
}

function saveTabs() {
    const tabs = [];
    const buttons = tabsContainer.querySelectorAll('button');
    buttons.forEach(btn => {
        const name = btn.dataset.name;
        const url = btn.dataset.url;
        const isIncognito = btn.dataset.incognito === 'true';
        tabs.push({ name, url, isIncognito });
    });
    localStorage.setItem('omni-tabs', JSON.stringify(tabs));
}

function checkEmptyState() {
    const launcher = document.getElementById('app-launcher');
    const splitBtn = document.getElementById('split-btn');
    const closeLauncherBtn = document.getElementById('close-launcher');
    const count = tabsContainer.children.length;

    if (count === 0) {
        launcher.classList.remove('hidden');
        launcher.classList.add('flex');
        closeLauncherBtn.classList.add('hidden');
    } else {
        // If launcher is open, we keep it visible, but if we have tabs we might want to hide it
        // Logic handled by toggleLauncher
        closeLauncherBtn.classList.remove('hidden');
    }

    // Disable split button and ask-all button visually if < 2 tabs
    const askAllBtn = document.getElementById('ask-all-btn');
    const reloadAllBtn = document.querySelector('.reload-all-btn');
    const isSplitActive = splitBtn.classList.contains('active');

    const disabledClasses = ['opacity-30', 'grayscale', 'cursor-not-allowed', 'pointer-events-none'];

    if (count < 2) {
        splitBtn.classList.add(...disabledClasses);
        if (askAllBtn) askAllBtn.classList.add(...disabledClasses);
        if (reloadAllBtn) reloadAllBtn.classList.add(...disabledClasses);
    } else {
        splitBtn.classList.remove(...disabledClasses);
        if (reloadAllBtn) reloadAllBtn.classList.remove(...disabledClasses);

        if (askAllBtn) {
            askAllBtn.style.opacity = '';
            askAllBtn.style.cursor = '';

            if (isSplitActive) {
                askAllBtn.classList.add(...disabledClasses);
            } else {
                askAllBtn.classList.remove(...disabledClasses);
            }
        }
    }
    updateScrollButtons();

    // Always refresh launcher status when tabs change to keep cards in sync
    // A small delay ensures the DOM has updated and is ready for querying
    setTimeout(() => {
        const launcher = document.getElementById('app-launcher');
        if (launcher) renderLauncher();
    }, 50);
}

function renderLauncher() {
    const grid = document.getElementById('launcher-grid');
    if (!grid) return; // Guard

    const isIncognitoMode = document.getElementById('incognito-check').checked;
    grid.innerHTML = '';

    // Get all current tab IDs to check for status
    const activeTabIds = Array.from(tabsContainer.querySelectorAll('button')).map(b => b.dataset.id);

    allAIs.forEach(ai => {
        const parsedUrl = parseAppUrl(ai.url);
        if (!parsedUrl) return;
        const normalizedUrl = parsedUrl.toString();
        const id = buildTabId(ai.name, normalizedUrl, isIncognitoMode);
        const isAlreadyAdded = activeTabIds.includes(id);
        const blocksIncognito = isIncognitoMode && ai.requiresLogin;

        const card = document.createElement('div');

        if (isAlreadyAdded) {
            card.className = "group relative bg-zinc-100 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800/30 rounded-2xl p-6 flex flex-col items-center gap-3 opacity-60 cursor-not-allowed";
            card.title = `${ai.name} (${isIncognitoMode ? 'Incognito' : 'Standard'}) is already open.`;
        } else if (blocksIncognito) {
            card.className = "group relative bg-zinc-100 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800/30 rounded-2xl p-6 flex flex-col items-center gap-3 opacity-60 cursor-pointer";
            card.title = `${ai.name} requires login and cannot be opened in Incognito Mode.`;
            card.onclick = () => showIncognitoLoginRequiredAlert(ai.name);
        } else {
            card.className = "group relative bg-white dark:bg-zinc-900/80 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-2xl p-6 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/50 flex flex-col items-center gap-3";
            card.onclick = () => addFromHome(ai.name, normalizedUrl, ai.requiresLogin);
        }

        card.appendChild(createIconElement(parsedUrl, `w-12 h-12 rounded-xl shadow-lg opacity-80 group-hover:opacity-100 transition-all ${isAlreadyAdded || blocksIncognito ? '' : 'group-hover:scale-110'}`));

        const content = document.createElement('div');
        content.className = 'flex flex-col items-center gap-1 mt-2';

        const title = document.createElement('span');
        title.className = 'text-xs font-bold text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors uppercase tracking-tight text-center';
        title.textContent = ai.name;
        content.appendChild(title);

        if (ai.isPrivate) {
            const badge = document.createElement('span');
            badge.className = 'text-[9px] font-bold bg-green-500/10 text-green-500/80 px-2 py-0.5 rounded-full border border-green-500/20 uppercase tracking-widest mt-1';
            badge.textContent = 'Private';
            content.appendChild(badge);
        }

        card.appendChild(content);

        grid.appendChild(card);
    });

    // Add Custom Card
    const customCard = document.createElement('div');
    customCard.className = "group bg-white dark:bg-zinc-900/80 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-2xl p-6 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/50 flex flex-col items-center gap-3";
    customCard.innerHTML = `
        <div class="w-12 h-12 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 rounded-xl text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-white text-3xl font-light shadow-lg transition-all group-hover:scale-110">
            +
        </div>
        <span class="text-sm font-semibold text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 transition-colors uppercase tracking-tight">Custom</span>
    `;
    customCard.onclick = () => openCustomModal();
    grid.appendChild(customCard);
}

window.onload = () => {
    // Sync Theme with Main Process (DOM already handled by inline script in index.html to avoid flicker)
    const savedTheme = localStorage.getItem('omni-theme') || 'dark';
    // We still send the IPC message to ensure main process is in sync
    omni.send('theme-changed', savedTheme);

    renderLauncher();

    // Re-enable transitions after a short delay to ensure initial paint is done
    setTimeout(() => {
        const noTransitions = document.getElementById('no-transitions');
        if (noTransitions) noTransitions.remove();
        document.body.classList.add('transition-colors', 'duration-200');
    }, 100);

    const saved = localStorage.getItem('omni-tabs');
    let loaded = false;

    if (saved) {
        try {
            const tabs = JSON.parse(saved);
            if (Array.isArray(tabs) && tabs.length > 0) {
                const lastActive = localStorage.getItem('omni-active-tab');
                tabs.forEach((t) => {
                    // Check if this tab matches the last active one
                    // We construct the ID effectively again here to check match
                    const id = buildTabId(t.name, t.url, t.isIncognito);
                    const isActive = (lastActive === id);
                    createTab(t.name, t.url, t.isIncognito, isActive);
                });
                loaded = true;

                // Sync view with active tab without clicking (visuals already set)
                if (lastActive) {
                    omni.send('switch-tab', lastActive);
                    // Ensure launcher matches state
                    const launcher = document.getElementById('app-launcher');
                    launcher.classList.add('hidden');
                    launcher.classList.remove('flex');
                } else {
                    if (tabsContainer.firstElementChild) tabsContainer.firstElementChild.click();
                }
            }
        } catch (e) {
            console.error("Error loading saved tabs:", e);
        }
    }

    if (!loaded) {
        // We no longer add default AIs, the app starts at the Launcher
    }

    checkEmptyState();

    // Re-render when incognito toggle changes
    document.getElementById('incognito-check').addEventListener('change', () => renderLauncher());

    setTimeout(updateScrollButtons, 100);
};

const scrollLeftBtn = document.getElementById('scroll-left');
const scrollRightBtn = document.getElementById('scroll-right');

function scrollTabs(direction) {
    const scrollAmount = 200;
    tabsContainer.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
}

function updateScrollButtons() {
    // Check if content overflows
    if (tabsContainer.scrollWidth > tabsContainer.clientWidth) {
        // Show/Hide based on position
        scrollLeftBtn.style.display = tabsContainer.scrollLeft > 0 ? 'block' : 'none';
        scrollRightBtn.style.display =
            (tabsContainer.scrollLeft + tabsContainer.clientWidth < tabsContainer.scrollWidth - 1)
                ? 'block' : 'none';
    } else {
        scrollLeftBtn.style.display = 'none';
        scrollRightBtn.style.display = 'none';
    }
}

tabsContainer.addEventListener('scroll', updateScrollButtons);
window.addEventListener('resize', updateScrollButtons);

function openLauncher() {
    const launcher = document.getElementById('app-launcher');
    // Store current state but always try to show
    omni.send('hide-current-view');
    launcher.classList.remove('hidden');
    launcher.classList.add('flex');
}

function closeLauncher() {
    const launcher = document.getElementById('app-launcher');
    // Only allow hiding if we have tabs
    if (tabsContainer.children.length > 0) {
        launcher.classList.add('hidden');
        launcher.classList.remove('flex');

        const activeBtn = document.querySelector('#tabs button.active');
        if (activeBtn) omni.send('show-current-view', activeBtn.dataset.id);
    }
}

function addFromHome(name, url, requiresLogin = false) {
    const incognitoCheck = document.getElementById('incognito-check');
    const isIncognito = incognitoCheck.checked;

    if (isIncognito && requiresLogin) {
        showIncognitoLoginRequiredAlert(name);
        return;
    }

    const btn = createTab(name, url, isIncognito);
    if (!btn) {
        return;
    }
    btn.click();
    incognitoCheck.checked = false;

    // Use the safe close function
    closeLauncher();
}

/* Generic Alert Functions */
function showAlert(title, message) {
    omni.send('hide-current-view'); // Ensure webviews don't cover it
    document.getElementById('alert-title').textContent = title;
    document.getElementById('alert-message').textContent = message;

    const modal = document.getElementById('alert-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeAlertModal() {
    const modal = document.getElementById('alert-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');

    const launcher = document.getElementById('app-launcher');
    const isLauncherVisible = !launcher.classList.contains('hidden');

    // Restore active view ONLY if launcher is NOT visible
    // This prevents the webview from covering the launcher when an alert is dismissed
    if (!isLauncherVisible) {
        const activeBtn = document.querySelector('#tabs button.active');
        if (activeBtn) {
            omni.send('show-current-view', activeBtn.dataset.id);
        }
    }
}

function reloadAll() {
    omni.send('reload-all-ais');
}

function toggleSplit() {
    try {
        const btn = document.getElementById('split-btn');
        const tabCount = tabsContainer.querySelectorAll('button').length;

        if (!btn) return;

        // Check if we are trying to ENABLE split mode
        if (!btn.classList.contains('active')) {
            if (tabCount < 2) {
                // Silently ignore click if not enough tabs
                return;
            }
        }

        omni.send('toggle-split');
        btn.classList.toggle('active');

        // Let the centralized function handle button states
        checkEmptyState();

    } catch (e) {
        console.error("JS Error in toggleSplit: " + e.message);
        showAlert("Error", "An error occurred: " + e.message);
    }
}

function resetDefaults() {
    omni.send('hide-current-view');
    const modal = document.getElementById('confirmation-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeModal() {
    const modal = document.getElementById('confirmation-modal');
    modal.style.display = '';
    modal.classList.add('hidden');
    modal.classList.remove('flex');

    const launcher = document.getElementById('app-launcher');
    if (!launcher.classList.contains('hidden')) return;

    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) {
        omni.send('show-current-view', activeBtn.dataset.id);
    }
}

function confirmReset() {
    omni.send('reset-all');
    localStorage.removeItem('omni-tabs');
    localStorage.removeItem('omni-active-tab');
    localStorage.removeItem('omni-theme');
    document.documentElement.classList.add('dark');
    tabsContainer.innerHTML = '';
    const splitBtn = document.getElementById('split-btn');
    if (splitBtn) {
        splitBtn.classList.remove('active', 'bg-blue-600', 'text-white', 'border-blue-500', 'shadow-blue-900/20', 'shadow-lg');
    }
    closeModal();
    location.reload();
}

/* Broadcast Modal Functions */
function openBroadcastModal() {
    const splitBtn = document.getElementById('split-btn');
    if (tabsContainer.children.length < 2) return; // Silent return if not enough tabs
    if (splitBtn && splitBtn.classList.contains('active')) return; // Silent return if split mode is on

    omni.send('hide-current-view');
    const modal = document.getElementById('broadcast-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        document.getElementById('broadcast-input').focus();
    }, 100);
}

function closeBroadcastModal() {
    const modal = document.getElementById('broadcast-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');

    const launcher = document.getElementById('app-launcher');
    if (!launcher.classList.contains('hidden')) return;

    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) {
        omni.send('show-current-view', activeBtn.dataset.id);
    }
}

/* Help & About Modal Functions */
function openHelpModal() {
    omni.send('hide-current-view');
    const modal = document.getElementById('help-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeHelpModal() {
    const modal = document.getElementById('help-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');

    const launcher = document.getElementById('app-launcher');
    if (!launcher.classList.contains('hidden')) return;

    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) omni.send('show-current-view', activeBtn.dataset.id);
}

function openAboutModal() {
    closeHelpModal();
    omni.send('hide-current-view');
    const modal = document.getElementById('about-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeAboutModal() {
    const modal = document.getElementById('about-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');

    const launcher = document.getElementById('app-launcher');
    if (!launcher.classList.contains('hidden')) return;

    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) omni.send('show-current-view', activeBtn.dataset.id);
}

function sendBroadcast() {
    const input = document.getElementById('broadcast-input');
    const prompt = input.value;
    if (prompt.trim()) {
        omni.send('broadcast-prompt', prompt);
        input.value = ''; // Clear input
        closeBroadcastModal();
    }
}

/* Custom App Modal Functions */
function openCustomModal() {
    omni.send('hide-current-view');
    const modal = document.getElementById('custom-app-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const nameInput = document.getElementById('custom-name');
    const urlInput = document.getElementById('custom-url');

    setTimeout(() => {
        nameInput.focus();
    }, 100);

    // Enter key support
    urlInput.onkeyup = (e) => {
        if (e.key === 'Enter') addCustomApp();
    };
    nameInput.onkeyup = (e) => {
        if (e.key === 'Enter') urlInput.focus();
    };
}

function closeCustomModal() {
    const modal = document.getElementById('custom-app-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');

    // Clear inputs
    document.getElementById('custom-name').value = '';
    document.getElementById('custom-url').value = '';

    const launcher = document.getElementById('app-launcher');
    if (!launcher.classList.contains('hidden')) return;

    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) {
        omni.send('show-current-view', activeBtn.dataset.id);
    }
}

function addCustomApp() {
    const name = document.getElementById('custom-name').value.trim();
    let url = document.getElementById('custom-url').value.trim();
    const isIncognito = document.getElementById('incognito-check').checked;

    if (!name || !url) {
        showAlert('Missing Info', 'Please fill in both name and URL fields.');
        return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    const parsedUrl = parseAppUrl(url);
    if (!parsedUrl) {
        showAlert('Invalid URL', 'Please enter a valid http or https URL.');
        return;
    }

    const btn = createTab(name, parsedUrl.toString(), isIncognito);
    if (!btn) {
        return;
    }
    btn.click();
    closeCustomModal();
    document.getElementById('incognito-check').checked = false;
}


tabsContainer.addEventListener('dragover', e => {
    e.preventDefault();
    const afterElement = getDragAfterElement(tabsContainer, e.clientX);
    const draggable = document.querySelector('.dragging');
    if (draggable) {
        if (afterElement == null) {
            tabsContainer.appendChild(draggable);
        } else {
            tabsContainer.insertBefore(draggable, afterElement);
        }
    }
});

function getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('button:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Auto-Update Logic Integrated into Help Menu
let updateUrl = "";
let currentAppVersion = "---";

// HTML Elements
const helpVersionText = document.getElementById('help-version-text');
const updateActionBtn = document.getElementById('update-action-btn');
const versionStatusBadge = document.getElementById('version-status-badge');
const helpNotificationDot = document.getElementById('help-notification-dot');

omni.on('app-version', (version) => {
    currentAppVersion = version;
    if (helpVersionText) helpVersionText.textContent = `v${version}`;
    const aboutVer = document.getElementById('about-version');
    if (aboutVer) aboutVer.textContent = `Version ${version}`;
});

omni.on('update-status', (text) => {
    if (text.includes('App is up to date') || text.includes('Client is up to date')) {
        if (versionStatusBadge) {
            versionStatusBadge.classList.remove('hidden');
            versionStatusBadge.textContent = "Latest";
        }
        if (helpVersionText) helpVersionText.textContent = `v${currentAppVersion}`;
    } else if (text.toLowerCase().includes('error')) {
        if (helpVersionText) helpVersionText.textContent = "Error checking";
        console.error(text);
    } else {
        if (helpVersionText) helpVersionText.textContent = "Checking...";
    }
});

omni.on('update-available', (info) => {
    updateUrl = info.url;

    // 1. Show Red Dot on Help Icon
    if (helpNotificationDot) {
        helpNotificationDot.classList.remove('hidden');
    }

    // 2. Update Help Menu UI
    if (helpVersionText) helpVersionText.textContent = `v${currentAppVersion}`;

    if (versionStatusBadge) {
        versionStatusBadge.textContent = "UPDATE AVAILABLE";
        versionStatusBadge.classList.remove('bg-zinc-800', 'text-zinc-400', 'hidden');
        versionStatusBadge.classList.add('bg-green-500/10', 'text-green-500', 'border', 'border-green-500/20');
    }

    if (updateActionBtn) {
        updateActionBtn.classList.remove('hidden');
        updateActionBtn.classList.add('inline-flex');
    }
});

function restartAndInstall() {
    if (updateUrl) {
        omni.send('install-update', updateUrl);
    }
}

function toggleTheme() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('omni-theme', 'light');
        omni.send('theme-changed', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('omni-theme', 'dark');
        omni.send('theme-changed', 'dark');
    }
}
