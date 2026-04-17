// ==UserScript==
// @name         Chatlet Room Profiles Detection
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Detect ALL profiles in room and send to chaltet.com
// @author       You
// @match        https://chatlet.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    let detectedProfiles = [];
    let isMonitoring = false;
    
    // Function to detect ALL profiles in current room
    function detectAllProfiles() {
        detectedProfiles = [];
        
        // Look for ALL user elements in room
        const userElements = document.querySelectorAll('[data-profile], .user-item, .participant, [id*="user"], [class*="user"], .user-list li, .chat-user, .member');
        
        userElements.forEach(element => {
            try {
                let pseudo = '';
                let color = '';
                
                // From data attributes
                if (element.dataset.profile) {
                    const profile = JSON.parse(element.dataset.profile);
                    pseudo = profile.displayName || profile.pseudo;
                    color = profile.profileColor || profile.color;
                }
                
                // From text content
                if (!pseudo) {
                    const nameElement = element.querySelector('.name, .username, .pseudo, .display-name') || element;
                    pseudo = nameElement.textContent.trim();
                    
                    const styleElement = element.querySelector('[style*="color"], .color-dot, .avatar') || element;
                    const computedStyle = window.getComputedStyle(styleElement);
                    color = computedStyle.color || '#000000';
                    if (color.startsWith('rgb')) {
                        const rgb = color.match(/\d+/g);
                        color = '#' + rgb.map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
                    }
                }
                
                if (pseudo && !detectedProfiles.find(p => p.pseudo === pseudo)) {
                    detectedProfiles.push({
                        pseudo: pseudo,
                        color: color.replace('#', '')
                    });
                }
            } catch (e) {
                console.log('Error:', e);
            }
        });
        
        console.log('Detected profiles:', detectedProfiles);
        sendProfilesToServer();
    }
    
    // Send profiles to chaltet.com server
    async function sendProfilesToServer() {
        const currentRoom = window.location.pathname.split('/').pop() || 'friends';
        
        if (detectedProfiles.length === 0) return;
        
        try {
            // Get current IP from server
            const ipResponse = await fetch('https://chaltet.com/api/get-ip');
            const ipData = await ipResponse.json();
            const currentIp = ipData.ip;
            
            // Send profiles with IP
            await fetch('https://chaltet.com/api/store-room-profiles', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    room: currentRoom,
                    profiles: detectedProfiles,
                    currentIp: currentIp
                })
            });
            console.log('Profiles sent to server with IP:', currentIp);
        } catch (e) {
            console.error('Error sending profiles:', e);
        }
    }
    
    // Auto-detect periodically
    function startMonitoring() {
        if (isMonitoring) return;
        isMonitoring = true;
        
        detectAllProfiles();
        
        const observer = new MutationObserver(() => {
            setTimeout(detectAllProfiles, 3000);
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        setInterval(detectAllProfiles, 10000);
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMonitoring);
    } else {
        startMonitoring();
    }
    
    console.log('Chatlet Room Profiles Detection loaded!');
})();
