const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const fsp = fs.promises;

const IPHUB_API_KEY = process.env.IPHUB_API_KEY || 'MzA0Mjc6TDZJMnA2OTA1MkpDajJvRXEweDB3Tkp4Zk00Y3FFSjk=';
const STATS_PASSWORD = process.env.STATS_PASSWORD || '3wQUrs05E4MczwcB@ev02LMO';

// Conditional logging for production
const isProduction = process.env.NODE_ENV === 'production';
const log = isProduction ? 
    (msg, ...args) => console.error(`[${new Date().toISOString()}] ${msg}`, ...args) : 
    (msg, ...args) => console.log(msg, ...args);

// File paths (fallback when Redis unavailable)
const CONFIG_FILE = path.join(__dirname, 'config.json');
const BLACKLIST_FILE = path.join(__dirname, 'blacklist.json');
const EXTRAS_FILE = path.join(__dirname, 'extras.json');
const NOTES_FILE = path.join(__dirname, 'notes.json');
const LOG_FILE = path.join(__dirname, 'display.txt');

// Redis storage client (separate from Socket.io adapter)
let redisStore = null;
if (process.env.REDIS_URL) {
    redisStore = createClient({ url: process.env.REDIS_URL });
    redisStore.connect()
        .then(() => log('[Redis] Storage client connected'))
        .catch(err => { console.error('[Redis] Storage connection error:', err); redisStore = null; });
}

// Redis-backed helpers
async function redisGet(key, defaultVal) {
    try {
        if (redisStore) {
            const val = await redisStore.get(key);
            return val ? JSON.parse(val) : defaultVal;
        }
    } catch(e) { 
        console.error('[Redis] Get error for key', key, ':', e.message); 
    }
    return defaultVal;
}

async function redisSet(key, val) {
    try {
        if (redisStore) await redisStore.set(key, JSON.stringify(val));
    } catch(e) { 
        console.error('[Redis] Set error for key', key, ':', e.message); 
    }
}

async function redisAppendLog(line) {
    try {
        if (redisStore) {
            await redisStore.rPush('logs', line);
            await redisStore.lTrim('logs', -5000, -1); // Keep last 5000 lines
            return;
        }
    } catch(e) { 
        console.error('[Redis] Log append error:', e.message); 
    }
    // Fallback to file
    await fsp.appendFile(LOG_FILE, line + '\n', 'utf8');
}

async function redisGetLogs(maxLines = 5000) {
    try {
        if (redisStore) {
            const lines = await redisStore.lRange('logs', -maxLines, -1);
            return lines.join('\n');
        }
    } catch(e) { 
        console.error('[Redis] Get logs error:', e.message); 
    }
    return getTailLogs(LOG_FILE, maxLines);
}

// Admin Sessions (Transient memory)
const authTokens = new Map();

// Helper to read JSON (Async)
async function readJson(file, defaultVal = {}) {
    try {
        if (!fs.existsSync(file)) return defaultVal;
        const data = await fsp.readFile(file, 'utf8');
        return JSON.parse(data);
    } catch (e) { return defaultVal; }
}

// Special Sync helper for Socket.io or cases where async is hard (Keep as fallback but minimize use)
function readJsonSync(file, defaultVal = {}) {
    try {
        if (!fs.existsSync(file)) return defaultVal;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { return defaultVal; }
}

// Helper to write JSON (Async)
async function writeJson(file, data) {
    try {
        await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) { console.error(`Error writing to ${file}:`, e); }
}

// Helper to log to file (Async)
async function appendLog(line) {
    try {
        await fsp.appendFile(LOG_FILE, line + '\n', 'utf8');
    } catch (e) { console.error('Error writing to log.txt:', e); }
}


// VPN Detection Fallback (Ranges from PHP code)
function isLikelyVPNFallback(ip) {
    const vpnRanges = [
        '45.76.0.0/16', '104.20.0.0/16', '185.220.101.0/24',
        '51.81.0.0/16', '167.99.0.0/16', '159.203.0.0/16'
    ];
    // Simple implementation or just return false for now to keep it lean
    return false;
}

// Fetch helper with timeout
function fetchJson(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, { headers }, (res) => {
            clearTimeout(timeout);
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', (e) => {
            clearTimeout(timeout);
            reject(e);
        });
    });
}

