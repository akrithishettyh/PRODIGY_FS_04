// Global State
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : window.location.origin;
let socket = null;
let currentUser = null;
let currentRoom = null;
let currentPrivateChat = null;
let users = [];
let rooms = [];
let notifications = [];
let typing = {};

// DOM Elements
let authContainer = null;
let chatContainer = null;
let loginForm = null;
let registerForm = null;
let tabButtons = null;
let messagesContainer = null;
let messageInput = null;
let sendBtn = null;
let logoutBtn = null;
let createRoomBtn = null;
let createRoomModal = null;
let createRoomForm = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  authContainer = document.getElementById('authContainer');
  chatContainer = document.getElementById('chatContainer');
  loginForm = document.getElementById('loginForm');
  registerForm = document.getElementById('registerForm');
  tabButtons = document.querySelectorAll('.tab-button');
  messagesContainer = document.getElementById('messagesContainer');
  messageInput = document.getElementById('messageInput');
  sendBtn = document.getElementById('sendBtn');
  logoutBtn = document.getElementById('logoutBtn');
  createRoomBtn = document.getElementById('createRoomBtn');
  createRoomModal = document.getElementById('createRoomModal');
  createRoomForm = document.getElementById('createRoomForm');

  // Disable message input and send button initially
  if (messageInput) messageInput.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  setupAuthListeners();
  checkToken();
});

// Auth Setup
function setupAuthListeners() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });

  loginForm.addEventListener('submit', handleLogin);
  registerForm.addEventListener('submit', handleRegister);
  logoutBtn.addEventListener('click', handleLogout);

  if (createRoomBtn && createRoomModal) {
    createRoomBtn.addEventListener('click', () => {
      createRoomModal.classList.add('show');
    });
  }

  if (createRoomForm) {
    createRoomForm.addEventListener('submit', handleCreateRoom);
  }

  if (sendBtn && messageInput) {
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', handleMessageKeydown);
    messageInput.addEventListener('input', handleTyping);
  }

  document.getElementById('clearHistoryBtn').addEventListener('click', clearChatHistory);
  document.getElementById('clearNotificationsBtn').addEventListener('click', clearNotifications);

  // Close modal on background click
  window.addEventListener('click', (e) => {
    if (e.target === createRoomModal) {
      createRoomModal.classList.remove('show');
    }
  });
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`${tabName}Tab`).classList.add('active');
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  const errorDiv = document.getElementById('loginError');

  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (data.success) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('userId', data.userId);
      localStorage.setItem('username', data.username);
      showChat();
    } else {
      errorDiv.textContent = data.error;
      errorDiv.classList.add('show');
    }
  } catch (error) {
    errorDiv.textContent = 'Login failed: ' + error.message;
    errorDiv.classList.add('show');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('registerUsername').value;
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('registerConfirmPassword').value;
  const errorDiv = document.getElementById('registerError');

  if (password !== confirmPassword) {
    errorDiv.textContent = 'Passwords do not match';
    errorDiv.classList.add('show');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (data.success) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('userId', data.userId);
      localStorage.setItem('username', data.username);
      showChat();
    } else {
      errorDiv.textContent = data.error;
      errorDiv.classList.add('show');
    }
  } catch (error) {
    errorDiv.textContent = 'Registration failed: ' + error.message;
    errorDiv.classList.add('show');
  }
}

function handleLogout() {
  if (socket) socket.disconnect();
  localStorage.removeItem('token');
  localStorage.removeItem('userId');
  localStorage.removeItem('username');
  location.reload();
}

function checkToken() {
  const token = localStorage.getItem('token');
  if (token) {
    showChat();
  }
}

