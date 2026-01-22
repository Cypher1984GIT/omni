
// Minimal Preload Script
// We keep it extremely simple to avoid detection. No complex API mocking.

try {
    // 1. Bot Evasion - Minimal
    // Only mask webdriver presence. Do NOT touch plugins or languages aggressively.
    if (Object.getOwnPropertyDescriptor(navigator, 'webdriver')) {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    }

    // 2. Hardware Keys (WebAuthn)
    // We do NOT mock credentials anymore. Google often detects 'fake' credential APIs.
    // Modern Electron should support WebAuthn or at least fail gracefully.

    console.log('Preload: Minimal protection injected.');

} catch (e) {
    console.error('Preload error:', e);
}