async function isVPNviaIPHub(ip) {
    const cacheFile = path.join(__dirname, 'vpn_cache.json');
    let cache = await readJson(cacheFile, {});
    if (cache[ip] && (Date.now() - cache[ip].time) < 86400000) {
        return cache[ip].is_vpn;
    }
    try {
        const data = await fetchJson(`https://v2.api.iphub.info/ip/${ip}`, { 'X-Key': IPHUB_API_KEY });
        const isVPN = data.block === 1;
        cache[ip] = { is_vpn: isVPN, time: Date.now() };
        await writeJson(cacheFile, cache);
        return isVPN;
    } catch (e) {
        return isLikelyVPNFallback(ip);
    }
}


async function getLocation(ip) {
    try {
        const data = await fetchJson(`http://ip-api.com/json/${ip}?fields=status,message,country,city`);
        return { city: data.city || 'N/A', country: data.country || 'N/A' };
    } catch (e) {
        return { city: 'N/A', country: 'N/A' };
    }
}

function parseUserAgent(agent) {
    if (!agent) return 'UNKNOWN';
    const a = agent.toLowerCase();
    if (a.includes('mobile') || a.includes('android') || a.includes('iphone')) return 'Mobile';
    if (a.includes('chrome')) return 'Chrome';
    if (a.includes('firefox')) return 'Firefox';
    if (a.includes('safari')) return 'Safari';
    return 'Other';
}

// Helper to read ONLY the last N lines of a file (Async)
async function getTailLogs(file, maxLines = 5000) {
    try {
        if (!fs.existsSync(file)) return '';
        const data = await fsp.readFile(file, 'utf8');
        const lines = data.trim().split('\n');
        return lines.slice(-maxLines).join('\n');
    } catch (e) { return ''; }
}



const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
async function getLetterForIP(ip) {
    const data = await redisGetLogs(3000); // Read more for letter consistency
    const logs = data.split('\n');
    
    for (const line of logs) {
        const match = line.match(/IP:\s*([\d\.\:]+)\s*\|\s*([A-Z]{1,2})/);
        if (match && match[1] === ip) return match[2];
    }
    
    const usedLetters = new Set();
    for (const line of logs) {
        const match = line.match(/\|\s*([A-Z]{1,2})\s*\|\s*[^|]+\(/);
        if (match) usedLetters.add(match[1]);
    }

    for (let i = 0; i < 26; i++) {
        const letter = alphabet[i];
        if (!usedLetters.has(letter)) return letter;
    }
    for (let i = 0; i < 26; i++) {
        for (let j = 0; j < 26; j++) {
            const letter = alphabet[i] + alphabet[j];
            if (!usedLetters.has(letter)) return letter;
        }
    }
    return 'ZZ';
}




const ALLOWED_ORIGINS = [
    'https://chatlet2.onrender.com',
    'http://chatlet2.onrender.com',
    'https://chaltet.com',
    'http://chaltet.com',
    'https://www.chaltet.com',
    'http://www.chaltet.com'
];

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: (origin, callback) => {
            if (!origin || ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3000;
const MOD_PASSWORD = process.env.MOD_PASSWORD || crypto.randomBytes(32).toString('hex');
// MOD_PASSWORD is for the mod script, STATS_PASSWORD is for the stats dashboard.
const bannedIps = new Set();

if (process.env.REDIS_URL) {
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
        io.adapter(createAdapter(pubClient, subClient));
        log('[Socket] Redis Adapter attached successfully: ready to scale!');
    }).catch(err => {
        console.error('[Socket] Redis Adapter connection error:', err);
    });
}

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.gstatic.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "https://images.unsplash.com", "data:"],
            connectSrc: ["'self'", "wss://chatlet2.onrender.com", "ws://chatlet2.onrender.com", "wss://chaltet.com", "ws://chaltet.com", "wss://www.chaltet.com", "ws://www.chaltet.com", "https://stun.l.google.com", "https://global.relay.metered.ca", "https://chatlet.metered.live", "turn:global.relay.metered.ca", "turns:global.relay.metered.ca", "stun:stun.l.google.com", "stun:stun1.l.google.com"],
            mediaSrc: ["'self'", "data:"],
            frameSrc: ["'none'"],
        }
    }
}));


const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { ok: false, message: "Trop de tentatives de connexion, réessayez plus tard." }
});

app.use(express.json());

