// Chatlet Mirror - Version Corrigée (Audit Complet + Replica 1:1 + Fixes)
"use strict";

const socket = io();

socket.on('connect_error', () => {
    const existing = document.getElementById('connection-error');
    if (existing) return;
    const banner = document.createElement('div');
    banner.id = 'connection-error';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#cc0000;color:white;text-align:center;padding:10px;font-size:14px;z-index:9999;font-family:sans-serif;';
    banner.innerText = '⚠️ Connection blocked — disable your ad blocker or firewall for this site.';
    document.body.appendChild(banner);
});

socket.on('connect', () => {
    const banner = document.getElementById('connection-error');
    if (banner) banner.remove();
});

// Note: socket intentionally not exposed on window
const roomId = window.location.pathname.split('/').pop() || 'friends';

// Re-auth as mod on reconnect
socket.on('reconnect', () => {
    const modSecret = localStorage.getItem('modSecret');
    if (modSecret) setTimeout(() => socket.emit('mod-auth', { password: modSecret, displayName: myDisplayName }), 500);
    if (roomId) {
        socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor });
        socket.emit('join-room', roomId);
    }
    if (isModerator) {
        setTimeout(() => socket.emit('mod-badge', { roomId }), 600);
    }
});
let localStream = null;
const peers = {};

// Identity Generation
const adjectives = ["Cool", "Brave", "Fast", "Fierce", "Smart", "Verse", "Swift", "Bright", "Dark", "Epic"];
const nouns = ["Fox", "Tiger", "Falcon", "Lion", "Bear", "Wolf", "Eagle", "Shark", "Hawk", "Panda"];
const pastelColors = ["#ef9a9a", "#f48fb1", "#ce93d8", "#b39ddb", "#9fa8da", "#90caf9", "#81d4fa", "#80deea", "#80cbc4", "#a5d6a7", "#c5e1a5", "#e6ee9c", "#ffcc80", "#ffab91", "#bcaaa4"];

function generateRandomName() { return adjectives[Math.floor(Math.random() * adjectives.length)] + nouns[Math.floor(Math.random() * nouns.length)]; }

let savedColor = localStorage.getItem('profileColor');
if (!pastelColors.includes(savedColor)) savedColor = null;

// Check URL params for pseudo and color (from shared links)
const _urlParams = new URLSearchParams(window.location.search);
const _urlPseudo = _urlParams.get('pseudo');
const _urlColor = _urlParams.get('color') ? '#' + _urlParams.get('color') : null;

// Check for transferred profile from localStorage (cross-domain)
let transferredProfile = null;
let groupProfiles = null;
try {
    const stored = localStorage.getItem('transferProfile');
    if (stored) {
        const profile = JSON.parse(stored);
        // Check if profile is less than 5 minutes old
        if (Date.now() - profile.timestamp < 5 * 60 * 1000) {
            // Group profiles (multiple users)
            if (profile.profiles) {
                groupProfiles = profile.profiles;
            } else {
                // Single profile
                transferredProfile = profile;
            }
            // Clear after use
            localStorage.removeItem('transferProfile');
        }
    }
} catch (e) {
    console.error('Error reading transferred profile:', e);
}

// Get or create UUID for this user
function getUUID() {
    let uuid = localStorage.getItem('userUUID');
    if (!uuid) {
        uuid = crypto.randomUUID();
        localStorage.setItem('userUUID', uuid);
    }
    return uuid;
}

// Fetch profile from server based on UUID
async function fetchProfileByUUID() {
    const uuid = getUUID();
    try {
        const response = await fetch('/api/get-profile-by-uuid', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ uuid })
        });
        const data = await response.json();
        if (data.ok && data.profile) {
            return data.profile;
        }
    } catch (e) {
        console.error('Error fetching profile by UUID:', e);
    }
    return null;
}

