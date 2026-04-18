// ==UserScript==
// @name         666
// @namespace    https://chaltet.com
// @version      3.0
// @description  Active le mode modérateur sur chaltet.com
// @author       OG
// @match        https://chaltet.com/*
// @match        https://www.chaltet.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const MOD_SECRET = 'un_mot_de_passe_secret_solide';

    // 1. Mettre dans localStorage pour les prochaines connexions
    localStorage.setItem('modSecret', MOD_SECRET);

    // 2. Si le socket est déjà connecté (rechargement de page),
    //    attendre que `socket` soit disponible et envoyer mod-auth directement
    function tryActivateMod() {
        if (typeof socket !== 'undefined' && socket && socket.connected) {
            const displayName = localStorage.getItem('displayName') || 'Mod';
            socket.emit('mod-auth', { password: MOD_SECRET, displayName });
            console.log('[666] mod-auth envoyé → socket connecté');
            return true;
        }
        return false;
    }

    // Retry toutes les 500ms jusqu'à ce que socket soit prêt (max 15s)
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        if (tryActivateMod() || attempts > 30) {
            clearInterval(interval);
            if (attempts > 30) console.warn('[666] Socket non trouvé après 15s');
        }
    }, 500);

    console.log('[666 v3] Chargé — modSecret défini');
})();
