// =============================================================
// Support Central Dashboard — Client App
// Socket.IO for real-time chat
// =============================================================

(function () {
  'use strict';

  // ---------- State ----------
  const state = {
    requests: [],
    activeRequestId: null,
    config: {}
  };

  // ---------- DOM Elements ----------
  const $ = (sel) => document.querySelector(sel);

  const els = {
    requestsList: $('#requests-list'),
    noRequests: $('#no-requests'),
    requestCount: $('#request-count'),
    detailEmpty: $('#detail-empty'),
    detailContent: $('#detail-content'),
    detailSiteName: $('#detail-site-name'),
    detailTypeBadge: $('#detail-type-badge'),
    detailTime: $('#detail-time'),
    chatMessages: $('#chat-messages'),
    chatInput: $('#chat-input'),
    btnSend: $('#btn-send'),
    btnResolve: $('#btn-resolve'),
    connectionStatus: $('#connection-status'),
    toastContainer: $('#toast-container')
  };

  // ---------- Socket.IO ----------
  const socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    updateConnectionStatus(true);
    socket.emit('identify', { role: 'agent', site_name: 'Support Agent' });
    loadRequests();
    loadConfig(); // Fetch config for SIP
  });

  // ---------- Load Configuration & SIP ----------
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      state.config = await res.json();
      initSIP();
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  }

  function initSIP() {
    if (!state.config.asterisk_ws_url || !state.config.sip_username) {
      console.warn('SIP config missing, skipping registration');
      return;
    }

    console.log('Initializing JsSIP...');
    const socketInterface = new JsSIP.WebSocketInterface(state.config.asterisk_ws_url);
    
    const ua = new JsSIP.UA({
      sockets: [socketInterface],
      uri: `sip:${state.config.sip_username}@${state.config.sip_domain}`,
      password: state.config.sip_password,
      session_timers: false
    });

    ua.on('registered', () => {
      console.log("SIP Registered");
      setStatus("Online");
    });

    ua.on('registrationFailed', (e) => {
      console.error("Registration failed:", e);
      setStatus("Offline");
    });

    ua.on('disconnected', () => {
      setStatus("Offline");
    });

    ua.start();
  }

  function setStatus(status) {
    const textEl = document.querySelector('.status-text');
    if (textEl) textEl.textContent = status;
    
    const badge = els.connectionStatus;
    if (badge) {
      badge.className = `status-badge ${status === 'Online' ? 'connected' : 'disconnected'}`;
    }
  }

  socket.on('disconnect', () => {
    updateConnectionStatus(false);
  });

  socket.on('new-request', (request) => {
    state.requests.unshift(request);
    renderRequestsList();
    showToast('info', `New request from ${request.site_name}`, 'chat');
  });

  socket.on('chat-message', (data) => {
    if (data.request_id === state.activeRequestId && data.sender !== 'agent') {
      appendChatMessage(data);
    }
  });

  socket.on('chat-activity', (data) => {
    const card = document.querySelector(`[data-request-id="${data.request_id}"]`);
    if (card) {
      const preview = card.querySelector('.request-preview');
      if (preview) preview.textContent = data.text;
      if (data.request_id !== state.activeRequestId) {
        card.classList.add('unread');
      }
    }
  });

  socket.on('request-updated', (request) => {
    const idx = state.requests.findIndex(r => r.id === request.id);
    if (idx !== -1) state.requests[idx] = request;
    renderRequestsList();
  });

  // ---------- Load Requests ----------
  async function loadRequests() {
    try {
      const res = await fetch('/api/requests');
      state.requests = await res.json();
      renderRequestsList();
    } catch (e) {
      console.error('Failed to load requests:', e);
    }
  }

  // ---------- Render Requests List ----------
  function renderRequestsList() {
    els.requestCount.textContent = state.requests.length;

    if (state.requests.length === 0) {
      els.noRequests.classList.remove('hidden');
      return;
    }

    els.noRequests.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    state.requests.forEach((req) => {
      const card = document.createElement('div');
      card.className = `request-card${req.id === state.activeRequestId ? ' active' : ''}`;
      card.dataset.requestId = req.id;

      const time = formatTime(req.created_at);

      card.innerHTML = `
        <div class="request-icon text">
          <span class="material-icons-round">chat</span>
        </div>
        <div class="request-info">
          <div class="site-name">${escapeHtml(req.site_name)}</div>
          <div class="request-preview">${escapeHtml(req.message || 'Support request')}</div>
        </div>
        <div class="request-meta">
          <span class="request-time">${time}</span>
          <span class="type-badge ${req.status === 'resolved' ? 'resolved' : 'text'}">${req.status === 'resolved' ? 'Resolved' : 'TEXT'}</span>
        </div>
      `;

      card.addEventListener('click', () => selectRequest(req.id));
      fragment.appendChild(card);
    });

    const children = Array.from(els.requestsList.children);
    children.forEach(c => {
      if (c.id !== 'no-requests') c.remove();
    });
    els.requestsList.appendChild(fragment);
  }

  // ---------- Select Request ----------
  async function selectRequest(requestId) {
    state.activeRequestId = requestId;
    const req = state.requests.find(r => r.id === requestId);
    if (!req) return;

    document.querySelectorAll('.request-card').forEach(c => c.classList.remove('active'));
    const activeCard = document.querySelector(`[data-request-id="${requestId}"]`);
    if (activeCard) {
      activeCard.classList.add('active');
      activeCard.classList.remove('unread');
    }

    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailSiteName.textContent = req.site_name;
    els.detailTypeBadge.textContent = 'TEXT';
    els.detailTypeBadge.className = 'type-badge text';
    els.detailTime.textContent = new Date(req.created_at).toLocaleString();

    socket.emit('join-request', requestId);

    try {
      const res = await fetch(`/api/chat/${requestId}`);
      const messages = await res.json();
      els.chatMessages.innerHTML = '';
      messages.forEach(appendChatMessage);
      scrollChatToBottom();
    } catch (e) {
      console.error('Failed to load chat:', e);
    }
  }

  // ---------- Chat ----------
  function appendChatMessage(msg) {
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.sender === 'agent' ? 'agent' : 'client'}`;
    div.innerHTML = `
      <div class="msg-sender">${escapeHtml(msg.sender === 'agent' ? 'You' : msg.site_name || 'Client')}</div>
      <div class="msg-text">${escapeHtml(msg.text)}</div>
      <div class="msg-time">${formatTime(msg.timestamp)}</div>
    `;
    els.chatMessages.appendChild(div);
    scrollChatToBottom();
  }

  function sendChatMessage() {
    const text = els.chatInput.value.trim();
    if (!text || !state.activeRequestId) return;

    socket.emit('chat-message', {
      request_id: state.activeRequestId,
      text,
      sender: 'agent',
      site_name: 'Support Agent'
    });

    appendChatMessage({
      sender: 'agent',
      site_name: 'Support Agent',
      text,
      timestamp: new Date().toISOString()
    });

    els.chatInput.value = '';
  }

  els.btnSend.addEventListener('click', sendChatMessage);
  els.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  // ---------- Resolve ----------
  els.btnResolve.addEventListener('click', async () => {
    if (!state.activeRequestId) return;
    try {
      await fetch(`/api/request/${state.activeRequestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' })
      });
      showToast('success', 'Request resolved', 'check_circle');
    } catch (e) {
      console.error('Failed to resolve:', e);
    }
  });

  // ---------- Status Updates ----------
  function updateConnectionStatus(connected) {
    const badge = els.connectionStatus;
    if (badge) {
        badge.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
        badge.querySelector('.status-text').textContent = connected ? 'Connected' : 'Offline';
    }
  }

  // ---------- Toast Notifications ----------
  function showToast(type, message, icon) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="material-icons-round">${icon || 'info'}</span>
      <span>${escapeHtml(message)}</span>
    `;
    els.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // ---------- Helpers ----------
  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString();
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function scrollChatToBottom() {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

})();