// Priority: URL params > UUID profile > group profiles > transferred profile > localStorage > random
let myDisplayName = _urlPseudo || (groupProfiles && groupProfiles.length > 0 ? findMatchingProfile(groupProfiles) : null) || (transferredProfile ? transferredProfile.pseudo : null) || localStorage.getItem('displayName') || generateRandomName();
let myProfileColor = (_urlColor && /^#[0-9a-fA-F]{6}$/.test(_urlColor) ? _urlColor : null) || (groupProfiles && groupProfiles.length > 0 ? '#' + findMatchingProfile(groupProfiles).color : null) || (transferredProfile ? '#' + transferredProfile.color : null) || savedColor || pastelColors[Math.floor(Math.random() * pastelColors.length)];

localStorage.setItem('displayName', myDisplayName);
localStorage.setItem('profileColor', myProfileColor);

// Apply UUID profile in background (overrides if found)
fetchProfileByUUID().then(uuidProfile => {
    if (uuidProfile) {
        myDisplayName = uuidProfile.pseudo || myDisplayName;
        myProfileColor = uuidProfile.color || myProfileColor;
        localStorage.setItem('displayName', myDisplayName);
        localStorage.setItem('profileColor', myProfileColor);
        // Update UI if already rendered
        const nameInput = document.querySelector('.settings .input');
        if (nameInput) nameInput.value = myDisplayName;
        if (typeof updateLocalProfileUI === 'function') updateLocalProfileUI();
    }
});

// Function to find matching profile for current user
function findMatchingProfile(profiles) {
    if (!profiles || profiles.length === 0) return null;
    
    // Try to match by UUID
    const uuid = getUUID();
    if (uuid) {
        const uuidMatch = profiles.find(p => p.uuid === uuid);
        if (uuidMatch) return uuidMatch;
    }
    
    // Default: return first profile
    return profiles[0];
}
let allowSoundNotifications = localStorage.getItem('allowSoundNotifications') !== 'false';

// UI Elements
const welcomeLayer = document.querySelector('.welcome');
const conversationLayer = document.querySelector('.conversation');
const backgroundLayer = document.querySelector('.layer.background');
const chatLayer = document.querySelector('.layer.chat');
const settingsLayer = document.querySelector('.layer.settings');
const chatPanel = document.querySelector('.chat .panel');
const messagesContainer = document.querySelector('.messages');
const roomNameDisplay = document.querySelector('.roomName');
const nameInput = document.querySelector('.settings .input');
const chatInputField = document.querySelector('.chat .input');

// Buttons
const joinVideoBtn = document.querySelector('.joinVideo');
const joinAudioBtn = document.querySelector('.joinAudio');
const joinChatBtn = document.querySelector('.joinChat');
const toggleChatBtn = document.querySelector('.toggleChat');
const toggleMenuBtn = document.querySelector('.toggleMenu');
const menuElement = document.querySelector('.menu');
const soundNotificationsCheckbox = document.getElementById('soundNotifications');
let isModerator = false;

const toggleVideoBtn = document.querySelector('.toggleVideo');
const toggleAudioBtn = document.querySelector('.toggleAudio');
const toggleScreenShareBtn = null; // button removed from UI

const videoSelect = document.getElementById('videoSource');
const audioSelect = document.getElementById('audioSource');

// Sounds
const audioUnconvinced = document.getElementById('audioUnconvinced');
const audioUnsure = document.getElementById('audioUnsure');
const audioMessage = document.getElementById('audioMessage');

const remoteProfiles = {};
let screenStream;
let featuredUserId = null;
let iceServersConfig = [{ urls: 'stun:stun.l.google.com:19302' }];

function sanitizeColor(color) {
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
    return '#4A90E2';
}

function escapeHTML(str) {
    const p = document.createElement("p");
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
}

function linkify(str) {
    const escaped = escapeHTML(str);
    return escaped.replace(
        /(https?:\/\/[^\s<>"]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#77FFFF;text-decoration:underline;">$1</a>'
    );
}

function updateLocalProfileUI() {
    const safeColor = sanitizeColor(myProfileColor);
    const localPeer = document.querySelector('.peer.local');
    const localName = document.querySelector('.peer.local .name');
    if (localPeer) localPeer.style.backgroundColor = safeColor;
    if (localName) { localName.innerText = myDisplayName; localName.style.color = safeColor; }
    
    // Update featured if local is featured
    if (featuredUserId === 'local') {
        setFeatured('local');
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch('/api/ice-servers', { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) iceServersConfig = await res.json();
    } catch(e) { console.warn('Could not fetch ICE servers config, using default STUN', e); }

    roomNameDisplay.innerText = roomId;
    nameInput.value = myDisplayName;
    if (soundNotificationsCheckbox) soundNotificationsCheckbox.checked = allowSoundNotifications;

    const inviteLink = document.getElementById('inviteLink');
    if (inviteLink) inviteLink.innerText = window.location.host + '/' + roomId;

    if (roomId === 'kids') {
        backgroundLayer.style.backgroundImage = "url('/backgroundkids.jpg')";
    } else if (roomId === 'turtle') {
        backgroundLayer.style.backgroundImage = "url('/background-turtle.png')";
        backgroundLayer.style.backgroundSize = 'cover';
        backgroundLayer.style.backgroundPosition = 'center';
    } else if (roomId === 'lildurk') {
        backgroundLayer.style.backgroundImage = "url('/background-lildurk.webp')";
        backgroundLayer.style.backgroundSize = 'cover';
        backgroundLayer.style.backgroundPosition = 'center top';
    } else if (roomId === 'ovo') {
        backgroundLayer.style.backgroundImage = "url('/background-ovo.jpg')";
        backgroundLayer.style.backgroundSize = 'contain';
        backgroundLayer.style.backgroundRepeat = 'no-repeat';
        backgroundLayer.style.backgroundPosition = 'center center';
    } else if (roomId === 'nutquack') {
        backgroundLayer.style.backgroundImage = "url('https://images.unsplash.com/photo-1459262838948-3e2de6c1ec80?w=1600&q=80')";
    } else {
        backgroundLayer.style.backgroundImage = "url('/backgroundfriends.jpg')";
    }
    chatInputField.style.color = myProfileColor;

    updateLocalProfileUI();

    toggleVideoBtn.addEventListener('click', handleToggleVideo);
    toggleAudioBtn.addEventListener('click', handleToggleAudio);

    if (toggleScreenShareBtn) {
        toggleScreenShareBtn.addEventListener('click', async () => {
            if (!screenStream) {
                try {
                    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                    const screenTrack = screenStream.getVideoTracks()[0];
                    for (const id in peers) {
                        const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'video');
                        if (sender) sender.replaceTrack(screenTrack);
                    }
                    setFeatured('local-screen', screenStream);
                    toggleScreenShareBtn.classList.remove('off');
                    screenTrack.onended = () => stopScreenShare();
                } catch (err) { console.error("Screen share error", err); }
            } else { stopScreenShare(); }
        });
    }

    joinVideoBtn.addEventListener('click', () => { noSleep.enable(); start(true, true); });
    joinAudioBtn.addEventListener('click', () => { noSleep.enable(); start(false, true); });
    joinChatBtn.addEventListener('click', () => { noSleep.enable(); start(false, false); });

    toggleChatBtn.addEventListener('click', () => {
        chatPanel.classList.toggle('hidden');
        const snippet = document.querySelector('.snippet');
        if (snippet) snippet.classList.add('hidden');
    });
    toggleMenuBtn.addEventListener('click', () => menuElement.classList.toggle('hidden'));

    if (soundNotificationsCheckbox) {
        soundNotificationsCheckbox.addEventListener('change', (e) => {
            allowSoundNotifications = e.target.checked;
            localStorage.setItem('allowSoundNotifications', allowSoundNotifications);
        });
    }


    socket.on('mod-status', (status) => {
        isModerator = status;
        if (status) {
            // Add buttons on all existing miniatures
            document.querySelectorAll('.peer.miniature').forEach(peer => addModButtons(peer));
            // Show badge on local avatar
            addModBadge(document.querySelector('.peer.local'));
            // Tell others I am mod
            socket.emit('mod-badge', { roomId });
        }
    });

    socket.on('mod-badge', (data) => {
        // Show badge on remote peer - retry if DOM not ready yet
        const applyBadge = () => {
            const el = document.getElementById(`peer-${data.id}`);
            if (el) {
                addModBadge(el);
            } else {
                setTimeout(applyBadge, 300);
            }
            if (featuredUserId === data.id) {
                addModBadge(document.querySelector('.peer.featured'));
            }
        };
        applyBadge();
    });

    socket.on('mod-action', (action) => {
        // Support both old string format and new object format
        const type = typeof action === 'object' ? action.type : action;
        const by = typeof action === 'object' ? action.by : 'Mod';

        if (type === 'muted') {
            chatInputField.disabled = true;
            chatInputField.placeholder = "You are muted.";
            if (localStream) {
                localStream.getAudioTracks().forEach(t => { t.enabled = false; });
                toggleAudioBtn.classList.add('off');
            }
            showModOverlay(`Mute by ${by}`, () => {}, true);
        } else if (type === 'unmuted') {
            chatInputField.disabled = false;
            chatInputField.placeholder = "";
            if (localStream) {
                localStream.getAudioTracks().forEach(t => { t.enabled = true; });
                toggleAudioBtn.classList.remove('off');
            }
            showModOverlay(`Unmute by ${by}`, () => {}, true);
        } else if (type === 'kicked') {
            socket.disconnect();
            showModOverlay(`KICK by ${by}`, () => window.location.reload());
        } else if (type === 'kicked-temp') {
            socket.disconnect();
            showModOverlay(`KICK 30sec by ${by}`, () => window.location.reload());
        } else if (type === 'banned') {
            socket.disconnect();
            showModOverlay(`BAN by ${by}`, () => { window.location.href = 'https://www.google.com'; });
        }
    });

    nameInput.addEventListener('input', (e) => {
        myDisplayName = e.target.value.substring(0, 50);
        localStorage.setItem('displayName', myDisplayName);
        updateLocalProfileUI();
        socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (document.activeElement !== chatInputField) {
                chatPanel.classList.remove('hidden');
                chatInputField.focus();
            } else {
                const msg = chatInputField.value.trim();
                if (msg !== '') {
                    socket.emit('chat-message', { roomId, userName: myDisplayName, message: msg, color: myProfileColor });
                    chatInputField.value = '';
                } else {
                    chatPanel.classList.add('hidden');
                    chatInputField.blur();
                }
            }
        }
    });

    const featuredMuteBtn = document.querySelector('.peer.featured .toggleMute');
    const featuredVideoBtn = document.querySelector('.peer.featured .toggleRemoteVideo');
    const featuredVideoEl = document.querySelector('.peer.featured video');

    if (featuredMuteBtn && featuredVideoEl) {
        featuredMuteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            featuredVideoEl.muted = !featuredVideoEl.muted;
            featuredMuteBtn.classList.toggle('muted', featuredVideoEl.muted);
            if (featuredUserId && featuredUserId !== 'local' && featuredUserId !== 'local-screen') {
                const mini = document.getElementById(`peer-${featuredUserId}`);
                if (mini) mini.querySelector('.toggleMute').classList.toggle('muted', featuredVideoEl.muted);
            }
        });
    }

    if (featuredVideoBtn && featuredVideoEl) {
        featuredVideoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = featuredVideoEl.style.opacity === '0';
            featuredVideoEl.style.opacity = isHidden ? '1' : '0';
            featuredVideoBtn.classList.toggle('muted', !isHidden);
            if (featuredUserId && featuredUserId !== 'local' && featuredUserId !== 'local-screen') {
                const mini = document.getElementById(`peer-${featuredUserId}`);
                if (mini) mini.querySelector('.toggleRemoteVideo').classList.toggle('muted', !isHidden);
            }
        });
    }

});

