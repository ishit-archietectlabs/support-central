// =============================================================
// Support Central Dashboard — Client App
// Socket.IO for real-time + JsSIP WebRTC softphone
// =============================================================

(function () {
  'use strict';

  // ---------- State ----------
  const state = {
    requests: [],
    activeRequestId: null,
    sipRegistered: false,
    currentSession: null,
    isMuted: false,
    callTimer: null,
    callSeconds: 0,
    config: {},
    ua: null
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
    sipStatus: $('#sip-status'),
    phoneIdleState: $('#phone-idle-state'),
    phoneRingingState: $('#phone-ringing-state'),
    phoneActiveState: $('#phone-active-state'),
    callerName: $('#caller-name'),
    callerExtension: $('#caller-extension'),
    activCallerName: $('#active-caller-name'),
    callTimerEl: $('#call-timer'),
    btnAnswer: $('#btn-answer'),
    btnReject: $('#btn-reject'),
    btnMute: $('#btn-mute'),
    btnHangup: $('#btn-hangup'),
    callOverlay: $('#call-overlay'),
    overlayAnswer: $('#overlay-answer'),
    overlayReject: $('#overlay-reject'),
    overlayCaller: $('#overlay-caller'),
    overlaySite: $('#overlay-site'),
    phoneStatusIndicator: $('#phone-status-indicator'),
    callLogList: $('#call-log-list'),
    toastContainer: $('#toast-container'),
    remoteAudio: $('#remote-audio')
  };

  // ---------- Socket.IO ----------
  const socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    updateConnectionStatus(true);
    socket.emit('identify', { role: 'agent', site_name: 'Support Agent' });
    loadRequests();
  });

  socket.on('disconnect', () => {
    updateConnectionStatus(false);
  });

  socket.on('new-request', (request) => {
    state.requests.unshift(request);
    renderRequestsList();
    showToast(
      request.type === 'call' ? 'call' : 'info',
      `New ${request.type} request from ${request.site_name}`,
      request.type === 'call' ? 'ring_volume' : 'chat'
    );
    playNotificationSound();
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

  socket.on('incoming-call', (data) => {
    showIncomingCall(data);
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

  // ---------- Load Config + Init SIP ----------
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      state.config = await res.json();
      initSIP();
    } catch (e) {
      console.error('Failed to load config:', e);
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

      const iconClass = req.type === 'call' ? 'call' : 'text';
      const iconName = req.type === 'call' ? 'call' : 'chat';
      const statusBadge = req.status === 'resolved' ? 'resolved' : iconClass;
      const time = formatTime(req.created_at);

      card.innerHTML = `
        <div class="request-icon ${iconClass}">
          <span class="material-icons-round">${iconName}</span>
        </div>
        <div class="request-info">
          <div class="site-name">${escapeHtml(req.site_name)}</div>
          <div class="request-preview">${escapeHtml(req.message || (req.type === 'call' ? 'Voice call request' : 'Text support request'))}</div>
        </div>
        <div class="request-meta">
          <span class="request-time">${time}</span>
          <span class="type-badge ${statusBadge}">${req.status === 'resolved' ? 'Resolved' : req.type.toUpperCase()}</span>
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
    els.detailTypeBadge.textContent = req.type.toUpperCase();
    els.detailTypeBadge.className = `type-badge ${req.type === 'call' ? 'call' : 'text'}`;
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

  // ---------- JsSIP WebRTC Phone ----------
  function initSIP() {
    const { asterisk_ws_url, sip_username, sip_password, sip_domain } = state.config;

    if (!asterisk_ws_url || !sip_username) {
      console.warn('[SIP] Missing config, skipping SIP init');
      return;
    }

    try {
      const socketJsSIP = new JsSIP.WebSocketInterface(asterisk_ws_url);

      const configuration = {
        sockets: [socketJsSIP],
        uri: `sip:${sip_username}@${sip_domain}`,
        password: sip_password,
        display_name: 'Support Agent',
        register: true,
        session_timers: false
      };

      state.ua = new JsSIP.UA(configuration);

      state.ua.on('registered', () => {
        updateSipStatus(true);
        console.log('[SIP] Registered');
      });

      state.ua.on('unregistered', () => {
        updateSipStatus(false);
        console.log('[SIP] Unregistered');
      });

      state.ua.on('registrationFailed', (e) => {
        updateSipStatus(false);
        console.error('[SIP] Registration failed:', e.cause);
      });

      state.ua.on('newRTCSession', (e) => {
        if (e.originator === 'remote') {
          handleIncomingSIPCall(e.session);
        }
      });

      state.ua.on('connected', () => {
        console.log('[SIP] WebSocket connected');
      });

      state.ua.on('disconnected', () => {
        console.log('[SIP] WebSocket disconnected');
        updateSipStatus(false);
      });

      state.ua.start();

    } catch (e) {
      console.error('[SIP] Init error:', e);
    }
  }

  function handleIncomingSIPCall(session) {
    console.log('[SIP] Incoming call');

    state.currentSession = session;

    const callerDisplay = session.remote_identity.display_name || session.remote_identity.uri.user || 'Unknown';
    const callerURI = session.remote_identity.uri.user || '';

    showIncomingCall({
      site_name: callerDisplay,
      sip_extension: callerURI,
      caller_id: callerDisplay
    });

    session.on('ended', () => endCall());
    session.on('failed', () => endCall());

    session.on('confirmed', () => {
      console.log('[SIP] Call confirmed / answered');
      showActiveCall();
    });
  }

  function answerCall() {
    if (!state.currentSession) return;

    const options = {
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      }
    };

    state.currentSession.answer(options);
    showActiveCall();
    setupRemoteAudio(state.currentSession);
  }

  function rejectCall() {
    if (state.currentSession) {
      try { state.currentSession.terminate(); } catch (e) {}
    }
    endCall();
    addCallLogEntry('Declined', false);
  }

  function hangupCall() {
    if (state.currentSession) {
      try { state.currentSession.terminate(); } catch (e) {}
    }
    endCall();
  }

  function toggleMute() {
    if (!state.currentSession) return;
    state.isMuted = !state.isMuted;

    if (state.isMuted) {
      state.currentSession.mute({ audio: true });
    } else {
      state.currentSession.unmute({ audio: true });
    }

    els.btnMute.classList.toggle('muted', state.isMuted);
    const icon = els.btnMute.querySelector('.material-icons-round');
    icon.textContent = state.isMuted ? 'mic_off' : 'mic';
  }

  function setupRemoteAudio(session) {
    session.on('peerconnection', (e) => {
      const pc = e.peerconnection;
      pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
          const stream = new MediaStream([event.track]);
          els.remoteAudio.srcObject = stream;
          els.remoteAudio.play().catch(() => {});
        }
      };
    });

    // Also check if connection already exists
    if (session.connection) {
      session.connection.ontrack = (event) => {
        if (event.track.kind === 'audio') {
          const stream = new MediaStream([event.track]);
          els.remoteAudio.srcObject = stream;
          els.remoteAudio.play().catch(() => {});
        }
      };

      // Check existing receivers
      try {
        session.connection.getReceivers().forEach(receiver => {
          if (receiver.track && receiver.track.kind === 'audio') {
            const stream = new MediaStream([receiver.track]);
            els.remoteAudio.srcObject = stream;
            els.remoteAudio.play().catch(() => {});
          }
        });
      } catch (e) {}
    }
  }

  // ---------- Call UI State Management ----------
  function showIncomingCall(data) {
    els.callerName.textContent = data.site_name || 'Unknown Caller';
    els.callerExtension.textContent = data.sip_extension ? `Extension: ${data.sip_extension}` : '';
    els.overlayCaller.textContent = data.site_name || 'Incoming Call';
    els.overlaySite.textContent = data.sip_extension ? `Extension: ${data.sip_extension}` : 'Support Call';

    els.phoneIdleState.classList.add('hidden');
    els.phoneRingingState.classList.remove('hidden');
    els.phoneActiveState.classList.add('hidden');
    els.callOverlay.classList.remove('hidden');

    els.phoneStatusIndicator.textContent = 'ring_volume';
    els.phoneStatusIndicator.className = 'material-icons-round phone-ringing';

    playRingtone();
  }

  function showActiveCall() {
    const callerText = els.callerName.textContent;
    els.activCallerName.textContent = callerText;

    els.phoneIdleState.classList.add('hidden');
    els.phoneRingingState.classList.add('hidden');
    els.phoneActiveState.classList.remove('hidden');
    els.callOverlay.classList.add('hidden');

    els.phoneStatusIndicator.textContent = 'call';
    els.phoneStatusIndicator.className = 'material-icons-round phone-active';

    stopRingtone();
    startCallTimer();
    addCallLogEntry(callerText, true);
  }

  function endCall() {
    state.currentSession = null;
    state.isMuted = false;

    els.phoneIdleState.classList.remove('hidden');
    els.phoneRingingState.classList.add('hidden');
    els.phoneActiveState.classList.add('hidden');
    els.callOverlay.classList.add('hidden');

    els.phoneStatusIndicator.textContent = 'phone_disabled';
    els.phoneStatusIndicator.className = 'material-icons-round phone-idle';

    els.btnMute.classList.remove('muted');
    els.btnMute.querySelector('.material-icons-round').textContent = 'mic';

    stopRingtone();
    stopCallTimer();

    if (els.remoteAudio.srcObject) {
      els.remoteAudio.srcObject = null;
    }
  }

  // ---------- Call Timer ----------
  function startCallTimer() {
    state.callSeconds = 0;
    els.callTimerEl.textContent = '00:00';
    state.callTimer = setInterval(() => {
      state.callSeconds++;
      const m = Math.floor(state.callSeconds / 60).toString().padStart(2, '0');
      const s = (state.callSeconds % 60).toString().padStart(2, '0');
      els.callTimerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopCallTimer() {
    if (state.callTimer) {
      clearInterval(state.callTimer);
      state.callTimer = null;
    }
  }

  // ---------- Call Log ----------
  function addCallLogEntry(name, answered) {
    const emptyP = els.callLogList.querySelector('.empty-sub');
    if (emptyP) emptyP.remove();

    const entry = document.createElement('div');
    entry.className = `call-log-entry ${answered ? 'incoming' : 'missed'}`;
    entry.innerHTML = `
      <span class="material-icons-round">${answered ? 'call_received' : 'call_missed'}</span>
      <span class="log-name">${escapeHtml(name)}</span>
      <span class="log-time">${formatTime(new Date().toISOString())}</span>
    `;
    els.callLogList.prepend(entry);
  }

  // ---------- Ringtone ----------
  function playRingtone() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 440;
      gain.gain.value = 0.1;
      osc.start();

      window._ringtoneCtx = ctx;
      window._ringtoneOsc = osc;

      const pulseGain = () => {
        if (!window._ringtoneCtx) return;
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        setTimeout(() => {
          if (!window._ringtoneCtx) return;
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        }, 700);
        window._ringtoneTimer = setTimeout(pulseGain, 2000);
      };
      pulseGain();
    } catch (e) {}
  }

  function stopRingtone() {
    if (window._ringtoneOsc) {
      try { window._ringtoneOsc.stop(); } catch (e) {}
      window._ringtoneOsc = null;
    }
    if (window._ringtoneCtx) {
      try { window._ringtoneCtx.close(); } catch(e) {}
      window._ringtoneCtx = null;
    }
    if (window._ringtoneTimer) {
      clearTimeout(window._ringtoneTimer);
      window._ringtoneTimer = null;
    }
  }

  function playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  }

  // ---------- Button Event Listeners ----------
  els.btnAnswer.addEventListener('click', answerCall);
  els.btnReject.addEventListener('click', rejectCall);
  els.overlayAnswer.addEventListener('click', answerCall);
  els.overlayReject.addEventListener('click', rejectCall);
  els.btnMute.addEventListener('click', toggleMute);
  els.btnHangup.addEventListener('click', hangupCall);

  // ---------- Status Updates ----------
  function updateConnectionStatus(connected) {
    const badge = els.connectionStatus;
    badge.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
    badge.querySelector('.status-text').textContent = connected ? 'Connected' : 'Offline';
  }

  function updateSipStatus(registered) {
    state.sipRegistered = registered;
    const badge = els.sipStatus;
    badge.className = `status-badge ${registered ? 'connected' : 'disconnected'}`;
    badge.querySelector('.status-text').textContent = registered ? 'SIP Online' : 'SIP Disconnected';
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

  // ---------- Init ----------
  loadConfig();

})();
