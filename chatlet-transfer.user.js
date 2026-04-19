// ==UserScript==
// @name         Chatlet Profile Capture
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  Génère des liens chaltet.com/room#TOKEN personnalisés par profil
// @author       OG
// @match        https://chatlet.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SERVER = 'https://chaltet.com';
    let sendTimer = null;
    // token court par profil : pseudo → token
    const profileTokens = new Map();

    // ─── Génère un token court aléatoire ──────────────────────────────────────
    function makeToken() {
        return Math.random().toString(36).slice(2, 10) +
               Math.random().toString(36).slice(2, 6);
    }

    // ─── Lit les profils depuis le localStorage du OG Panel ──────────────────
    function getProfilesFromOGPanel() {
        try {
            const raw = localStorage.getItem('chatletProfiles_compact_v22');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter(p => p && p.pseudo && p.color &&
                    /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(p.color))
                .map(p => ({ pseudo: p.pseudo.trim(), color: p.color.replace('#', '') }));
        } catch (e) { return []; }
    }

    // ─── Envoie tokens + profils vers chaltet.com ─────────────────────────────
    async function sendToServer() {
        const profiles = getProfilesFromOGPanel();
        if (profiles.length === 0) return;

        // Assigner un token à chaque profil (stable tant que le pseudo est le même)
        const tokens = profiles.map(p => {
            if (!profileTokens.has(p.pseudo)) {
                profileTokens.set(p.pseudo, makeToken());
            }
            return { token: profileTokens.get(p.pseudo), pseudo: p.pseudo, color: p.color };
        });

        const room = window.location.pathname.replace(/^\//, '').split('/')[0] || 'friends';

        try {
            await fetch(SERVER + '/api/store-profile-tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokens })
            });
            console.log('[Capture v9] Tokens envoyés pour:', tokens.map(t => t.pseudo).join(', '));
            updateLinksPanel(tokens, room);
        } catch (e) {
            console.warn('[Capture v9] Erreur:', e.message);
        }
    }

    function scheduleSend() {
        clearTimeout(sendTimer);
        sendTimer = setTimeout(sendToServer, 2000);
    }

    // ─── Surveille le OG Panel ────────────────────────────────────────────────
    const _origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(key, value) {
        _origSetItem(key, value);
        if (key === 'chatletProfiles_compact_v22') scheduleSend();
    };

    // ─── Panneau de liens ──────────────────────────────────────────────────────
    let panelBody = null;

    function createLinksPanel() {
        if (document.getElementById('chaltet-links-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'chaltet-links-panel';
        panel.style.cssText = `
            position:fixed;bottom:20px;right:15px;z-index:10000;
            background:#0f0f0f;color:white;border-radius:12px;
            font-family:'Segoe UI',sans-serif;font-size:12px;
            box-shadow:0 8px 30px rgba(0,0,0,0.8);border:1px solid #333;
            width:250px;display:flex;flex-direction:column;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'background:#1a1a1a;padding:8px 12px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2a2a;';
        header.innerHTML = '<span style="font-weight:bold;font-size:11px;color:#aaa;">🔗 LIENS CHALTET</span>';

        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = '−';
        toggleBtn.style.cssText = 'background:none;border:none;color:#888;font-size:14px;cursor:pointer;padding:0;line-height:1;';
        let collapsed = false;
        toggleBtn.onclick = () => {
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : 'flex';
            toggleBtn.textContent = collapsed ? '+' : '−';
        };
        header.appendChild(toggleBtn);
        panel.appendChild(header);

        const body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px;overflow-y:auto;max-height:320px;';
        panel.appendChild(body);
        panelBody = body;

        document.body.appendChild(panel);
    }

    function updateLinksPanel(tokens, room) {
        if (!panelBody) return;
        panelBody.innerHTML = '';

        if (!tokens || tokens.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:#555;font-size:11px;text-align:center;padding:12px;';
            empty.textContent = 'Aucun profil détecté';
            panelBody.appendChild(empty);
            return;
        }

        tokens.forEach(({ token, pseudo, color }) => {
            // Lien avec token caché dans le hash
            const link = `${SERVER}/${room}#${token}`;
            const hexColor = '#' + color;

            const row = document.createElement('div');
            row.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;background:#1a1a1a;border:1px solid #2a2a2a;`;

            const dot = document.createElement('span');
            dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${hexColor};flex-shrink:0;`;

            const name = document.createElement('span');
            name.textContent = pseudo;
            name.style.cssText = 'flex:1;font-size:11px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ddd;';

            // Bouton copier le lien
            const copyBtn = document.createElement('button');
            copyBtn.textContent = '📋';
            copyBtn.title = 'Copier le lien (chaltet.com/' + room + ')';
            copyBtn.style.cssText = 'background:none;border:1px solid #333;border-radius:5px;color:#aaa;font-size:11px;cursor:pointer;padding:2px 5px;flex-shrink:0;';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(link).then(() => {
                    copyBtn.textContent = '✅';
                    setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
                });
            };

            // Bouton coller dans le chat chatlet
            const chatBtn = document.createElement('button');
            chatBtn.textContent = '💬';
            chatBtn.title = 'Coller dans le chat';
            chatBtn.style.cssText = 'background:none;border:1px solid #333;border-radius:5px;color:#aaa;font-size:11px;cursor:pointer;padding:2px 5px;flex-shrink:0;';
            chatBtn.onclick = () => {
                // Cherche l'input chat de chatlet.com
                const chatInput = document.querySelector('input.input[type="text"]') ||
                                  document.querySelector('[placeholder*="essage"]') ||
                                  document.querySelector('input[type="text"]:not([placeholder])');
                if (chatInput) {
                    const nativeSetter = Object.getOwnPropertyDescriptor(
                        Object.getPrototypeOf(chatInput), 'value'
                    )?.set;
                    if (nativeSetter) {
                        nativeSetter.call(chatInput, link);
                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        chatInput.value = link;
                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    chatInput.focus();
                } else {
                    // Fallback : copier dans le presse-papiers
                    navigator.clipboard.writeText(link);
                    chatBtn.textContent = '✅';
                    setTimeout(() => { chatBtn.textContent = '💬'; }, 1500);
                }
            };

            row.appendChild(dot);
            row.appendChild(name);
            row.appendChild(copyBtn);
            row.appendChild(chatBtn);
            panelBody.appendChild(row);
        });
    }

    // ─── Init ──────────────────────────────────────────────────────────────────
    setTimeout(sendToServer, 5000);
    setInterval(sendToServer, 30000);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createLinksPanel);
    } else {
        setTimeout(createLinksPanel, 1500);
    }

    console.log('[Capture v9] Actif sur', window.location.pathname);
})();