app.use(async (req, res, next) => {
    // Skip static assets filters to avoid overhead
    const ext = path.extname(req.path);
    if (ext && ext !== '.html') return next();
    if (req.path.startsWith('/socket.io') || req.path.startsWith('/api/ice-servers')) return next();

    const ip = req.ip;
    const config = await redisGet('config', { whitelist_mode: false, redirect_url: '' });
    const blacklist = await redisGet('blacklist', []);
    
    const rule = blacklist.find(r => r.ip === ip);
    const isBlocked = rule ? rule.blocked : false;
    const isWhitelisted = rule ? rule.whitelist : false;
    
    const redirectTarget = config.redirect_url || 'https://google.com';
    
    // Filter
    if (!req.path.startsWith('/admin')) {
        if (config.whitelist_mode) {
            if (!isWhitelisted) return res.redirect(redirectTarget);
        } else if (isBlocked) {
            return res.redirect(redirectTarget);
        }
    }

    // Logging (similaire à index.php)
    const ignoreLogging = ['/api/', '/admin/', '/favicon'];
    if (!ignoreLogging.some(p => req.path.startsWith(p))) {
        const date = new Date().toISOString().replace('T', ' ').split('.')[0];
        // Use real public IP from x-forwarded-for for geolocation
        const realIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || ip;
        const urlObj = new URL(req.originalUrl, 'http://localhost');
        const room = urlObj.pathname.replace(/^\//, '') || '/';
        const urlPseudo = urlObj.searchParams.get('pseudo') || '';
        const urlColor = urlObj.searchParams.get('color') ? '#' + urlObj.searchParams.get('color') : '';
        
        // Exécution background
        (async () => {
            try {
                const letter = await getLetterForIP(realIp);
                const [loc, isVPN] = await Promise.all([getLocation(realIp), isVPNviaIPHub(realIp)]);
                const vpnFlag = isVPN ? '[VPN]' : '';
                const browser = parseUserAgent(req.headers['user-agent']);
                const logLine = `[${date}] IP: ${realIp} | ${letter} | ${loc.city}(${loc.country}) | ${vpnFlag} |  | ${browser} | ${room}`;
                await redisAppendLog(logLine);
                
                // If pseudo or color in URL, save to extras immediately
                if (urlPseudo || urlColor) {
                    const extras = await redisGet('extras', {});
                    if (!extras[realIp]) extras[realIp] = {};
                    if (urlPseudo) {
                        const existing = extras[realIp].pseudos ? extras[realIp].pseudos.split(', ') : [];
                        if (!existing.includes(urlPseudo)) existing.push(urlPseudo);
                        extras[realIp].pseudos = existing.join(', ');
                        extras[realIp].url_pseudo = urlPseudo;
                    }
                    if (urlColor) extras[realIp].url_color = urlColor;
                    await redisSet('extras', extras);
                }
            } catch (err) { log('Logging error:', err); }
        })();
    }
    
    next();
});

// Admin dashboard - accessible via Tampermonkey script
app.get('/admin-stats.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-stats.html'));
});

app.use(express.static(path.join(__dirname, 'public')));


app.get(/^\/favicon/, (req, res) => res.status(204).end());

app.post('/api/collect', async (req, res) => {
    const data = req.body;
    // Use real public IP as key
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
    if (!ip) return res.status(400).json({ ok: false });
    
    const extras = await redisGet('extras', {});
    extras[ip] = {
        screen: data.screen || 'N/A',
        lang: data.lang || 'N/A',
        timezone: data.timezone || 'N/A',
        cores: data.cores || 'N/A',
        ram: data.ram ? data.ram + ' GB' : 'N/A',
        touch: data.touch ? 'Oui' : 'Non',
        platform: data.platform || 'N/A',
        darkmode: data.darkmode ? '🌙 Dark' : '☀️ Light',
        battery_level: data.battery_level !== null ? data.battery_level + '%' : 'N/A',
        battery_charging: data.battery_charging !== null ? (data.battery_charging ? '⚡ Oui' : 'Non') : 'N/A',
        connection: data.connection || 'N/A',
        localstorage: data.localstorage || 'N/A',
        adblock: data.adblock || 'N/A',
        time: Math.floor(Date.now() / 1000)
    };
    await redisSet('extras', extras);
    res.json({ ok: true });
});



app.get('/api/ice-servers', async (req, res) => {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const staticFallback = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ];
    if (!twilioSid || !twilioToken) return res.json(staticFallback);
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Tokens.json`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${auth}` },
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) throw new Error('Twilio API error');
        const data = await response.json();
        res.json(data.ice_servers);
    } catch (e) { log('[ICE] Failed to fetch Twilio TURN credentials:', e.message);
        res.json(staticFallback);
    }
});

