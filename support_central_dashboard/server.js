// =============================================================
// Support Central Dashboard — Server
// Express + Socket.IO backend for managing support requests
// =============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.json());

// CORS middleware — allow requests from client add-ons on different origins
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- In-memory store ----------
const requests = new Map();
const chatHistory = new Map(); // requestId -> [messages]

// ---------- Configuration endpoint ----------
app.get('/api/config', (req, res) => {
  res.json({
    asterisk_ws_url: process.env.ASTERISK_WS_URL || 'wss://localhost:8089/ws',
    sip_username: process.env.SIP_USERNAME || 'agent',
    sip_password: process.env.SIP_PASSWORD || 'changeme_agent',
    sip_domain: process.env.SIP_DOMAIN || 'localhost'
  });
});

// ---------- REST API ----------

// Receive a new support request (from client add-on)
app.post('/api/request', (req, res) => {
  const { site_name, type, message, sip_extension, caller_id } = req.body;
  const id = uuidv4();
  const request = {
    id,
    site_name: site_name || 'Unknown Site',
    type: type || 'text', // 'text' or 'call'
    message: message || '',
    sip_extension: sip_extension || '',
    caller_id: caller_id || '',
    status: 'pending',
    created_at: new Date().toISOString()
  };

  requests.set(id, request);
  chatHistory.set(id, []);

  if (message) {
    chatHistory.get(id).push({
      sender: 'client',
      site_name: request.site_name,
      text: message,
      timestamp: new Date().toISOString()
    });
  }

  // Notify all connected dashboard clients
  io.emit('new-request', request);

  console.log(`[NEW REQUEST] ${request.type} from ${request.site_name} (${id})`);
  res.json({ success: true, request_id: id, request });
});

// List all requests
app.get('/api/requests', (req, res) => {
  const all = Array.from(requests.values()).sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
  res.json(all);
});

// Get chat history for a request
app.get('/api/chat/:requestId', (req, res) => {
  const history = chatHistory.get(req.params.requestId) || [];
  res.json(history);
});

// Update request status
app.patch('/api/request/:requestId', (req, res) => {
  const request = requests.get(req.params.requestId);
  if (!request) return res.status(404).json({ error: 'Not found' });

  if (req.body.status) request.status = req.body.status;
  requests.set(req.params.requestId, request);

  io.emit('request-updated', request);
  res.json(request);
});

// ---------- Socket.IO ----------

io.on('connection', (socket) => {
  console.log(`[SOCKET] Client connected: ${socket.id}`);

  // Identify the socket (agent or client site)
  socket.on('identify', (data) => {
    socket.data.role = data.role; // 'agent' or 'client'
    socket.data.site_name = data.site_name || 'Agent';
    socket.data.request_id = data.request_id || null;

    if (data.request_id) {
      socket.join(`request:${data.request_id}`);
    }

    console.log(`[SOCKET] Identified: ${data.role} — ${data.site_name}`);
  });

  // Join a specific request room
  socket.on('join-request', (requestId) => {
    socket.join(`request:${requestId}`);
    socket.data.request_id = requestId;
  });

  // Chat message
  socket.on('chat-message', (data) => {
    const { request_id, text, sender, site_name } = data;
    const msg = {
      sender: sender || socket.data.role || 'unknown',
      site_name: site_name || socket.data.site_name || 'Unknown',
      text,
      timestamp: new Date().toISOString()
    };

    // Store in history
    if (!chatHistory.has(request_id)) chatHistory.set(request_id, []);
    chatHistory.get(request_id).push(msg);

    // Broadcast to the request room
    io.to(`request:${request_id}`).emit('chat-message', {
      request_id,
      ...msg
    });

    // Also broadcast globally so the dashboard sees it
    io.emit('chat-activity', { request_id, ...msg });

    console.log(`[CHAT] ${msg.sender}@${msg.site_name}: ${text}`);
  });

  // Call notification (client is initiating a call)
  socket.on('call-initiated', (data) => {
    io.emit('incoming-call', {
      request_id: data.request_id,
      site_name: data.site_name,
      sip_extension: data.sip_extension,
      caller_id: data.caller_id,
      timestamp: new Date().toISOString()
    });
    console.log(`[CALL] Incoming call from ${data.site_name}`);
  });

  socket.on('disconnect', () => {
    console.log(`[SOCKET] Disconnected: ${socket.id}`);
  });
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[CENTRAL] Support Dashboard running on port ${PORT}`);
  console.log("Using manual config:", {
    asterisk_ws_url: process.env.ASTERISK_WS_URL || 'wss://localhost:8089/ws',
    sip_username: process.env.SIP_USERNAME || 'agent',
    sip_password: '****',
    sip_domain: process.env.SIP_DOMAIN || 'localhost'
  });
});