// Chat Setup
function showChat() {
  authContainer.style.display = 'none';
  chatContainer.style.display = 'flex';
  currentUser = {
    id: localStorage.getItem('userId'),
    username: localStorage.getItem('username')
  };

  document.getElementById('currentUsername').textContent = currentUser.username;
  document.getElementById('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();

  initializeSocket();
}

function initializeSocket() {
  socket = io(API_BASE, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('user_login', {
      userId: currentUser.id,
      username: currentUser.username
    });
    
    // Enable message input after connection
    if (messageInput && sendBtn) {
      messageInput.disabled = false;
      sendBtn.disabled = false;
    }
    
    // Load rooms after socket connects
    loadRooms();
  });

  socket.on('users_list', (usersList) => {
    users = usersList;
    updateUsersList();
  });

  socket.on('user_online', (data) => {
    const existingUser = users.find(u => u.id === data.userId);
    if (!existingUser) {
      users.push(data);
    }
    updateUsersList();
    showNotification(`${data.username} came online`, 'user_online');
  });

  socket.on('user_offline', (data) => {
    users = users.filter(u => u.id !== data.userId);
    updateUsersList();
    showNotification(`${data.username} went offline`, 'user_offline');
  });

  socket.on('receive_message', (message) => {
    if (currentRoom === message.roomId) {
      displayMessage(message);
    }
    showNotification(`New message in ${message.roomId}`, 'message');
  });

  socket.on('receive_private_message', (message) => {
    if (currentPrivateChat === message.fromUserId) {
      displayPrivateMessage(message);
    }
    showNotification(`${message.fromUsername} sent you a message`, 'private_message');
  });

  socket.on('private_message_sent', (message) => {
    if (currentPrivateChat === message.toUserId) {
      displayPrivateMessage({
        fromUserId: currentUser.id,
        fromUsername: currentUser.username,
        message: message.message,
        timestamp: message.timestamp
      }, true);
    }
  });

  socket.on('user_joined', (data) => {
    if (currentRoom === data.roomId) {
      displaySystemMessage(data.message);
    }
  });

  socket.on('user_left', (data) => {
    if (currentRoom === data.roomId) {
      displaySystemMessage(data.message);
    }
  });

  socket.on('room_created', (room) => {
    if (!rooms.find(r => r.id === room.id)) {
      rooms.push(room);
      updateRoomsList();
    }
  });

  socket.on('user_typing', (data) => {
    if (currentRoom === data.roomId && data.isTyping) {
      typing[data.userId] = data;
      updateTypingIndicator();
    } else if (currentRoom === data.roomId && !data.isTyping) {
      delete typing[data.userId];
      updateTypingIndicator();
    }
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
    alert('Error: ' + error.message);
  });
}

async function loadRooms() {
  try {
    const response = await fetch(`${API_BASE}/api/rooms`);
    rooms = await response.json();
    updateRoomsList();

    // Join general room by default
    if (rooms.length > 0) {
      joinRoom(rooms[0]);
    }
  } catch (error) {
    console.error('Error loading rooms:', error);
  }
}

function updateRoomsList() {
  const roomsList = document.getElementById('roomsList');
  roomsList.innerHTML = '';

  rooms.forEach(room => {
    const roomItem = document.createElement('div');
    roomItem.className = 'room-item' + (currentRoom === room.id ? ' active' : '');
    roomItem.dataset.roomId = room.id;
    roomItem.textContent = '#' + room.name;
    roomItem.addEventListener('click', () => joinRoom(room));
    roomsList.appendChild(roomItem);
  });
}

function updateUsersList() {
  const usersList = document.getElementById('usersList');
  const usersCount = document.getElementById('usersCount');
  usersList.innerHTML = '';
  usersCount.textContent = users.length;

  users.forEach(user => {
    if (user.id !== currentUser.id) {
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      
      const statusDot = document.createElement('div');
      statusDot.className = 'user-status-dot' + (user.status === 'online' ? '' : ' offline');
      
      const nameSpan = document.createElement('span');
      nameSpan.textContent = user.username;
      
      userItem.appendChild(statusDot);
      userItem.appendChild(nameSpan);
      userItem.addEventListener('click', () => openPrivateChat(user));
      usersList.appendChild(userItem);
    }
  });
}

function joinRoom(room) {
  const previousRoom = currentRoom;
  currentRoom = room.id;
  currentPrivateChat = null;
  
  if (messageInput) messageInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;

  // Leave previous room if any
  if (previousRoom && previousRoom !== room.id) {
    socket.emit('leave_room', {
      roomId: previousRoom,
      userId: currentUser.id,
      username: currentUser.username
    });
  }

  // Update header
  document.getElementById('roomName').textContent = '#' + room.name;
  document.getElementById('roomUsers').textContent = room.description || '';

  // Update active room style
  document.querySelectorAll('.room-item').forEach(item => {
    item.classList.toggle('active', item.dataset.roomId == room.id);
  });

  // Emit join event
  socket.emit('join_room', {
    roomId: room.id,
    userId: currentUser.id,
    username: currentUser.username
  });

  // Clear messages and load chat history
  messagesContainer.innerHTML = '';
  typing = {};
  loadChatHistory(room.id);
}

function openPrivateChat(user) {
  if (currentRoom) {
    socket.emit('leave_room', {
      roomId: currentRoom,
      userId: currentUser.id,
      username: currentUser.username
    });
  }

  currentRoom = null;
  currentPrivateChat = user.id;
  
  if (messageInput) messageInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;

  document.getElementById('roomName').textContent = '@' + user.username;
  document.getElementById('roomUsers').textContent = 'Private conversation';

  messagesContainer.innerHTML = '';
  typing = {};
  loadPrivateChatHistory(user.id);
}

function joinAndDisplayRoom(room) {
  joinRoom(room);
  messagesContainer.innerHTML = '';
}

async function loadChatHistory(roomId) {
  try {
    const response = await fetch(`${API_BASE}/api/chat-history/${roomId}`);
    const messages = await response.json();
    messagesContainer.innerHTML = '';
    messages.forEach(msg => displayMessage(msg));
  } catch (error) {
    console.error('Error loading chat history:', error);
  }
}

