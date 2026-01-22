const { ipcRenderer } = require('electron');
const tabsContainer = document.getElementById('tabs');
const selectContainer = document.getElementById('popular-ais');

const header = document.getElementById('header');
// Footer removed

const resizeObserver = new ResizeObserver(entries => {
    const headerHeight = header.offsetHeight;
    ipcRenderer.send('update-layout', { headerHeight, footerHeight: 0 });
});
resizeObserver.observe(header);

ipcRenderer.on('sync-split-state', (event, isActive) => {
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
ipcRenderer.on('action-new-tab', () => {
    openLauncher();
});

ipcRenderer.on('action-close-tab', () => {
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

ipcRenderer.on('action-reload-current', () => {
    const activeBtn = document.querySelector('#tabs button.active');
    if (activeBtn) {
        const reloadIcon = activeBtn.querySelector('.reload-tab');
        if (reloadIcon) reloadIcon.click();
    } else {
        // Maybe reload launcher? No need.
    }
});

ipcRenderer.on('action-next-tab', () => {
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

ipcRenderer.on('action-prev-tab', () => {
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

ipcRenderer.on('action-jump-tab', (event, index) => {
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




ipcRenderer.on('ai-loading-status', (event, { id, isLoading }) => {
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
    { name: 'ChatGPT', url: 'https://chat.openai.com' },
    { name: 'Gemini', url: 'https://gemini.google.com' },
    { name: 'Grok', url: 'https://grok.com' },
    { name: 'Copilot', url: 'https://copilot.microsoft.com' },
    { name: 'Claude', url: 'https://claude.ai' },
    { name: 'Perplexity', url: 'https://www.perplexity.ai' },
    { name: 'Blackbox', url: 'https://www.blackbox.ai/' },
    { name: 'DeepSeek', url: 'https://chat.deepseek.com' },
    { name: 'Qwen', url: 'https://chat.qwen.ai/' },
    { name: 'Z.ai', url: 'https://chat.z.ai/' },
    { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=DuckDuckGo+AI+Chat&ia=chat', isPrivate: true },
    { name: 'Lumo', url: 'https://lumo.proton.me', isPrivate: true },
    { name: 'Okara', url: 'https://okara.ai/', isPrivate: true }
];

function createTab(name, url, isIncognito = false) {
    const id = name.toLowerCase().replace(/\s/g, '-') + (isIncognito ? '-incog' : '');

    // Verificar si ya existe
    const existingBtn = document.querySelector(`button[data-id="${id}"]`);
    if (existingBtn) {
        existingBtn.click();
        return existingBtn;
    }

    const btn = document.createElement('button');
    btn.dataset.id = id; // Guardar ID para verificar duplicados
    btn.dataset.url = url; // Save URL for persistence
    btn.dataset.name = name; // Save Name for persistence
    btn.dataset.incognito = isIncognito; // Save mode

    // Tailwind-based classes for the tab button
    // 'group' allows children to react to button hover
    btn.className = "group relative flex items-center h-9 px-3 min-w-[140px] max-w-[200px] bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 rounded-lg transition-all cursor-pointer select-none text-zinc-400 hover:text-zinc-200 snap-start";

    const icon = `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`;
    const incognitoBadge = isIncognito ? '<span class="text-xs mr-2 opacity-60">🕵️</span>' : '';

    btn.innerHTML = `
        ${incognitoBadge}
        <img src="${icon}" class="w-4 h-4 rounded-sm mr-2 opacity-70 group-hover:opacity-100 transition-opacity"> 
        <span class="text-xs font-medium truncate flex-1 text-left">${name}</span>
        
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
            <span class="reload-tab p-1 rounded-md hover:bg-zinc-600/80 text-zinc-400 hover:text-white transition-colors" title="Reload">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </span>
            <span class="close-tab p-1 rounded-md hover:bg-red-500/20 hover:text-red-400 text-zinc-400 transition-colors" title="Close">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </span>
        </div>
    `;



    // Event listeners for actions
    const reloadBtn = btn.querySelector('.reload-tab');
    const closeBtn = btn.querySelector('.close-tab');

    // No need for JS hover effects anymore, Tailwind handles it.

    reloadBtn.onclick = (e) => {
        e.stopPropagation();
        // Add spinning class via Tailwind animation
        reloadBtn.classList.add('animate-spin');
        ipcRenderer.send('reload-ai', id);
    };

    closeBtn.onclick = (e) => {
        e.stopPropagation(); // Evitar que seleccione la pestaña al cerrarla

        // Si la pestaña estaba activa, intentar cambiar a otra
        if (btn.classList.contains('active')) {
            const sibling = btn.previousElementSibling || btn.nextElementSibling;
            if (sibling) sibling.click();
            else ipcRenderer.send('remove-ai', id); // Si era la única, enviamos remove igual y quedará vacío
        }

        btn.remove();
        ipcRenderer.send('remove-ai', id);
        saveTabs();
        checkEmptyState();
    };

    btn.onclick = () => {
        // Reset siblings to inactive
        document.querySelectorAll('#tabs button').forEach(b => {
            b.classList.remove('active', 'bg-zinc-600', 'text-white', 'border-zinc-500', 'shadow-md', 'ring-1', 'ring-white/10');
            b.classList.add('bg-zinc-800/50', 'text-zinc-400', 'border-zinc-700/50', 'hover:bg-zinc-800');
        });

        // Set active
        btn.classList.remove('bg-zinc-800/50', 'text-zinc-400', 'border-zinc-700/50', 'hover:bg-zinc-800');
        btn.classList.add('active', 'bg-zinc-600', 'text-white', 'border-zinc-500', 'shadow-md', 'ring-1', 'ring-white/10');

        localStorage.setItem('omni-active-tab', id); // Save active tab
        ipcRenderer.send('switch-tab', id);

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
    ipcRenderer.send('add-ai', { id, url, isIncognito });
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

    updateScrollButtons();

    // Always refresh launcher status when tabs change to keep cards in sync
    // A small delay ensures the DOM has updated and is ready for querying
    setTimeout(() => {
        const launcher = document.getElementById('app-launcher');
        if (launcher) renderLauncher();
    }, 50);
}

function renderLauncher() {
    const launcher = document.getElementById('app-launcher');
    const grid = document.getElementById('launcher-grid');
    if (!grid) return; // Guard

    const isIncognitoMode = document.getElementById('incognito-check').checked;
    grid.innerHTML = '';

    // Get all current tab IDs to check for status
    const activeTabIds = Array.from(tabsContainer.querySelectorAll('button')).map(b => b.dataset.id);

    allAIs.forEach(ai => {
        const id = ai.name.toLowerCase().replace(/\s/g, '-') + (isIncognitoMode ? '-incog' : '');
        const isAlreadyAdded = activeTabIds.includes(id);

        const card = document.createElement('div');

        if (isAlreadyAdded) {
            card.className = "group relative bg-zinc-900/50 border border-zinc-800/30 rounded-2xl p-6 flex flex-col items-center gap-3 opacity-60 cursor-not-allowed";
            // Brief informative title on hover even if disabled
            card.title = `${ai.name} (${isIncognitoMode ? 'Incognito' : 'Standard'}) is already open.`;
        } else {
            card.className = "group relative bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-6 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50 flex flex-col items-center gap-3";
            card.onclick = () => addFromHome(ai.name, ai.url);
        }

        const icon = `https://www.google.com/s2/favicons?sz=64&domain=${new URL(ai.url).hostname}`;
        const privateBadge = ai.isPrivate ? `
            <span class="text-[9px] font-bold bg-green-500/10 text-green-500/80 px-2 py-0.5 rounded-full border border-green-500/20 uppercase tracking-widest mt-1">
                Private
            </span>
        ` : '';

        card.innerHTML = `
            <img src="${icon}" class="w-12 h-12 rounded-xl shadow-lg opacity-80 group-hover:opacity-100 transition-all ${isAlreadyAdded ? '' : 'group-hover:scale-110'}">
            <div class="flex flex-col items-center gap-1 mt-2">
                <span class="text-xs font-bold text-zinc-400 group-hover:text-zinc-100 transition-colors uppercase tracking-tight text-center">${ai.name}</span>
                ${privateBadge}
            </div>
        `;

        grid.appendChild(card);
    });

    // Add Custom Card
    const customCard = document.createElement('div');
    customCard.className = "group bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-6 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50 flex flex-col items-center gap-3";
    customCard.innerHTML = `
        <div class="w-12 h-12 flex items-center justify-center bg-zinc-800 rounded-xl text-zinc-500 group-hover:text-white text-3xl font-light shadow-lg transition-all group-hover:scale-110">
            +
        </div>
        <span class="text-sm font-semibold text-zinc-400 group-hover:text-zinc-200 transition-colors uppercase tracking-tight">Custom</span>
    `;
    customCard.onclick = () => openCustomModal();
    grid.appendChild(customCard);
}

window.onload = () => {
    renderLauncher();

    const saved = localStorage.getItem('omni-tabs');
    let loaded = false;

    if (saved) {
        try {
            const tabs = JSON.parse(saved);
            if (Array.isArray(tabs) && tabs.length > 0) {
                tabs.forEach((t, i) => {
                    createTab(t.name, t.url, t.isIncognito);
                });
                loaded = true;

                const lastActive = localStorage.getItem('omni-active-tab');
                if (lastActive) {
                    const btn = document.querySelector(`button[data-id="${lastActive}"]`);
                    if (btn) btn.click();
                    else if (tabsContainer.firstElementChild) tabsContainer.firstElementChild.click();
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
    ipcRenderer.send('hide-current-view');
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
        if (activeBtn) ipcRenderer.send('show-current-view', activeBtn.dataset.id);
    }
}

function addFromHome(name, url) {
    const incognitoCheck = document.getElementById('incognito-check');
    const isIncognito = incognitoCheck.checked;

    if (isIncognito && (name.toLowerCase().includes('claude') || name.toLowerCase().includes('deepseek'))) {
        showAlert('Mode Restricted', `${name} does not support Incognito Mode because it requires a persistent login session.`);
        incognitoCheck.checked = false;
        return;
    }

    const btn = createTab(name, url, isIncognito);
    btn.click();
    incognitoCheck.checked = false;

    // Use the safe close function
    closeLauncher();
}

/* Generic Alert Functions */
function showAlert(title, message) {
    ipcRenderer.send('hide-current-view'); // Ensure webviews don't cover it
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
            ipcRenderer.send('show-current-view', activeBtn.dataset.id);
        }
    }
}

function reloadAll() {
    ipcRenderer.send('reload-all-ais');
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

        ipcRenderer.send('toggle-split');
        btn.classList.toggle('active');

        // Let the centralized function handle button states
        checkEmptyState();

    } catch (e) {
        console.error("JS Error in toggleSplit: " + e.message);
        showAlert("Error", "An error occurred: " + e.message);
    }
}

function resetDefaults() {
    ipcRenderer.send('hide-current-view');
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
        ipcRenderer.send('show-current-view', activeBtn.dataset.id);
    }
}

function confirmReset() {
    localStorage.removeItem('omni-tabs');
    localStorage.removeItem('omni-active-tab');
    location.reload();
}

/* Broadcast Modal Functions */
function openBroadcastModal() {
    const splitBtn = document.getElementById('split-btn');
    if (tabsContainer.children.length < 2) return; // Silent return if not enough tabs
    if (splitBtn && splitBtn.classList.contains('active')) return; // Silent return if split mode is on

    ipcRenderer.send('hide-current-view');
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
        ipcRenderer.send('show-current-view', activeBtn.dataset.id);
    }
}

/* Help & About Modal Functions */
function openHelpModal() {
    ipcRenderer.send('hide-current-view');
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
    if (activeBtn) ipcRenderer.send('show-current-view', activeBtn.dataset.id);
}

function openAboutModal() {
    closeHelpModal();
    ipcRenderer.send('hide-current-view');
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
    if (activeBtn) ipcRenderer.send('show-current-view', activeBtn.dataset.id);
}

function sendBroadcast() {
    const input = document.getElementById('broadcast-input');
    const prompt = input.value;
    if (prompt.trim()) {
        ipcRenderer.send('broadcast-prompt', prompt);
        input.value = ''; // Clear input
        closeBroadcastModal();
    }
}

/* Custom App Modal Functions */
function openCustomModal() {
    ipcRenderer.send('hide-current-view');
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
        ipcRenderer.send('show-current-view', activeBtn.dataset.id);
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

    const btn = createTab(name, url, isIncognito);
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

ipcRenderer.on('app-version', (event, version) => {
    currentAppVersion = version;
    if (helpVersionText) helpVersionText.textContent = `v${version}`;
    const aboutVer = document.getElementById('about-version');
    if (aboutVer) aboutVer.textContent = `Version ${version}`;
});

ipcRenderer.on('update-status', (event, text) => {
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

ipcRenderer.on('update-available', (event, info) => {
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
        ipcRenderer.send('install-update', updateUrl);
    }
}
