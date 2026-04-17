// ==UserScript==
// @name         Chatlet All Profiles Transfer
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Detect ALL users in room and transfer their profiles
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
                // Try to extract pseudo and color from various possible sources
                let pseudo = '';
                let color = '';
                
                // Method 1: From data attributes
                if (element.dataset.profile) {
                    const profile = JSON.parse(element.dataset.profile);
                    pseudo = profile.displayName || profile.pseudo;
                    color = profile.profileColor || profile.color;
                }
                
                // Method 2: From text content and styles
                if (!pseudo) {
                    const nameElement = element.querySelector('.name, .username, .pseudo, .display-name') || element;
                    pseudo = nameElement.textContent.trim();
                    
                    const styleElement = element.querySelector('[style*="color"], .color-dot, .avatar') || element;
                    const computedStyle = window.getComputedStyle(styleElement);
                    color = computedStyle.color || '#000000';
                    // Convert to hex
                    if (color.startsWith('rgb')) {
                        const rgb = color.match(/\d+/g);
                        color = '#' + rgb.map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
                    }
                }
                
                // Method 3: From list items
                if (!pseudo) {
                    pseudo = element.textContent.trim();
                    const pseudoMatch = pseudo.match(/^([A-Za-z0-9_]+)$/);
                    if (pseudoMatch) {
                        pseudo = pseudoMatch[1];
                    }
                }
                
                // Method 4: From localStorage if current user
                if (!pseudo && (element.classList.contains('current-user') || element.classList.contains('me'))) {
                    pseudo = localStorage.getItem('displayName');
                    color = localStorage.getItem('profileColor');
                }
                
                if (pseudo && !detectedProfiles.find(p => p.pseudo === pseudo)) {
                    detectedProfiles.push({
                        pseudo: pseudo,
                        color: color.replace('#', ''),
                        element: element
                    });
                }
            } catch (e) {
                console.log('Error detecting profile:', e);
            }
        });
        
        console.log('Detected ALL profiles:', detectedProfiles);
        updateStorage();
    }
    
    // Store ALL detected profiles for transfer
    function updateStorage() {
        const currentRoom = window.location.pathname.split('/').pop() || 'friends';
        
        if (detectedProfiles.length === 0) {
            console.log('No profiles detected in room');
            return;
        }
        
        // Store ALL profiles in transferProfile
        localStorage.setItem('transferProfile', JSON.stringify({
            profiles: detectedProfiles,
            room: currentRoom,
            timestamp: Date.now()
        }));
        
        // Generate and copy the transfer link
        const transferLink = `https://chaltet.com/${currentRoom}`;
        
        // Copy to clipboard
        navigator.clipboard.writeText(transferLink).then(() => {
            showNotification(`TOUS les profils transférés !\n${detectedProfiles.length} utilisateur(s) détecté(s)\nLien: ${transferLink}`);
        }).catch(err => {
            console.error('Failed to copy link:', err);
            showNotification('Erreur lors de la copie du lien');
        });
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
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: Arial, sans-serif;
            font-size: 14px;
            max-width: 350px;
            white-space: pre-line;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 6000);
    }
    
    // Auto-detect ALL profiles periodically
    function startMonitoring() {
        if (isMonitoring) return;
        isMonitoring = true;
        
        // Initial detection
        detectAllProfiles();
        
        // Monitor for changes
        const observer = new MutationObserver(() => {
            setTimeout(detectAllProfiles, 2000);
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-profile', 'class']
        });
        
        // Periodic detection
        setInterval(detectAllProfiles, 8000);
        
        console.log('ALL profiles monitoring started for room:', window.location.pathname);
    }
    
    // Clean up when leaving page
    window.addEventListener('beforeunload', () => {
        console.log('Page leaving - ALL profiles ready for transfer');
    });
    
    // Start monitoring when page is ready
    function initialize() {
        // Wait for page to fully load
        setTimeout(() => {
            startMonitoring();
            showNotification('Détection de TOUS les profils activée !\nTous les utilisateurs seront détectés automatiquement.');
        }, 3000);
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
    
    console.log('Chatlet ALL Profiles Transfer script loaded!');
})();