// Cross-domain profile sharing system
app.post('/api/transfer-profile', async (req, res) => {
    const { pseudo, color } = req.body;
    if (!pseudo || !color) return res.status(400).json({ ok: false });
    
    // Generate temporary token for profile transfer
    const token = crypto.randomBytes(8).toString('hex');
    const profileData = {
        pseudo: pseudo,
        color: color,
        timestamp: Date.now()
    };
    
    try {
        // Store with 5-minute expiration
        await redisSet('transfer:' + token, profileData);
        res.json({ 
            ok: true, 
            token: token
        });
    } catch (error) {
        console.error('Error creating transfer token:', error);
        res.status(500).json({ ok: false });
    }
});

// Get shared profile for cross-domain access
app.get('/api/get-shared-profile', async (req, res) => {
    const realIp = req.headers['x-forwarded-for'] 
        ? req.headers['x-forwarded-for'].split(',')[0].trim() 
        : req.ip;
    
    try {
        const sharedProfiles = await redisGet('sharedProfiles', {});
        const profile = sharedProfiles[realIp];
        
        if (profile && Date.now() - profile.timestamp < 10 * 60 * 1000) { // 10 minutes
            res.json({ ok: true, profile: { pseudo: profile.pseudo, color: profile.color } });
        } else {
            res.json({ ok: false });
        }
    } catch (error) {
        console.error('Error getting shared profile:', error);
        res.json({ ok: false });
    }
});

// API to get user profile by IP (for cross-domain requests)
app.get('/api/get-user-profile', async (req, res) => {
    const requestedIp = req.query.ip;
    if (!requestedIp) return res.json({ ok: false });
    
    // Set CORS headers for cross-origin requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    try {
        const extras = await redisGet('extras', {});
        const userProfile = extras[requestedIp];
        
        if (userProfile && (userProfile.url_pseudo || userProfile.url_color)) {
            res.json({ 
                ok: true, 
                profile: { 
                    pseudo: userProfile.url_pseudo, 
                    color: userProfile.url_color 
                } 
            });
        } else {
            res.json({ ok: false });
        }
    } catch (error) {
        console.error('Error getting user profile:', error);
        res.json({ ok: false });
    }
});

// API to save transferred profile from localStorage
app.post('/api/save-transferred-profile', async (req, res) => {
    const { pseudo, color } = req.body;
    if (!pseudo && !color) return res.json({ ok: false });
    
    const realIp = req.headers['x-forwarded-for'] 
        ? req.headers['x-forwarded-for'].split(',')[0].trim() 
        : req.ip;
    
    try {
        const extras = await redisGet('extras', {});
        if (!extras[realIp]) extras[realIp] = {};
        
        if (pseudo) extras[realIp].url_pseudo = pseudo;
        if (color) extras[realIp].url_color = color;
        
        await redisSet('extras', extras);
        log(`[Profile] Saved transferred profile for ${realIp}: ${pseudo}`);
        res.json({ ok: true });
    } catch (error) {
        console.error('Error saving transferred profile:', error);
        res.status(500).json({ ok: false });
    }
});