async function handleToggleVideo() {
    if (!localStream) localStream = new MediaStream();

    if (localStream.getVideoTracks().length === 0) {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
            const track = newStream.getVideoTracks()[0];
            localStream.addTrack(track);
            for (const id in peers) {
                peers[id].addTrack(track, localStream);
                // onnegotiationneeded will fire automatically and handle renegotiation
            }
        } catch (err) { console.error('Media error:', err); return; }
    }

    updateLocalVideoElement(localStream);
    const track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    toggleVideoBtn.classList.toggle('off', !track.enabled);
    updateVideoVisibility('local', track.enabled);
    socket.emit('video-status', { roomId, enabled: track.enabled });
}

async function handleToggleAudio() {
    if (!localStream) localStream = new MediaStream();

    if (localStream.getAudioTracks().length === 0) {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const track = newStream.getAudioTracks()[0];
            localStream.addTrack(track);
            setupAudioAnalysis(localStream);
            for (const id in peers) {
                peers[id].addTrack(track, localStream);
                // onnegotiationneeded will fire automatically and handle renegotiation
            }
        } catch (err) { console.error('Media error:', err); return; }
    }

    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    toggleAudioBtn.classList.toggle('off', !track.enabled);
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
        if (toggleScreenShareBtn) toggleScreenShareBtn.classList.add('off');
        if (localStream && localStream.getVideoTracks().length > 0) {
            const camTrack = localStream.getVideoTracks()[0];
            for (const id in peers) {
                const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(camTrack);
            }
        }
        if (featuredUserId === 'local-screen') {
            featuredUserId = Object.keys(peers)[0] || 'local';
            setFeatured(featuredUserId);
        }
    }
}

