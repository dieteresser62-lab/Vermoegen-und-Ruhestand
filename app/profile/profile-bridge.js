// @ts-check

import { initializeProfilePage } from './profile-navigation.js';

async function initProfileBridge() {
    return initializeProfilePage();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProfileBridge);
} else {
    initProfileBridge();
}