// Room profile system - store profile data for room links
app.post('/api/room-profile', async (req, res) => {
    const { room, pseudo, color } = req.body;
    if (!room || typeof room !== 'string') return res.status(400).json({ ok: false });
    
    // Sanitize room name
    room = room.replace(/[^a-z0-9\-_]/gi, '').toLowerCase();
    if (!room) return res.status(400).json({ ok: false });
    
    try {
        const roomProfiles = await redisGet('roomProfiles', {});
        if (!roomProfiles[room]) roomProfiles[room] = {};
        
        // Add profile data if provided
        if (pseudo || color) {
            roomProfiles[room].profile = {
                pseudo: pseudo || null,
                color: color || null
            };
        }
        
        await redisSet('roomProfiles', roomProfiles);
        res.json({ ok: true, url: 'https://chaltet.com/' + room });
    } catch (error) {
        console.error('Error saving room profile:', error);
        res.status(500).json({ ok: false });
    }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/:room', async (req, res) => {
  const room = req.params.room;
  if (room === 'random') {
      const randomName = crypto.randomBytes(4).toString('hex');
      return res.redirect('/' + randomName);
  }
  if (room !== room.toLowerCase()) {
      return res.redirect('/' + room.toLowerCase());
  }
  
  // Check if user is coming from chatlet.com with profile transfer
  const referer = req.headers.referer || '';
  const profileToken = req.query.profile;
  
  if (profileToken) {
      // Apply profile from token
      try {
          const transferData = await redisGet('transfer:' + profileToken, null);
          if (transferData && Date.now() - transferData.timestamp < 5 * 60 * 1000) {
              const realIp = req.headers['x-forwarded-for'] 
                  ? req.headers['x-forwarded-for'].split(',')[0].trim() 
                  : req.ip;
              
              const extras = await redisGet('extras', {});
              if (!extras[realIp]) extras[realIp] = {};
              extras[realIp].url_pseudo = transferData.pseudo;
              extras[realIp].url_color = transferData.color;
              await redisSet('extras', extras);
              log(`[Profile] Applied profile from token for ${realIp}: ${transferData.pseudo}`);
          }
      } catch (error) {
          console.error('Error applying profile from token:', error);
      }
  }
  
  const realIp = req.headers['x-forwarded-for'] 
      ? req.headers['x-forwarded-for'].split(',')[0].trim() 
      : req.ip;
  
  try {
      const extras = await redisGet('extras', {});
      if (!extras[realIp]) extras[realIp] = {};
      
      // Check for room-specific profile
      const roomProfiles = await redisGet('roomProfiles', {});
      if (roomProfiles[room] && roomProfiles[room].profile) {
          extras[realIp].url_pseudo = roomProfiles[room].profile.pseudo;
          extras[realIp].url_color = roomProfiles[room].profile.color;
          log(`[Profile] Applied room profile for ${realIp}: ${roomProfiles[room].profile.pseudo}`);
      }
      
      await redisSet('extras', extras);
  } catch (error) {
      console.error('Error applying profile:', error);
  }
  
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Admin Routes - accessible with Tampermonkey script detection
app.get('/admin/stats', (req, res) => {
    const adminToken = req.headers['x-admin-token'] || req.query.admin_token;
    const expectedToken = process.env.ADMIN_TOKEN || 'admin_access_2024';
    
    // Temporarily disable token check for testing
    // if (!adminToken || adminToken !== expectedToken) {
    //     return res.status(403).send('Access denied - Tampermonkey script required');
    // }
    
    res.sendFile(path.join(__dirname, 'public', 'admin-stats.html'));
});


app.post('/admin/api/login', adminLoginLimiter, (req, res) => {
    if (!req.body || typeof req.body.password !== 'string' || req.body.password.length === 0) {
        return res.status(400).json({ ok: false, message: 'Invalid password format' });
    }
    if (req.body.password === STATS_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        authTokens.set(token, Date.now());
        // Clean old tokens
        for (const [t, time] of authTokens.entries()) {
            if (Date.now() - time > 24 * 60 * 60 * 1000) authTokens.delete(t);
        }
        return res.json({ ok: true, token });
    }
    res.status(401).json({ ok: false });
});

app.post('/admin/api/data', async (req, res) => {
    if (!req.body || typeof req.body.token !== 'string' || req.body.token.length === 0) {
        return res.status(400).json({ ok: false, message: 'Invalid token format' });
    }
    if (!authTokens.has(req.body.token)) return res.status(401).json({ ok: false });
    
    const [logs, config, blacklist, extras, notes] = await Promise.all([
        redisGetLogs(5000),
        redisGet('config', { whitelist_mode: false, redirect_url: '' }),
        redisGet('blacklist', []),
        redisGet('extras', {}),
        redisGet('notes', {})
    ]);
    
    res.json({ ok: true, logs, config, blacklist, extras, notes });
});


app.post('/admin/api/toggle', async (req, res) => {
    if (!authTokens.has(req.body.token)) return res.status(401).json({ ok: false });
    const { ip, field, value } = req.body;
    
    let blacklist = await redisGet('blacklist', []);
    let rule = blacklist.find(r => r.ip === ip);
    if (!rule) {
        rule = { ip, blocked: false, whitelist: false };
        blacklist.push(rule);
    }
    rule[field] = value;
    if (value) rule[field === 'blocked' ? 'whitelist' : 'blocked'] = false;
    
    blacklist = blacklist.filter(r => r.blocked || r.whitelist);
    await redisSet('blacklist', blacklist);
    res.json({ ok: true });
});

app.post('/admin/api/config', async (req, res) => {
    if (!authTokens.has(req.body.token)) return res.status(401).json({ ok: false });
    const { whitelist_mode, redirect_url } = req.body;
    
    let config = await redisGet('config', { whitelist_mode: false, redirect_url: '' });
    if (whitelist_mode !== undefined) config.whitelist_mode = whitelist_mode;
    if (redirect_url !== undefined) config.redirect_url = redirect_url;
    
    await redisSet('config', config);
    res.json({ ok: true });
});

app.post('/admin/api/delete', async (req, res) => {
    if (!authTokens.has(req.body.token)) return res.status(401).json({ ok: false });
    if (req.body.all) {
        if (redisStore) await redisStore.del('logs');
        else await fsp.writeFile(LOG_FILE, '', 'utf8');
    }
    res.json({ ok: true });
});

app.post('/admin/api/delete-selected', async (req, res) => {
    if (!authTokens.has(req.body.token)) return res.status(401).json({ ok: false });
    const { indices } = req.body;
    if (!Array.isArray(indices)) return res.status(400).json({ ok: false });

    try {
        const setIndices = new Set(indices.map(Number));
        if (redisStore) {
            const lines = await redisStore.lRange('logs', 0, -1);
            const kept = lines.filter((_, i) => !setIndices.has(i));
            await redisStore.del('logs');
            if (kept.length > 0) await redisStore.rPush('logs', ...kept);
        } else {
            const data = await fsp.readFile(LOG_FILE, 'utf8');
            let lines = data.trim().split('\n');
            lines = lines.filter((_, i) => !setIndices.has(i));
            await fsp.writeFile(LOG_FILE, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
        }
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false });
    }
});

app.post('/admin/api/save-notes', async (req, res) => {
    if (!authTokens.has(req.body.token)) return res.status(401).json({ ok: false });
    const { notes } = req.body; // Map IP -> Note
    if (!notes) return res.status(400).json({ ok: false });

    let current = await redisGet('notes', {});
    Object.assign(current, notes);
    await redisSet('notes', current);
    res.json({ ok: true });
});



// 404 catch-all
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});