async function start(useVideo, useAudio) {
    welcomeLayer.classList.add('hidden');
    conversationLayer.classList.remove('hidden');
    chatLayer.classList.remove('hidden');
    settingsLayer.classList.remove('hidden');

    if (useVideo || useAudio) {
        try {
            const constraints = { video: useVideo ? { width: { ideal: 640 }, height: { ideal: 480 } } : false, audio: useAudio };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            updateLocalVideoElement(localStream);
            if (useVideo) toggleVideoBtn.classList.remove('off');
            if (useAudio) {
                toggleAudioBtn.classList.remove('off');
                setupAudioAnalysis(localStream);
            }
            getDevices();
        } catch (err) { console.error('Media error:', err); }
    }

    // FIX: Emit profile-update BEFORE join-room to ensure server has profile data for sync-profiles
    socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor });
    socket.emit('join-room', roomId);

    // Send URL pseudo/color to server for tracking
    if (_urlPseudo || _urlColor) {
        socket.emit('url-identity', { pseudo: _urlPseudo, color: _urlColor });
    }

    // Auto-mod if secret stored in localStorage
    const modSecret = localStorage.getItem('modSecret');
    if (modSecret) {
        setTimeout(() => socket.emit('mod-auth', { password: modSecret, displayName: myDisplayName }), 500);
        // Retry after sync-profiles to ensure buttons appear on existing peers
        setTimeout(() => { if (!isModerator) socket.emit('mod-auth', { password: modSecret, displayName: myDisplayName }); }, 1500);
    }
    
    // Set local as featured by default if no one else is there
    // When alone, stay small at bottom - don't auto-feature local
}

function updateLocalVideoElement(stream) {
    const localVideo = document.querySelector('.peer.local video');
    if (localVideo) localVideo.srcObject = stream;
}

function updateVideoVisibility(userId, isEnabled) {
    const el = userId === 'local'
        ? document.querySelector('.peer.local video')
        : (document.getElementById(`peer-${userId}`) ? document.getElementById(`peer-${userId}`).querySelector('video') : null);

    if (el) {
        if (!isEnabled) {
            el.srcObject = null;
        } else {
            el.srcObject = userId === 'local' ? localStream : (peers[userId] ? peers[userId].remoteStream : null);
        }
    }

    if (featuredUserId === userId) {
        const featuredVideo = document.querySelector('.peer.featured video');
        if (featuredVideo) {
            if (!isEnabled) featuredVideo.srcObject = null;
            else featuredVideo.srcObject = userId === 'local' ? localStream : (peers[userId] ? peers[userId].remoteStream : null);
        }
    }
}

