// ==UserScript==
// @name         Chatlet Profile Transfer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Add profile transfer functionality to chatlet.com
// @author       You
// @match        https://chatlet.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    // Function to create transfer link using existing localStorage profile
    async function createTransferLink() {
        // Use existing profile from localStorage
        const pseudo = localStorage.getItem('displayName');
        const color = localStorage.getItem('profileColor');
        const currentRoom = window.location.pathname.split('/').pop() || 'friends';
        
        if (!pseudo || !color) {
            alert('Profil non trouvé dans localStorage');
            return;
        }
        
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
        }, 3000);
    }
    
    // Add keyboard shortcut Ctrl+T
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 't') {
            e.preventDefault();
            createTransferLink();
        }
    });
    
    // Also add a button for easier access
    function addTransferButton() {
        const button = document.createElement('button');
        button.textContent = 'Transférer vers chaltet.com';
        button.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #007cba;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            z-index: 10000;
            font-family: Arial, sans-serif;
        `;
        button.onclick = createTransferLink;
        document.body.appendChild(button);
    }
    
    // Wait for page to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addTransferButton);
    } else {
        addTransferButton();
    }
    
    console.log('Chatlet Profile Transfer script loaded! Use Ctrl+T or click the button.');
})();