io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for']
    ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim()
    : socket.handshake.address;

  // Check blacklist async
  redisGet('blacklist', []).then(blacklist => {
    if (blacklist.find(r => r.ip === clientIp && r.blocked)) {
      socket.emit('mod-action', 'banned');
      socket.disconnect(true);
    }
  }).catch(() => {});
  log(`[Socket] New connection: ${socket.id}`);


  socket.on('join-room', async (roomId) => {
    if (typeof roomId !== 'string' || roomId.length === 0 || roomId.length > 100) return;
    roomId = roomId.replace(/[^a-z0-9\-_]/gi, '').toLowerCase();
    if (!roomId) return;

    // Guard: if already in this room, don't re-announce
    if (socket.data.roomId === roomId) return;

    // Leave previous room if any
    if (socket.data.roomId) {
        socket.leave(socket.data.roomId);
        socket.to(socket.data.roomId).emit('user-disconnected', socket.id);
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    log(`[Socket] User ${socket.id} joined room: ${roomId}`);
    socket.to(roomId).emit('user-connected', socket.id);

    // Check if user has URL-based profile and apply it
    const realIp = socket.handshake.headers['x-forwarded-for']
        ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim()
        : socket.handshake.address;
    
    try {
        const extras = await redisGet('extras', {});
        if (extras[realIp]) {
            const urlPseudo = extras[realIp].url_pseudo;
            const urlColor = extras[realIp].url_color;
            
            if (urlPseudo || urlColor) {
                const profile = socket.data.profile || {};
                if (urlPseudo && !profile.displayName) {
                    profile.displayName = urlPseudo;
                }
                if (urlColor && !profile.profileColor) {
                    profile.profileColor = urlColor;
                }
                
                if (Object.keys(profile).length > 0) {
                    socket.data.profile = profile;
                    socket.emit('profile-update', profile);
                    socket.to(roomId).emit('profile-update', {
                        id: socket.id,
                        displayName: profile.displayName,
                        profileColor: profile.profileColor
                    });
                    log(`[Socket] Applied URL profile for ${socket.id}: ${profile.displayName}`);
                }
            }
        }
    } catch (err) {
        log('Error applying URL profile:', err);
    }

    // Notify new joiner of any existing mods in room
    try {
        const allSockets = await io.in(roomId).fetchSockets();
        for (const s of allSockets) {
            if (s.id !== socket.id && s.data.isMod) {
                socket.emit('mod-badge', { id: s.id });
            }
        }
    } catch(e) {}

    // FIX: broadcast profile to room immediately after joining
    if (socket.data.profile) {
        socket.to(roomId).emit('profile-update', {
            id: socket.id,
            displayName: socket.data.profile.displayName,
            profileColor: socket.data.profile.profileColor
        });
    }

    try {
        const sockets = await io.in(roomId).fetchSockets();
        const roomProfiles = {};
        for (const remoteSocket of sockets) {
            if (remoteSocket.id === socket.id) continue;
            // Include all peers, even those without profile yet (placeholder)
            roomProfiles[remoteSocket.id] = remoteSocket.data.profile || null;
        }
        socket.emit('sync-profiles', roomProfiles);
    } catch (err) {
        log('Error fetching sockets:', err);
    }
  });

  socket.on('profile-update', (data) => {
    if (!data || typeof data.displayName !== 'string' || typeof data.profileColor !== 'string') return;

    data.displayName = data.displayName.substring(0, 50);
    if (!/^#[0-9a-fA-F]{6}$/.test(data.profileColor)) return;

    // FIX: Store profile even before join-room so sync-profiles has fresh data
    socket.data.profile = {
        displayName: data.displayName,
        profileColor: data.profileColor
    };

    // Only relay to room if already joined
    const actualRoom = socket.data.roomId;
    if (!actualRoom) return;

    log(`[Socket] Profile update for ${socket.id} in ${actualRoom}`);
    socket.to(actualRoom).emit('profile-update', {
        id: socket.id,
        displayName: data.displayName,
        profileColor: data.profileColor
    });

    // Update pseudo in logs and extras
    const realIp = socket.handshake.headers['x-forwarded-for']
        ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim()
        : socket.handshake.address;
    // Also update pseudo in extras.json
    (async () => {
        try {
            const extras = await redisGet('extras', {});
            if (extras[realIp]) {
                const existing = extras[realIp].pseudos ? extras[realIp].pseudos.split(', ') : [];
                if (!existing.includes(data.displayName)) existing.push(data.displayName);
                extras[realIp].pseudos = existing.join(', ');
                await redisSet('extras', extras);
            }
        } catch(e) {}
    })();
    (async () => {
        try {
            const logData = await fsp.readFile(LOG_FILE, 'utf8');
            const lines = logData.split('\n');
            const updated = lines.map(line => {
                if (line.includes(`IP: ${realIp}`)) {
                    // Update pseudo field (between 5th and 6th pipe)
                    const parts = line.split(' | ');
                    if (parts.length >= 5) {
                        const names = socket.data.pseudos || new Set();
                        names.add(data.displayName);
                        socket.data.pseudos = names;
                        // Deduplicate pseudos
                        parts[4] = Array.from(new Set(Array.from(names))).join(', ');
                        return parts.join(' | ');
                    }
                }
                return line;
            });
            await fsp.writeFile(LOG_FILE, updated.join('\n'), 'utf8');
        } catch (e) {}
    })();
  });

  socket.on('peer-speaking', (data) => {
    if (!data || typeof data.status !== 'boolean') return;
    const actualRoom = socket.data.roomId;
    if (!actualRoom) return;
    socket.to(actualRoom).emit('peer-speaking', {
        id: socket.id,
        status: data.status
    });
  });

  // FIX: relay video-status to room peers
  socket.on('video-status', (data) => {
    if (!data || typeof data.enabled !== 'boolean') return;
    const actualRoom = socket.data.roomId;
    if (!actualRoom) return;
    socket.to(actualRoom).emit('video-status', {
      id: socket.id,
      enabled: data.enabled
    });
  });

  socket.on('chat-message', (data) => {
    if (!data || typeof data.message !== 'string' || typeof data.userName !== 'string') return;
    if (socket.data.isMuted) return;
    const actualRoom = socket.data.roomId;
    if (!actualRoom) return;

    data.message = data.message.substring(0, 2000);
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : '#4A90E2';
    io.to(actualRoom).emit('chat-message', {
      id: socket.id,
      userName: data.userName.substring(0, 50),
      message: data.message,
      color: safeColor
    });
  });

  socket.on('signal', (data) => {
    if (!data || typeof data.to !== 'string' || !data.signal) return;
    const senderRoom = socket.data.roomId;
    if (!senderRoom) return;
    // Best-effort local room check (works single instance + Redis single node)
    const targetSocket = io.sockets.sockets.get(data.to);
    if (targetSocket && targetSocket.data.roomId !== senderRoom) return;
    log(`[Socket] Signal from ${socket.id} to ${data.to} (${data.signal.type || 'ICE'})`);
    io.to(data.to).emit('signal', { from: socket.id, signal: data.signal });
  });

  socket.on('mod-auth', (data) => {
    // Support both old string format and new object format
    const password = typeof data === 'object' ? data.password : data;
    const displayName = typeof data === 'object' ? data.displayName : null;
    if (password === MOD_PASSWORD) {
      socket.data.isMod = true;
      // Store mod display name directly in case profile isn't set yet
      if (displayName) socket.data.modName = displayName;
      socket.emit('mod-status', true);
      log(`[Socket] User ${socket.id} authenticated as Moderator`);
      
      // Sync existing users in the room for moderation
      const roomId = socket.data.roomId;
      if (roomId) {
        setTimeout(async () => {
          try {
            const sockets = await io.in(roomId).fetchSockets();
            sockets.forEach(s => {
              if (s.id !== socket.id) {
                socket.emit('user-connected', s.id);
                if (s.data.profile) {
                  socket.emit('profile-update', {
                    id: s.id,
                    displayName: s.data.profile.displayName,
                    profileColor: s.data.profile.profileColor
                  });
                }
              }
            });
          } catch (err) {
            log('Error syncing existing users for moderator:', err);
          }
        }, 100);
      }
    } else {
      socket.emit('mod-status', false);
    }
  });

  socket.on('mod-kick', (targetId) => {
    if (!socket.data.isMod) return;
    const modName = 'OvO';
    io.to(targetId).emit('mod-action', { type: 'kicked', by: modName });
    setTimeout(() => io.in(targetId).disconnectSockets(true), 500);
    log(`[Socket] Moderator ${socket.id} kicked ${targetId}`);
  });

  socket.on('mod-kick-temp', (targetId) => {
    if (!socket.data.isMod) return;
    const modName = 'OvO';
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      const targetIp = targetSocket.handshake.headers['x-forwarded-for']
        ? targetSocket.handshake.headers['x-forwarded-for'].split(',')[0].trim()
        : targetSocket.handshake.address;
      bannedIps.add(targetIp);
      setTimeout(() => bannedIps.delete(targetIp), 30000);
    }
    io.to(targetId).emit('mod-action', { type: 'kicked-temp', by: modName });
    setTimeout(() => io.in(targetId).disconnectSockets(true), 500);
    log(`[Socket] Moderator ${socket.id} temp-kicked ${targetId} for 30s`);
  });

  socket.on('mod-ban', async (targetId) => {
    if (!socket.data.isMod) return;
    const modName = 'OvO';
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      const targetIp = targetSocket.handshake.headers['x-forwarded-for']
        ? targetSocket.handshake.headers['x-forwarded-for'].split(',')[0].trim()
        : targetSocket.handshake.address;
      
      const blacklist = await redisGet('blacklist', []);
      if (!blacklist.find(r => r.ip === targetIp)) {
          blacklist.push({ ip: targetIp, blocked: true, whitelist: false });
          await redisSet('blacklist', blacklist);
      }
      log(`[Socket] Moderator ${socket.id} banned IP ${targetIp} (User ${targetId})`);
    }
    io.to(targetId).emit('mod-action', { type: 'banned', by: modName });
    setTimeout(() => io.in(targetId).disconnectSockets(true), 500);
  });



  socket.on('mod-mute', (targetId) => {
    if (!socket.data.isMod) return;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.data.isMuted = true;
    io.to(targetId).emit('mod-action', { type: 'muted', by: 'OvO' });
    log(`[Socket] Moderator ${socket.id} muted ${targetId}`);
  });

  socket.on('mod-unmute', (targetId) => {
    if (!socket.data.isMod) return;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.data.isMuted = false;
    io.to(targetId).emit('mod-action', { type: 'unmuted', by: 'OvO' });
    log(`[Socket] Moderator ${socket.id} unmuted ${targetId}`);
  });

  socket.on('url-identity', async (data) => {
    if (!data || !data.pseudo) return;
    const realIp = socket.handshake.headers['x-forwarded-for']
        ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim()
        : socket.handshake.address;
    try {
        const extras = await redisGet('extras', {});
        if (!extras[realIp]) extras[realIp] = {};
        const existing = extras[realIp].pseudos ? extras[realIp].pseudos.split(', ') : [];
        if (!existing.includes(data.pseudo)) existing.push(data.pseudo);
        extras[realIp].pseudos = [...new Set(existing)].join(', ');
        extras[realIp].url_pseudo = data.pseudo;
        if (data.color) extras[realIp].url_color = data.color;
        await redisSet('extras', extras);
    } catch(e) {}
  });

  socket.on('mod-badge', (data) => {
    const actualRoom = socket.data.roomId;
    if (!actualRoom || !socket.data.isMod) return;
    socket.to(actualRoom).emit('mod-badge', { id: socket.id });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      log(`[Socket] User ${socket.id} disconnected from room: ${roomId}`);
      socket.to(roomId).emit('user-disconnected', socket.id);
    }
  });
});

server.listen(PORT, () => {
  log(`Server ready at http://localhost:${PORT}`);
});