// Signaling
socket.on('user-connected', (userId) => {
    if (userId === socket.id) return;
    if (allowSoundNotifications && audioUnconvinced) audioUnconvinced.play().catch(e => {});
    createPeerConnection(userId, true);
    updatePeerUI(userId);
    if (isModerator) {
        setTimeout(() => {
            const el = document.getElementById(`peer-${userId}`);
            if (el) addModButtons(el);
        }, 200);
        // Re-broadcast mod badge so new user sees it
        socket.emit('mod-badge', { roomId });
    }
});

socket.on('signal', (data) => {
    const isNew = !peers[data.from];
    if (isNew) createPeerConnection(data.from, false);
    const pc = peers[data.from];
    if (isNew) updatePeerUI(data.from);

    if (data.signal.type === 'offer') {
        pc.setRemoteDescription(new RTCSessionDescription(data.signal))
            .then(() => pc.createAnswer())
            .then(answer => pc.setLocalDescription(answer))
            .then(() => socket.emit('signal', { to: data.from, signal: pc.localDescription }))
            .then(() => flushCandidateQueue(pc));
    } else if (data.signal.type === 'answer') {
        pc.setRemoteDescription(new RTCSessionDescription(data.signal))
            .then(() => flushCandidateQueue(pc));
    } else if (data.signal.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
            pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate)).catch(e => {});
        } else {
            if (!pc.candidateQueue) pc.candidateQueue = [];
            pc.candidateQueue.push(new RTCIceCandidate(data.signal.candidate));
        }
    }
});

function flushCandidateQueue(pc) {
    if (pc.candidateQueue) {
        pc.candidateQueue.forEach(c => pc.addIceCandidate(c).catch(e => {}));
        pc.candidateQueue = [];
    }
}

function showModOverlay(message, callback, autoDismiss = false) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.85);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        z-index:9999;font-family:sans-serif;
    `;
    const msgEl = document.createElement('div');
    msgEl.style.cssText = 'color:#ff4444;font-size:2.5rem;font-weight:bold;letter-spacing:0.1em;margin-bottom:1rem;';
    msgEl.textContent = message; // textContent — never innerHTML — avoids XSS
    overlay.appendChild(msgEl);
    document.body.appendChild(overlay);
    if (autoDismiss) {
        setTimeout(() => overlay.remove(), 2000);
    } else {
        setTimeout(callback, 2500);
    }
}

function addModBadge(peerElement) {
    if (!peerElement || peerElement.querySelector('.mod-badge')) return;
    const img = document.createElement('img');
    img.src = '/mod-badge.png';
    img.className = 'mod-badge';
    img.title = 'Moderator';
    peerElement.appendChild(img);
}

function addModButtons(peerElement) {
    if (!isModerator || peerElement.querySelector('.mod-controls')) return;
    if (!peerElement.id || !peerElement.id.startsWith('peer-')) return;
    const id = peerElement.id.replace('peer-', '');
    const isMini = peerElement.classList.contains('miniature');
    const fs = isMini ? '9px' : '11px';
    const pad = isMini ? '2px 4px' : '3px 8px';

    const modDiv = document.createElement('div');
    modDiv.className = 'mod-controls';
    modDiv.style.cssText = `position:absolute;top:5px;left:5px;display:flex;flex-wrap:wrap;gap:3px;z-index:10;max-width:${isMini ? '90px' : '200px'};`;

    const makeBtn = (label, bg, action) => {
        const btn = document.createElement('button');
        btn.innerText = label;
        btn.dataset.action = action;
        btn.style.cssText = `font-size:${fs};padding:${pad};width:auto;height:auto;background:${bg};color:white;border:none;border-radius:3px;cursor:pointer;`;
        btn.onclick = (e) => { e.stopPropagation(); socket.emit(action, id); };
        return btn;
    };

    const muteBtn = document.createElement('button');
    muteBtn.innerText = isMini ? 'M' : 'Mute';
    muteBtn.dataset.muted = 'false';
    muteBtn.style.cssText = `font-size:${fs};padding:${pad};width:auto;height:auto;background:#22aa44;color:white;border:none;border-radius:3px;cursor:pointer;`;
    muteBtn.onclick = (e) => {
        e.stopPropagation();
        const muted = muteBtn.dataset.muted === 'true';
        if (muted) {
            socket.emit('mod-unmute', id);
            muteBtn.dataset.muted = 'false';
            muteBtn.style.background = '#22aa44';
            muteBtn.innerText = isMini ? 'M' : 'Mute';
        } else {
            socket.emit('mod-mute', id);
            muteBtn.dataset.muted = 'true';
            muteBtn.style.background = '#cc0000';
            muteBtn.innerText = isMini ? 'M' : 'Unmute';
        }
    };

    modDiv.appendChild(makeBtn(isMini ? 'K' : 'Kick', '#ff8800', 'mod-kick'));
    modDiv.appendChild(makeBtn(isMini ? 'K30' : 'Kick30s', '#ff5500', 'mod-kick-temp'));
    modDiv.appendChild(makeBtn(isMini ? 'B' : 'Ban', '#cc0000', 'mod-ban'));
    modDiv.appendChild(muteBtn);
    peerElement.appendChild(modDiv);
}

