# Chatlet Clone - Production Ready Video Chat 🚀🌐

A pixel-perfect, highly scalable clone of the **Chatlet.com** video platform. Built with Node.js, Socket.io, and WebRTC Mesh architecture, designed for production environments and high performance.

## ✨ Features

- **1:1 UI/UX Replication**: Accurate CSS/HTML structure, including the iconic avatar system and rounded white buttons.
- **WebRTC Mesh Connection**: Peer-to-peer video/audio streams for minimal latency and maximum privacy.
- **Production-Ready Security**:
    - **Helmet.js** protection.
    - **DDoS/Rate Limiting** prevention.
    - **Secure ICE Config**: Dynamic STUN/TURN fetching via backend (hides private TURN credentials).
- **Infinite Scalability (Redis)**: Automatic support for multiple Node.js server clusters via Redis Adapter.
- **Picture-in-Picture (PiP)**: Detachable central video for multitasking.
- **Real-time Chat**: Message system with per-user color coding and audio notifications (`all-eyes-on-me.mp3`).
- **Dynamic Avatars**: Miniature and Featured views that stay in sync, hiding duplicates.

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3.
- **Backend**: Node.js, Express.
- **Communication**: Socket.io (Signaling), WebRTC (P2P Mesh).
- **Scaling**: Redis Adapter (Automatic failover to local if Redis is not available).

## 🚀 Getting Started

### Local Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000` in your browser.

### Deployment Configuration (Optional)
To ensure 100% connectivity behind firewalls (Corporate NATs), configure these Environment Variables on your hosting provider:
- `TURN_URL`: Your TURN server URL (e.g., Twilio, Metered).
- `TURN_USERNAME`: TURN user.
- `TURN_CREDENTIAL`: TURN password.
- `REDIS_URL`: For horizontal scaling across multiple servers.
- `PORT`: Default is 3000.

## ⚖️ License
[MIT License](LICENSE) - Free to use and modify for personal or commercial projects.
