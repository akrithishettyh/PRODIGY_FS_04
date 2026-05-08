// Initialize LocalStorage Data
if (!localStorage.getItem('mockUsers')) localStorage.setItem('mockUsers', JSON.stringify([]));
if (!localStorage.getItem('mockRooms')) localStorage.setItem('mockRooms', JSON.stringify([{ id: '1', name: 'general', description: 'General discussion' }]));
if (!localStorage.getItem('mockMessages')) localStorage.setItem('mockMessages', JSON.stringify([]));
if (!localStorage.getItem('mockPrivateMessages')) localStorage.setItem('mockPrivateMessages', JSON.stringify([]));

function createResponse(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });
}

// Mock fetch
const originalFetch = window.fetch;
window.fetch = async function(url, options) {
  if (typeof url === 'string' && url.includes('/api/')) {
    const method = (options && options.method) || 'GET';
    const parsedBody = options && options.body ? JSON.parse(options.body) : null;
    
    if (method === 'POST' && url.includes('/api/register')) {
      const users = JSON.parse(localStorage.getItem('mockUsers'));
      const { username, password } = parsedBody;
      if (users.find(u => u.username === username)) return createResponse(400, { success: false, error: 'Username exists' });
      const newUser = { id: Date.now().toString(), username, password };
      users.push(newUser);
      localStorage.setItem('mockUsers', JSON.stringify(users));
      return createResponse(200, { success: true, token: 'mock-token', userId: newUser.id, username: newUser.username });
    }
    
    if (method === 'POST' && url.includes('/api/login')) {
      const users = JSON.parse(localStorage.getItem('mockUsers'));
      const { username, password } = parsedBody;
      const user = users.find(u => u.username === username && u.password === password);
      if (!user) return createResponse(400, { success: false, error: 'Invalid credentials' });
      return createResponse(200, { success: true, token: 'mock-token', userId: user.id, username: user.username });
    }
    
    if (method === 'GET' && url.includes('/api/rooms')) {
      return createResponse(200, JSON.parse(localStorage.getItem('mockRooms')));
    }
    
    if (method === 'POST' && url.includes('/api/rooms')) {
      const rooms = JSON.parse(localStorage.getItem('mockRooms'));
      const { name, description } = parsedBody;
      const newRoom = { id: Date.now().toString(), name, description };
      rooms.push(newRoom);
      localStorage.setItem('mockRooms', JSON.stringify(rooms));
      
      if (window.mockSocketInstance) {
        window.mockSocketInstance._broadcast('room_created', newRoom, true);
      }
      return createResponse(200, newRoom);
    }
    
    if (method === 'GET' && url.includes('/api/chat-history/')) {
      const messages = JSON.parse(localStorage.getItem('mockMessages'));
      const match = url.match(/\/api\/chat-history\/(.+)/);
      const roomId = match ? match[1] : null;
      const roomMessages = messages.filter(m => m.roomId === roomId);
      return createResponse(200, roomMessages);
    }
    
    if (method === 'GET' && url.includes('/api/private-history/')) {
      const messages = JSON.parse(localStorage.getItem('mockPrivateMessages'));
      const match = url.match(/\/api\/private-history\/(.+)\/(.+)/);
      if (match) {
        const userId = match[1];
        const otherUserId = match[2];
        const history = messages.filter(m => 
          (m.fromUserId == userId && m.toUserId == otherUserId) || 
          (m.fromUserId == otherUserId && m.toUserId == userId)
        );
        return createResponse(200, history);
      }
      return createResponse(200, []);
    }
  }
  return originalFetch(url, options);
};

// Mock socket.io
window.mockSockets = [];
window.mockOnlineUsers = [];

window.io = function() {
  const socket = {
    id: Date.now().toString(),
    callbacks: {},
    on(event, callback) {
      this.callbacks[event] = callback;
    },
    emit(event, data) {
      setTimeout(() => this._handleEvent(event, data), 10);
    },
    disconnect() {
      window.mockSockets = window.mockSockets.filter(s => s !== this);
      if (this.userId) {
        window.mockOnlineUsers = window.mockOnlineUsers.filter(u => u.id !== this.userId);
        this._broadcast('user_offline', { userId: this.userId, username: this.username });
        this._broadcast('users_list', window.mockOnlineUsers, true);
      }
    },
    _broadcast(event, data, includeSelf = false) {
      window.mockSockets.forEach(s => {
        if (!includeSelf && s === this) return;
        if (s.callbacks[event]) {
          s.callbacks[event](data);
        }
      });
    },
    _emitToSelf(event, data) {
      if (this.callbacks[event]) {
        this.callbacks[event](data);
      }
    },
    _handleEvent(event, data) {
      if (event === 'user_login') {
        this.userId = data.userId;
        this.username = data.username;
        if (!window.mockOnlineUsers.find(u => u.id === data.userId)) {
          window.mockOnlineUsers.push({ id: data.userId, username: data.username, status: 'online' });
        }
        this._broadcast('user_online', { userId: data.userId, username: data.username });
        this._broadcast('users_list', window.mockOnlineUsers, true);
      }
      else if (event === 'join_room') {
        this.roomId = data.roomId;
        this._broadcast('user_joined', { roomId: data.roomId, message: `${data.username} joined the room` }, true);
      }
      else if (event === 'leave_room') {
        this._broadcast('user_left', { roomId: data.roomId, message: `${data.username} left the room` }, true);
        this.roomId = null;
      }
      else if (event === 'send_message') {
        const message = {
          id: Date.now().toString(),
          roomId: data.roomId,
          userId: parseInt(data.userId) || data.userId,
          username: data.username,
          message: data.message,
          timestamp: new Date().toISOString()
        };
        const messages = JSON.parse(localStorage.getItem('mockMessages'));
        messages.push(message);
        localStorage.setItem('mockMessages', JSON.stringify(messages));
        
        this._broadcast('receive_message', message, true);
      }
      else if (event === 'send_private_message') {
        const message = {
          id: Date.now().toString(),
          fromUserId: data.fromUserId,
          toUserId: data.toUserId,
          fromUsername: data.fromUsername,
          toUsername: data.toUsername,
          message: data.message,
          timestamp: new Date().toISOString()
        };
        const messages = JSON.parse(localStorage.getItem('mockPrivateMessages'));
        messages.push(message);
        localStorage.setItem('mockPrivateMessages', JSON.stringify(messages));
        
        const recipientSocket = window.mockSockets.find(s => s.userId == data.toUserId);
        if (recipientSocket && recipientSocket.callbacks['receive_private_message']) {
          recipientSocket.callbacks['receive_private_message'](message);
        }
        
        this._emitToSelf('private_message_sent', message);
      }
      else if (event === 'typing') {
        this._broadcast('user_typing', data);
      }
    }
  };
  
  window.mockSockets.push(socket);
  window.mockSocketInstance = socket;
  
  setTimeout(() => {
    if (socket.callbacks['connect']) socket.callbacks['connect']();
  }, 50);
  
  return socket;
};