function updatePeerUI(userId) {
    if (userId === socket.id || userId === 'local') return;
    let peerEl = document.getElementById(`peer-${userId}`);
    const prof = remoteProfiles[userId] || { displayName: 'Guest', profileColor: '#4A90E2' };
    const safeColor = sanitizeColor(prof.profileColor);

    if (!peerEl) {
        peerEl = document.createElement('div');
        peerEl.id = `peer-${userId}`;
        peerEl.className = 'peer miniature';
        peerEl.style.backgroundColor = safeColor;
        peerEl.innerHTML = `
            <video class="video" autoplay playsinline disablepictureinpicture></video>
            <div class="name" style="color: ${safeColor}">${escapeHTML(prof.displayName)}</div>
            <div class="toggleMute"></div>
            <div class="toggleRemoteVideo" style="top: 2.2rem"></div>
        `;
        document.querySelector('.conversation').appendChild(peerEl);
        peerEl.addEventListener('click', () => setFeatured(userId));

        const muteBtn = peerEl.querySelector('.toggleMute');
        const videoBtn = peerEl.querySelector('.toggleRemoteVideo');
        const videoEl = peerEl.querySelector('video');

        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            videoEl.muted = !videoEl.muted;
            muteBtn.classList.toggle('muted', videoEl.muted);
        });

        videoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = videoEl.style.opacity === '0';
            videoEl.style.opacity = isHidden ? '1' : '0';
            videoBtn.classList.toggle('muted', !isHidden);
        });

        if (isModerator) addModButtons(peerEl);
        if (!featuredUserId || featuredUserId === 'local') setFeatured(userId);
    } else {
        if (isModerator) addModButtons(peerEl);
        peerEl.querySelector('.name').innerText = prof.displayName;
        peerEl.querySelector('.name').style.color = safeColor;
        peerEl.style.backgroundColor = safeColor;
    }

    if (featuredUserId === userId) peerEl.classList.add('is-featured');
    else peerEl.classList.remove('is-featured');
}

function setFeatured(idOrTag, streamOverride = null) {
    console.log(`[UI] Setting featured: ${idOrTag}`);
    document.querySelectorAll('.peer.miniature').forEach(el => el.classList.remove('is-featured'));
    document.querySelector('.peer.local').classList.remove('is-featured');

    featuredUserId = idOrTag;
    const featuredEl = document.querySelector('.peer.featured');
    if (!idOrTag) { featuredEl.classList.add('hidden'); return; }

    if (idOrTag === 'local') {
        document.querySelector('.peer.local').classList.add('is-featured');
        document.querySelector('.peer.local').classList.add('hidden');
    } else if (idOrTag !== 'local-screen') {
        document.querySelector('.peer.local').classList.remove('hidden');
        const newMini = document.getElementById(`peer-${idOrTag}`);
        if (newMini) {
            newMini.classList.add('is-featured');
        }
    }

    featuredEl.classList.remove('hidden');
    const featuredVideo = featuredEl.querySelector('video');
    const featuredName = featuredEl.querySelector('.name');
    // Add mod controls on featured element for the displayed peer
    featuredEl.querySelector('.mod-controls')?.remove();
    if (isModerator && idOrTag && idOrTag !== 'local' && idOrTag !== 'local-screen') {
        const id = idOrTag;
        const modDiv = document.createElement('div');
        modDiv.className = 'mod-controls';
        modDiv.style.cssText = 'position:absolute;top:10px;left:10px;display:flex;gap:6px;z-index:10;flex-wrap:wrap;';
        const makeBtn = (label, bg, action) => {
            const btn = document.createElement('button');
            btn.innerText = label;
            btn.style.cssText = `font-size:12px;padding:4px 10px;width:auto;height:auto;background:${bg};color:white;border:none;border-radius:4px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4);`;
            btn.onclick = (e) => { e.stopPropagation(); socket.emit(action, id); };
            return btn;
        };
        const muteBtn = document.createElement('button');
        muteBtn.innerText = 'Mute';
        muteBtn.dataset.muted = 'false';
        muteBtn.style.cssText = `font-size:12px;padding:4px 10px;width:auto;height:auto;background:#22aa44;color:white;border:none;border-radius:4px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4);`;
        muteBtn.onclick = (e) => {
            e.stopPropagation();
            const muted = muteBtn.dataset.muted === 'true';
            if (muted) {
                socket.emit('mod-unmute', id);
                muteBtn.dataset.muted = 'false';
                muteBtn.style.background = '#22aa44';
                muteBtn.innerText = 'Mute';
            } else {
                socket.emit('mod-mute', id);
                muteBtn.dataset.muted = 'true';
                muteBtn.style.background = '#cc0000';
                muteBtn.innerText = 'Unmute';
            }
        };
        modDiv.appendChild(makeBtn('Kick', '#ff8800', 'mod-kick'));
        modDiv.appendChild(makeBtn('Kick 30s', '#ff5500', 'mod-kick-temp'));
        modDiv.appendChild(makeBtn('Ban', '#cc0000', 'mod-ban'));
        modDiv.appendChild(muteBtn);
        featuredEl.appendChild(modDiv);
    }

    if (idOrTag === 'local-screen' && streamOverride) {
        featuredName.innerText = "Your Screen";
        featuredName.style.color = "#FFFFFF";
        featuredEl.style.backgroundColor = "#222";
        featuredVideo.srcObject = streamOverride;
    } else {
        const prof = (idOrTag === 'local')
            ? { displayName: myDisplayName, profileColor: myProfileColor }
            : (remoteProfiles[idOrTag] || { displayName: 'Guest', profileColor: '#4A90E2' });

        featuredName.innerText = prof.displayName;
        featuredName.style.color = sanitizeColor(prof.profileColor);
        featuredEl.style.backgroundColor = sanitizeColor(prof.profileColor);
        if (idOrTag === 'local') { featuredVideo.srcObject = null; featuredVideo.srcObject = localStream; }
        else if (peers[idOrTag] && peers[idOrTag].remoteStream) { featuredVideo.srcObject = null; featuredVideo.srcObject = peers[idOrTag].remoteStream; }
    }
}

