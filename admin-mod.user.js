// ==UserScript==
// @name         666
// @namespace    https://chaltet.com
// @version      2.0
// @description  Admin access for Chatlet stats and moderator mode
// @author       OG
// @match        https://chaltet.com/*
// @match        https://www.chaltet.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    const MOD_SECRET = 'un_mot_de_passe_secret_solide';
    localStorage.setItem('modSecret', MOD_SECRET);
})();
