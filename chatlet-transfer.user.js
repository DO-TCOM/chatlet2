// ==UserScript==
// @name         Chatlet Profile Capture
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Lit les profils du OG Panel et les envoie à chaltet.com
// @author       OG
// @match        https://chatlet.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SERVER = 'https://chaltet.com';
    let sendTimer = null;

    // ─── Lit les profils depuis le localStorage du OG Panel ───────────────────
    function getProfilesFromOGPanel() {
        try {
            const raw = localStorage.getItem('chatletProfiles_compact_v22');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter(p => p && p.pseudo && p.color && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(p.color))
                .map(p => ({ pseudo: p.pseudo.trim(), color: p.color.replace('#', '') }));
        } catch (e) { return []; }
    }

    // ─── Envoie vers chaltet.com ───────────────────────────────────────────────
    async function sendToServer() {
        const profiles = getProfilesFromOGPanel();
        if (profiles.length === 0) return;

        const room = window.location.pathname.replace(/^\//, '').split('/')[0] || 'friends';

        try {
            const res = await fetch(SERVER + '/api/store-room-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room, profiles })
            });
            const data = await res.json();
            if (data.ok) console.log('[Capture] ' + profiles.length + ' profils envoyés → chaltet.com/' + room + ' :', profiles.map(p => p.pseudo).join(', '));
        } catch (e) {
            console.warn('[Capture] Erreur envoi:', e.message);
        }
    }

    function scheduleSend() {
        clearTimeout(sendTimer);
        sendTimer = setTimeout(sendToServer, 2000);
    }

    // ─── Surveille les changements dans le localStorage du OG Panel ───────────
    // Le OG Panel écrit dans chatletProfiles_compact_v22 à chaque nouveau profil
    const _origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(key, value) {
        _origSetItem(key, value);
        if (key === 'chatletProfiles_compact_v22') {
            scheduleSend();
        }
    };

    // Envoi initial après 5s (laisser le OG Panel se charger)
    setTimeout(sendToServer, 5000);
    // Renvoi toutes les 30s
    setInterval(sendToServer, 30000);

    console.log('[Capture v8] Actif — surveille OG Panel sur', window.location.pathname);
})();
