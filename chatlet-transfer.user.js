// ==UserScript==
// @name         Chatlet → Chaltet Bridge
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  Transfère automatiquement le profil chatlet vers chaltet.com au clic
// @author       OG
// @match        https://chatlet.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const CHALTET = 'chaltet.com';

    // ─── Récupère le profil de l'utilisateur courant ──────────────────────────
    function getMyProfile() {
        const pseudo = localStorage.getItem('displayName') || '';
        const color  = localStorage.getItem('profileColor') || '';
        if (!pseudo || !color) return null;
        return { pseudo, color: color.replace('#', '') };
    }

    // ─── Encode le profil dans un hash propre ─────────────────────────────────
    function encodeHash(pseudo, color) {
        // Format : base64url(pseudo:color) — illisible mais pas nominatif à l'œil
        const raw = pseudo + ':' + color;
        return btoa(unescape(encodeURIComponent(raw)))
               .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // ─── Ajoute le hash au lien chaltet avant navigation ─────────────────────
    function patchChaltetLink(url) {
        try {
            const u = new URL(url);
            if (!u.hostname.includes(CHALTET)) return url;
            const profile = getMyProfile();
            if (!profile) return url;
            u.hash = encodeHash(profile.pseudo, profile.color);
            return u.toString();
        } catch (e) { return url; }
    }

    // ─── Intercepte tous les clics sur des liens chaltet.com ─────────────────
    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]');
        if (!a) return;
        if (!a.href.includes(CHALTET)) return;
        e.preventDefault();
        const patchedUrl = patchChaltetLink(a.href);
        window.open(patchedUrl, '_blank');
    }, true);

    // ─── Intercepte aussi les liens copiés/collés dans le chat ───────────────
    // Quand quelqu'un copie un lien chaltet.com depuis le clipboard
    document.addEventListener('copy', () => {
        setTimeout(async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (!text.includes(CHALTET)) return;
                const profile = getMyProfile();
                if (!profile) return;
                // Re-écrire le clipboard avec le hash
                const patched = patchChaltetLink(text.trim());
                if (patched !== text.trim()) {
                    await navigator.clipboard.writeText(patched);
                }
            } catch (e) {}
        }, 100);
    });

    // ─── Détection des profils dans la room (indépendant du OG Panel) ─────────
    // Intercepte les logs de chatlet.com pour capturer pseudo+couleur des peers
    const roomProfiles = new Map(); // pseudo → color

    ;['log', 'debug', 'info'].forEach(method => {
        const orig = console[method].bind(console);
        console[method] = function (...args) {
            orig(...args);
            try {
                for (const a of args) {
                    if (typeof a === 'string') {
                        // "Received property updates from peer connection XXX {"profileColor":"#xxx","displayName":"yyy"}"
                        const m = a.match(/Received property updates from peer connection [a-f0-9]+ (\{.+\})/);
                        if (m) {
                            const obj = JSON.parse(m[1]);
                            if (obj.displayName && obj.profileColor) {
                                roomProfiles.set(obj.displayName, obj.profileColor.replace('#', ''));
                            }
                        }
                        // "Setting property displayName to XXX"
                        const mSet = a.match(/Setting property displayName to (.+) and/);
                        if (mSet && mSet[1]) {
                            const pseudo = mSet[1].trim();
                            if (pseudo) localStorage.setItem('displayName', pseudo);
                        }
                    } else if (a && typeof a === 'object') {
                        if (a.displayName && a.profileColor) {
                            roomProfiles.set(a.displayName, a.profileColor.replace('#', ''));
                        }
                    }
                }
            } catch (e) {}
        };
    });

    // Sauvegarder aussi le profil local dès qu'il change
    const _origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
        _origSet(key, value);
        if (key === 'displayName' || key === 'profileColor') {
            const p = getMyProfile();
            if (p) roomProfiles.set(p.pseudo, p.color);
        }
    };

    console.log('[Bridge v10] Actif — profil sera transféré automatiquement au clic');
})();
