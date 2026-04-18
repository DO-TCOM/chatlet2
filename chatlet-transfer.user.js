// ==UserScript==
// @name         Chatlet Profile Capture
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  Lit les profils du OG Panel, les envoie à chaltet.com, et ajoute bouton liens
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

    // ─── Génère un lien personnalisé pour chaque profil ───────────────────────
    function generateLink(profile) {
        const room = window.location.pathname.replace(/^\//, '').split('/')[0] || 'friends';
        return `${SERVER}/${room}?pseudo=${encodeURIComponent(profile.pseudo)}&color=${profile.color.replace('#','')}`;
    }

    // ─── Envoie tous les profils vers chaltet.com (backup Redis) ──────────────
    async function sendToServer() {
        const profiles = getProfilesFromOGPanel();
        if (profiles.length === 0) return;
        const room = window.location.pathname.replace(/^\//, '').split('/')[0] || 'friends';
        try {
            await fetch(SERVER + '/api/store-room-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room, profiles })
            });
        } catch (e) {}
    }

    function scheduleSend() {
        clearTimeout(sendTimer);
        sendTimer = setTimeout(sendToServer, 2000);
    }

    // Surveille les changements du OG Panel
    const _origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(key, value) {
        _origSetItem(key, value);
        if (key === 'chatletProfiles_compact_v22') {
            scheduleSend();
            updateLinksPanel();
        }
    };

    // ─── Panneau de liens ──────────────────────────────────────────────────────
    let linksPanel = null;

    function createLinksPanel() {
        const old = document.getElementById('chaltet-links-panel');
        if (old) old.remove();

        const panel = document.createElement('div');
        panel.id = 'chaltet-links-panel';
        panel.style.cssText = `
            position:fixed;bottom:20px;right:15px;z-index:10000;
            background:#0f0f0f;color:white;border-radius:12px;
            font-family:'Segoe UI',sans-serif;font-size:12px;
            box-shadow:0 8px 30px rgba(0,0,0,0.8);border:1px solid #333;
            width:260px;max-height:400px;display:flex;flex-direction:column;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'background:#1a1a1a;padding:8px 12px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer;border-bottom:1px solid #2a2a2a;';
        header.innerHTML = '<span style="font-weight:bold;font-size:11px;color:#aaa;">🔗 LIENS CHALTET</span>';

        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = '−';
        toggleBtn.style.cssText = 'background:none;border:none;color:#888;font-size:14px;cursor:pointer;padding:0;line-height:1;';
        let collapsed = false;
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : 'flex';
            toggleBtn.textContent = collapsed ? '+' : '−';
        };
        header.appendChild(toggleBtn);
        panel.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px;overflow-y:auto;max-height:340px;';
        panel.appendChild(body);

        document.body.appendChild(panel);
        linksPanel = { panel, body };
        updateLinksPanel();
    }

    function updateLinksPanel() {
        if (!linksPanel) return;
        const { body } = linksPanel;
        body.innerHTML = '';

        const profiles = getProfilesFromOGPanel();
        if (profiles.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:#555;font-size:11px;text-align:center;padding:12px;';
            empty.textContent = 'Aucun profil détecté';
            body.appendChild(empty);
            return;
        }

        profiles.forEach(profile => {
            const link = generateLink(profile);
            const row = document.createElement('div');
            row.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:7px;background:#1a1a1a;border:1px solid #2a2a2a;`;

            // Couleur dot
            const dot = document.createElement('span');
            dot.style.cssText = `width:14px;height:14px;border-radius:50%;background:#${profile.color};flex-shrink:0;`;

            // Pseudo
            const name = document.createElement('span');
            name.textContent = profile.pseudo;
            name.style.cssText = 'flex:1;font-size:11px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ddd;';

            // Bouton copier
            const copyBtn = document.createElement('button');
            copyBtn.textContent = '📋';
            copyBtn.title = 'Copier le lien';
            copyBtn.style.cssText = 'background:none;border:1px solid #333;border-radius:5px;color:#aaa;font-size:12px;cursor:pointer;padding:2px 5px;flex-shrink:0;';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(link).then(() => {
                    copyBtn.textContent = '✅';
                    setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
                });
            };

            // Bouton tout copier en 1 clic dans le chat
            const chatBtn = document.createElement('button');
            chatBtn.textContent = '💬';
            chatBtn.title = 'Coller dans le chat';
            chatBtn.style.cssText = 'background:none;border:1px solid #333;border-radius:5px;color:#aaa;font-size:12px;cursor:pointer;padding:2px 5px;flex-shrink:0;';
            chatBtn.onclick = () => {
                // Trouve l'input du chat chatlet.com et y met le lien
                const chatInput = document.querySelector('input[placeholder="Message..."], input.chat-input, .input[type="text"]');
                if (chatInput) {
                    const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(chatInput), 'value').set;
                    nativeSetter.call(chatInput, link);
                    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                    chatInput.focus();
                }
            };

            row.appendChild(dot);
            row.appendChild(name);
            row.appendChild(copyBtn);
            row.appendChild(chatBtn);
            body.appendChild(row);
        });
    }

    // ─── Init ──────────────────────────────────────────────────────────────────
    setTimeout(sendToServer, 5000);
    setInterval(sendToServer, 30000);

    // Attend que le DOM soit prêt pour créer le panneau
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createLinksPanel);
    } else {
        setTimeout(createLinksPanel, 2000);
    }

    console.log('[Capture v9] Actif sur', window.location.pathname);
})();