socket.on('user-disconnected', (userId) => {
    if (allowSoundNotifications && audioUnsure) audioUnsure.play().catch(e => {});
    if (peers[userId]) peers[userId].close();
    const el = document.getElementById(`peer-${userId}`);
    if (el) el.remove();
    delete remoteProfiles[userId]; delete peers[userId];
    if (featuredUserId === userId) {
        const remaining = Object.keys(peers);
        if (remaining.length === 0) {
            // Alone again - hide featured, local goes back small
            featuredUserId = null;
            const featuredEl = document.querySelector('.peer.featured');
            if (featuredEl) featuredEl.classList.add('hidden');
            const localEl = document.querySelector('.peer.local');
            if (localEl) { localEl.classList.remove('is-featured'); localEl.classList.remove('hidden'); }
        } else {
            featuredUserId = remaining[0];
            setFeatured(featuredUserId);
        }
    }
});

function createPeerConnection(userId, isInitiator) {
    const pc = new RTCPeerConnection({ iceServers: iceServersConfig });
    peers[userId] = pc;
    pc.remoteStream = new MediaStream();
    pc._isInitiator = isInitiator;

    if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('signal', { to: userId, signal: { candidate: e.candidate } }); };

    pc.ontrack = (e) => {
        e.streams[0].getTracks().forEach(track => pc.remoteStream.addTrack(track));
        const peerEl = document.getElementById(`peer-${userId}`);
        if (peerEl) peerEl.querySelector('video').srcObject = pc.remoteStream;
        if (featuredUserId === userId) setFeatured(userId);
    };

    pc.onnegotiationneeded = async () => {
        // Only the initiator sends the initial offer to avoid glare.
        // Once a remote description exists, either side can renegotiate
        // (e.g. when a new track is added later via handleToggleVideo/Audio).
        if (!pc._isInitiator && !pc.remoteDescription) return;
        try {
            const offer = await pc.createOffer();
            if (pc.signalingState !== 'stable') return; // state changed while awaiting
            await pc.setLocalDescription(offer);
            socket.emit('signal', { to: userId, signal: pc.localDescription });
        } catch (e) { console.error('Negotiation error:', e); }
    };

    return pc;
}

// NoSleep - prevent screen sleep on mobile
const noSleep = new NoSleep();

let _harkInstance = null;

function setupAudioAnalysis(stream) {
    if (_harkInstance) {
        _harkInstance.stop();
        _harkInstance = null;
    }
    _harkInstance = hark(stream, { interval: 100, threshold: -65, play: false });
    _harkInstance.on('speaking', () => {
        updateSpeakingUI('local', true);
        socket.emit('peer-speaking', { status: true });
    });
    _harkInstance.on('stopped_speaking', () => {
        updateSpeakingUI('local', false);
        socket.emit('peer-speaking', { status: false });
    });
}

function updateSpeakingUI(id, isSpeaking) {
    const el = id === 'local'
        ? document.querySelector('.toggleAudio')
        : (document.getElementById(`peer-${id}`) ? document.getElementById(`peer-${id}`).querySelector('.toggleMute') : null);
    if (el) { el.classList.toggle('speaking', isSpeaking); el.classList.toggle('sound', isSpeaking); }

    if (featuredUserId === id) {
        const featuredMute = document.querySelector('.peer.featured .toggleMute');
        if (featuredMute) {
            featuredMute.classList.toggle('speaking', isSpeaking);
            featuredMute.classList.toggle('sound', isSpeaking);
        }
    }
}

