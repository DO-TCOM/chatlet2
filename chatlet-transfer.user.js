// ==UserScript==
// @name         Chatlet Profile Capture
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  Capture profils WebRTC de chatlet.com et les transfère vers chaltet.com
// @author       OG
// @match        https://chatlet.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Map peerId -> { displayName, profileColor }
    const profiles = new Map();
    let myProfile = null;
    let sendTimer = null;

    // ─── Intercepte console.log pour capturer les "Received property updates" ───
    const _log = console.log.bind(console);
    console.log = function (...args) {
        _log(...args);
        try {
            const msg = typeof args[0] === 'string' ? args[0] : '';

            // Format: "Received property updates from peer connection PEERID" + objet en args[1]
            if (msg.startsWith('Received property updates from peer connection ')) {
                const peerId = msg.split(' ')[6];

                let data = null;
                if (args[1] && typeof args[1] === 'object') {
                    data = args[1];
                } else {
                    // Format tout-en-un string: "...{"profileColor":"#xxx","displayName":"yyy"}"
                    const match = msg.match(/(\{.*\})$/);
                    if (match) {
                        try { data = JSON.parse(match[1]); } catch (e) {}
                    }
                }

                if (data && (data.displayName || data.profileColor)) {
                    const existing = profiles.get(peerId) || {};
                    if (data.displayName) existing.displayName = data.displayName;
                    if (data.profileColor) existing.profileColor = data.profileColor;
                    profiles.set(peerId, existing);
                    scheduleSend();
                }
            }
        } catch (e) {}
    };

    // ─── Récupère le profil du LOCAL user depuis le localStorage de chatlet.com ───
    function getMyProfile() {
        const name = localStorage.getItem('displayName') || localStorage.getItem('pseudo') || localStorage.getItem('name');
        const color = localStorage.getItem('profileColor') || localStorage.getItem('color');
        if (name) {
            myProfile = { displayName: name, profileColor: color || '#888888' };
        }
    }

    // ─── Construit la liste finale (moi en premier, peers ensuite) ───
    function buildProfileList() {
        const list = [];

        if (myProfile) {
            list.push({
                pseudo: myProfile.displayName,
                color: myProfile.profileColor.replace('#', '')
            });
        }

        for (const [, prof] of profiles.entries()) {
            if (prof.displayName && prof.profileColor) {
                if (!list.find(p => p.pseudo === prof.displayName)) {
                    list.push({
                        pseudo: prof.displayName,
                        color: prof.profileColor.replace('#', '')
                    });
                }
            }
        }

        return list;
    }

    // ─── Envoi debounce 1.5s ───
    function scheduleSend() {
        clearTimeout(sendTimer);
        sendTimer = setTimeout(sendToServer, 1500);
    }

    async function sendToServer() {
        getMyProfile();
        const list = buildProfileList();
        if (list.length === 0) return;

        const room = window.location.pathname.replace(/^\//, '').split('/')[0] || 'friends';

        try {
            await fetch('https://chaltet.com/api/store-room-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room, profiles: list })
            });
            _log('[Chatlet Capture] Profils envoyés (' + list.length + '):', list.map(p => p.pseudo).join(', '));
        } catch (e) {
            _log('[Chatlet Capture] Erreur:', e.message);
        }
    }

    // Démarre après 3s + renvoi toutes les 15s
    setTimeout(() => { getMyProfile(); scheduleSend(); }, 3000);
    setInterval(() => { if (profiles.size > 0 || myProfile) scheduleSend(); }, 15000);

    _log('[Chatlet Capture v7] Actif sur', window.location.pathname);
})();
