// ==UserScript==
// @name         Chatlet Profile Auto-Detection
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Auto-detect profiles in room and enable group transfer
// @author       You
// @match        https://chatlet.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    let detectedProfiles = [];
    let isMonitoring = false;
    
    // Function to detect profiles in current room
    function detectProfiles() {
        detectedProfiles = [];
        
        // Look for user elements in the room
        const userElements = document.querySelectorAll('[data-profile], .user-item, .participant, [id*="user"], [class*="user"]');
        
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
                    const nameElement = element.querySelector('.name, .username, .pseudo') || element;
                    pseudo = nameElement.textContent.trim();
                    
                    const styleElement = element.querySelector('[style*="color"], .color-dot') || element;
                    const computedStyle = window.getComputedStyle(styleElement);
                    color = computedStyle.color || '#000000';
                    // Convert to hex
                    if (color.startsWith('rgb')) {
                        const rgb = color.match(/\d+/g);
                        color = '#' + rgb.map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
                    }
                }
                
                // Method 3: From localStorage if current user
                if (!pseudo && element.classList.contains('current-user')) {
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
        
        console.log('Detected profiles:', detectedProfiles);
        updateStorage();
    }
    
    // Store detected profiles for transfer
    function updateStorage() {
        const currentRoom = window.location.pathname.split('/').pop() || 'friends';
        const storageKey = `roomProfiles_${currentRoom}`;
        
        localStorage.setItem(storageKey, JSON.stringify({
            profiles: detectedProfiles,
            timestamp: Date.now()
        }));
        
        // Also store in transferProfile for immediate use
        if (detectedProfiles.length > 0) {
            localStorage.setItem('transferProfile', JSON.stringify({
                profiles: detectedProfiles,
                room: currentRoom,
                timestamp: Date.now()
            }));
        }
    }
    
    // Create transfer link with all detected profiles
    async function createGroupTransferLink() {
        const currentRoom = window.location.pathname.split('/').pop() || 'friends';
        
        if (detectedProfiles.length === 0) {
            showNotification('Aucun profil détecté dans la room');
            return;
        }
        
        // Store all detected profiles
        localStorage.setItem('transferProfile', JSON.stringify({
            profiles: detectedProfiles,
            room: currentRoom,
            timestamp: Date.now()
        }));
        
        // Create clean link
        const transferLink = `https://chaltet.com/${currentRoom}`;
        
        // Copy to clipboard
        await navigator.clipboard.writeText(transferLink);
        
        // Show notification
        showNotification(`Lien copié !\n${transferLink}\n\n${detectedProfiles.length} profil(s) détecté(s) pour transfert.`);
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
            max-width: 300px;
            white-space: pre-line;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 4000);
    }
    
    // Auto-detect profiles periodically
    function startMonitoring() {
        if (isMonitoring) return;
        isMonitoring = true;
        
        // Initial detection
        detectProfiles();
        
        // Monitor for changes
        const observer = new MutationObserver(() => {
            setTimeout(detectProfiles, 1000);
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-profile', 'class']
        });
        
        // Periodic detection
        setInterval(detectProfiles, 5000);
        
        console.log('Profile monitoring started for room:', window.location.pathname);
    }
    
    // Clean up when leaving page
    window.addEventListener('beforeunload', () => {
        // Clear transfer profiles when leaving
        localStorage.removeItem('transferProfile');
        console.log('Transfer profiles cleared on page leave');
    });
    
    // Add keyboard shortcut Ctrl+T
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 't') {
            e.preventDefault();
            createGroupTransferLink();
        }
    });
    
    // Start monitoring when page is ready
    function initialize() {
        // Wait a bit for the page to fully load
        setTimeout(() => {
            startMonitoring();
            showNotification('Détection automatique activée !\nCtrl+T pour transférer tous les profils.');
        }, 2000);
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
    
    console.log('Chatlet Profile Auto-Detection script loaded!');
})();