async function getDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoSelect.innerHTML = ''; audioSelect.innerHTML = '';
    devices.forEach(device => {
        const option = document.createElement('option'); option.value = device.deviceId;
        if (device.kind === 'videoinput') { option.text = device.label || `Camera ${videoSelect.options.length + 1}`; videoSelect.appendChild(option); }
        else if (device.kind === 'audioinput') { option.text = device.label || `Microphone ${audioSelect.options.length + 1}`; audioSelect.appendChild(option); }
    });
    if (videoSelect.options.length > 0) videoSelect.disabled = false;
    if (audioSelect.options.length > 0) audioSelect.disabled = false;

    // Attach change listeners only once
    if (!videoSelect._listenerAttached) {
        videoSelect._listenerAttached = true;
        videoSelect.addEventListener('change', async () => {
            if (!localStream) return;
            const deviceId = videoSelect.value;
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
                });
                const newTrack = newStream.getVideoTracks()[0];
                // Replace in all peer connections
                for (const id in peers) {
                    const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) await sender.replaceTrack(newTrack);
                }
                // Replace in local stream
                localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
                localStream.addTrack(newTrack);
                updateLocalVideoElement(localStream);
            } catch (err) { console.error('Video device switch error:', err); }
        });
    }

    if (!audioSelect._listenerAttached) {
        audioSelect._listenerAttached = true;
        audioSelect.addEventListener('change', async () => {
            if (!localStream) return;
            const deviceId = audioSelect.value;
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
                const newTrack = newStream.getAudioTracks()[0];
                // Replace in all peer connections
                for (const id in peers) {
                    const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'audio');
                    if (sender) await sender.replaceTrack(newTrack);
                }
                // Replace in local stream and restart hark
                localStream.getAudioTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
                localStream.addTrack(newTrack);
                setupAudioAnalysis(localStream);
            } catch (err) { console.error('Audio device switch error:', err); }
        });
    }
}

socket.on('peer-speaking', (data) => {
    updateSpeakingUI(data.id, data.status);
});

socket.on('chat-message', (data) => {
    if (allowSoundNotifications && audioMessage) audioMessage.play().catch(e => {});
    const div = document.createElement('div'); div.className = 'message';
    div.innerHTML = `<span style="color: ${sanitizeColor(data.color)}"><span class="user-name">${escapeHTML(data.userName)} :</span> ${linkify(data.message)}</span>`;
    messagesContainer.appendChild(div); messagesContainer.scrollTop = messagesContainer.scrollHeight;
    const snippet = document.querySelector('.snippet');
    if (snippet && chatPanel.classList.contains('hidden')) {
        snippet.innerText = `${data.userName}: ${data.message}`; snippet.classList.remove('hidden', 'faded');
        clearTimeout(snippet.hideTimeout); snippet.hideTimeout = setTimeout(() => snippet.classList.add('faded'), 3000);
    }
});

socket.on('video-status', (data) => {
    updateVideoVisibility(data.id, data.enabled);
});

socket.on('profile-update', (data) => {
    if (data.id === socket.id) return;
    remoteProfiles[data.id] = { displayName: data.displayName, profileColor: sanitizeColor(data.profileColor) };
    updatePeerUI(data.id);
    if (featuredUserId === data.id) setFeatured(data.id);
});

socket.on('sync-profiles', (profiles) => {
    for (const id in profiles) {
        if (id === socket.id || id === 'local') continue;
        if (profiles[id]) {
            remoteProfiles[id] = {
                displayName: profiles[id].displayName,
                profileColor: sanitizeColor(profiles[id].profileColor)
            };
        }
        updatePeerUI(id);
    }
    // Re-apply mod buttons after peers are created (with delay to ensure DOM ready)
    setTimeout(() => {
        if (isModerator) {
            document.querySelectorAll('.peer.miniature').forEach(peer => addModButtons(peer));
        }
    }, 300);
});

// Function to create room link with hidden profile
async function createShortLink() {
    // Extract room name from current URL
    const roomName = window.location.pathname.split('/').pop() || 'friends';
    const pseudo = myDisplayName;
    const color = myProfileColor.replace('#', '');
    
    try {
        const response = await fetch('/api/room-profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                room: roomName,
                pseudo: pseudo,
                color: color
            })
        });
        
        const result = await response.json();
        if (result.ok) {
            // Copy to clipboard
            await navigator.clipboard.writeText(result.url);
            
            // Show notification
            showNotification('Lien copié dans le presse-papiers !\n' + result.url);
        }
    } catch (error) {
        console.error('Error creating room link:', error);
        showNotification('Erreur lors de la création du lien');
    }
}

// Function to create transfer link using existing localStorage profile
async function createTransferLink() {
    // Use existing profile from localStorage (displayName and profileColor)
    const pseudo = localStorage.getItem('displayName') || myDisplayName;
    const color = localStorage.getItem('profileColor') || myProfileColor.replace('#', '');
    const currentRoom = window.location.pathname.split('/').pop() || 'friends';
    
    // Store profile in localStorage for cross-domain transfer
    localStorage.setItem('transferProfile', JSON.stringify({
        pseudo: pseudo,
        color: color.replace('#', ''),
        timestamp: Date.now()
    }));
    
    // Create clean link
    const transferLink = `https://chaltet.com/${currentRoom}`;
    
    // Copy to clipboard
    await navigator.clipboard.writeText(transferLink);
    
    // Show notification
    showNotification('Lien copié !\n' + transferLink + '\n\nLe profil sera transféré automatiquement.');
}

// Function to show notification
function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        z-index: 10000;
        font-family: monospace;
        font-size: 14px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        white-space: pre-line;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        createTransferLink(); // Changed to transfer link
    }
});
