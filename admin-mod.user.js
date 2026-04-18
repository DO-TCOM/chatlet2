// ==UserScript==
// @name         666
// @namespace    https://chaltet.com
// @version      4.0
// @description  Admin auto-login + mode modérateur sur chaltet.com
// @author       OG
// @match        https://chaltet.com/*
// @match        https://www.chaltet.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const MOD_SECRET = 'un_mot_de_passe_secret_solide';
    const STATS_PASS = '3wQUrs05E4MczwcB@ev02LMO';

    // ── 1. modSecret pour activation automatique mod ──────────────────────────
    localStorage.setItem('modSecret', MOD_SECRET);

    // ── 2. Auto-login admin ────────────────────────────────────────────────────
    if (window.location.pathname.startsWith('/admin')) {
        const existingToken = sessionStorage.getItem('adminToken');
        if (!existingToken) {
            // Pas de token → login et stocker (pas de reload, admin-stats.html
            // lit sessionStorage au chargement de la page donc on doit agir
            // AVANT que la page s'initialise → on patch l'init)
            (async () => {
                try {
                    const res = await fetch('/admin/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: STATS_PASS })
                    });
                    const data = await res.json();
                    if (data.ok && data.token) {
                        sessionStorage.setItem('adminToken', data.token);
                        console.log('[666] Token admin stocké, rechargement...');
                        // Un seul rechargement — le token sera là au prochain load
                        location.reload();
                    }
                } catch (e) {
                    console.warn('[666] Erreur login admin:', e.message);
                }
            })();
        } else {
            console.log('[666] Token admin déjà présent');
        }
        return;
    }

    // ── 3. Activation mod via socket ──────────────────────────────────────────
    function tryActivateMod() {
        const s = window.socket;
        if (s && s.connected) {
            const displayName = localStorage.getItem('displayName') || 'Mod';
            s.emit('mod-auth', { password: MOD_SECRET, displayName });
            console.log('[666] mod-auth envoyé');
            return true;
        }
        return false;
    }

    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        if (tryActivateMod() || attempts > 30) {
            clearInterval(interval);
            if (attempts > 30) console.warn('[666] Socket non trouvé après 15s');
        }
    }, 500);

    console.log('[666 v4] Chargé');
})();