function displayMessage(message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message' + (message.userId === parseInt(currentUser.id) ? ' own' : '');

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `<strong>${message.username}:</strong> ${escapeHtml(message.message)}`;

  const time = document.createElement('div');
  time.className = 'message-time';
  const msgDate = new Date(message.timestamp);
  time.textContent = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  messageDiv.appendChild(bubble);
  messageDiv.appendChild(time);
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function displayPrivateMessage(message, isOwn = false) {
  const messageDiv = document.createElement('div');
  const ownMessage = isOwn || message.fromUserId === parseInt(currentUser.id);
  messageDiv.className = 'message' + (ownMessage ? ' own' : '');

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = ownMessage ? `<strong>You:</strong> ${escapeHtml(message.message)}` : `<strong>${escapeHtml(message.fromUsername || 'Friend')}:</strong> ${escapeHtml(message.message)}`;

  const time = document.createElement('div');
  time.className = 'message-time';
  const msgDate = new Date(message.timestamp);
  time.textContent = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  messageDiv.appendChild(bubble);
  messageDiv.appendChild(time);
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function displaySystemMessage(message) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'system-message';
  msgDiv.textContent = message;
  messagesContainer.appendChild(msgDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendMessage() {
  console.log('=== sendMessage called ===');
  const message = messageInput.value.trim();
  console.log('Message:', message);
  console.log('Current room:', currentRoom);
  console.log('Private chat:', currentPrivateChat);

  if (!message) {
    console.warn('No message to send');
    return;
  }

  if (!socket) {
    console.error('Socket not initialized');
    return;
  }

  if (currentRoom) {
    console.log('Sending message to room:', currentRoom);
    socket.emit('send_message', {
      roomId: currentRoom,
      userId: currentUser.id,
      username: currentUser.username,
      message: message
    });
  } else if (currentPrivateChat) {
    const recipient = users.find(u => u.id === currentPrivateChat);
    if (!recipient) {
      showNotification('Recipient not found or offline', 'warning');
      return;
    }

    console.log('Sending private message to:', recipient.username);
    socket.emit('send_private_message', {
      fromUserId: currentUser.id,
      toUserId: currentPrivateChat,
      fromUsername: currentUser.username,
      toUsername: recipient.username,
      message: message
    });

    displayPrivateMessage({
      fromUserId: currentUser.id,
      fromUsername: currentUser.username,
      message,
      timestamp: new Date()
    }, true);
  } else {
    console.warn('No room or private chat selected');
    return;
  }

  messageInput.value = '';
  if (currentRoom) {
    socket.emit('typing', {
      roomId: currentRoom,
      userId: currentUser.id,
      username: currentUser.username,
      isTyping: false
    });
  }
}

function handleMessageKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function handleTyping() {
  if (!currentRoom) return;

  socket.emit('typing', {
    roomId: currentRoom,
    userId: currentUser.id,
    username: currentUser.username,
    isTyping: messageInput.value.length > 0
  });
}

function updateTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  const typingUser = document.getElementById('typingUser');

  if (Object.keys(typing).length > 0) {
    const names = Object.values(typing).map(t => t.username).join(', ');
    typingUser.textContent = names;
    indicator.style.display = 'flex';
  } else {
    indicator.style.display = 'none';
  }
}

async function handleCreateRoom(e) {
  e.preventDefault();
  const name = document.getElementById('newRoomName').value;
  const description = document.getElementById('newRoomDesc').value;

  try {
    const response = await fetch(`${API_BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });

    if (response.ok) {
      document.getElementById('newRoomName').value = '';
      document.getElementById('newRoomDesc').value = '';
      createRoomModal.classList.remove('show');
      loadRooms();
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to create room');
    }
  } catch (error) {
    console.error('Error creating room:', error);
    alert('Failed to create room');
  }
}

function clearChatHistory() {
  if (confirm('Are you sure you want to clear the chat history? This cannot be undone.')) {
    messagesContainer.innerHTML = '';
  }
}

function loadPrivateChatHistory(otherUserId) {
  const userId = currentUser.id;
  fetch(`${API_BASE}/api/private-history/${userId}/${otherUserId}`)
    .then(response => response.json())
    .then(messages => {
      messagesContainer.innerHTML = '';
      messages.forEach(msg => {
        displayPrivateMessage({
          fromUserId: msg.fromUserId,
          fromUsername: msg.fromUsername,
          message: msg.message,
          timestamp: msg.timestamp
        });
      });
    })
    .catch(error => console.error('Error loading private chat history:', error));
}

function clearNotifications() {
  notifications = [];
  updateNotifications();
}

function showNotification(message, type) {
  notifications.push({ message, type, timestamp: new Date() });
  if (notifications.length > 10) {
    notifications.shift();
  }
  updateNotifications();
}

function updateNotifications() {
  const notifList = document.getElementById('notificationsList');
  notifList.innerHTML = '';

  notifications.slice(-5).forEach(notif => {
    const notifItem = document.createElement('div');
    notifItem.className = 'notification-item';
    notifItem.textContent = notif.message;
    notifList.appendChild(notifItem);
  });
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
