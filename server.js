const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const Database = require('./database');
const { generateToken, verifyToken } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Initialize database
const db = new Database('./chat.db');

// Store active users
const activeUsers = new Map();
const userSockets = new Map();

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await db.registerUser(username, password);
    if (result.success) {
      const token = generateToken(result.userId, username);
      res.json({ success: true, token, userId: result.userId, username });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await db.loginUser(username, password);
    if (result.success) {
      const token = generateToken(result.userId, username);
      res.json({ success: true, token, userId: result.userId, username });
    } else {
      res.status(401).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await db.getRooms();
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const { name, description } = req.body;
    const room = await db.createRoom(name, description);
    io.emit('room_created', room);
    res.json(room);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chat-history/:roomId', async (req, res) => {
  try {
    const messages = await db.getChatHistory(req.params.roomId);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/private-history/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const messages = await db.getPrivateMessages(userId, otherUserId);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket Events
io.on('connection', (socket) => {
  console.log(`New user connected: ${socket.id}`);

  socket.on('user_login', (data) => {
    const { userId, username } = data;
    activeUsers.set(userId, {
      id: userId,
      username: username,
      socketId: socket.id,
      status: 'online',
      joinedAt: new Date()
    });
    userSockets.set(socket.id, userId);

    io.emit('user_online', {
      userId,
      username,
      status: 'online',
      activeUsersCount: activeUsers.size
    });

    socket.emit('users_list', Array.from(activeUsers.values()));
  });

  socket.on('join_room', (data) => {
    const { roomId, userId, username } = data;
    socket.join(roomId);

    io.to(roomId).emit('user_joined', {
      userId,
      username,
      message: `${username} joined the room`,
      timestamp: new Date()
    });

    console.log(`${username} joined room ${roomId}`);
  });

  socket.on('leave_room', (data) => {
    const { roomId, userId, username } = data;
    socket.leave(roomId);

    io.to(roomId).emit('user_left', {
      userId,
      username,
      message: `${username} left the room`,
      timestamp: new Date()
    });
  });

  socket.on('send_message', async (data) => {
    try {
      const { roomId, userId, username, message } = data;
      const timestamp = new Date();

      // Save to database
      const savedMessage = await db.saveMessage(roomId, userId, username, message);

      // Broadcast to room
      io.to(roomId).emit('receive_message', {
        id: savedMessage.id,
        roomId,
        userId,
        username,
        message,
        timestamp
      });

      console.log(`Message in room ${roomId}: ${username} - ${message}`);
    } catch (error) {
      console.error('Error saving message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('send_private_message', async (data) => {
    try {
      const { fromUserId, toUserId, fromUsername, toUsername, message } = data;
      const timestamp = new Date();

      // Save to database
      const savedMessage = await db.savePrivateMessage(
        fromUserId,
        toUserId,
        fromUsername,
        toUsername,
        message
      );

      // Send to recipient
      const recipientSocket = Array.from(activeUsers.values()).find(
        u => u.id === toUserId
      );

      if (recipientSocket) {
        io.to(recipientSocket.socketId).emit('receive_private_message', {
          id: savedMessage.id,
          fromUserId,
          fromUsername,
          message,
          timestamp
        });
      }

      // Confirm to sender
      socket.emit('private_message_sent', {
        id: savedMessage.id,
        toUserId,
        message,
        timestamp
      });

      console.log(`Private message: ${fromUsername} -> ${toUsername}`);
    } catch (error) {
      console.error('Error sending private message:', error);
      socket.emit('error', { message: 'Failed to send private message' });
    }
  });

  socket.on('typing', (data) => {
    const { roomId, userId, username, isTyping } = data;
    socket.to(roomId).emit('user_typing', {
      userId,
      username,
      isTyping
    });
  });

  socket.on('disconnect', () => {
    const userId = userSockets.get(socket.id);
    if (userId) {
      const user = activeUsers.get(userId);
      if (user) {
        activeUsers.delete(userId);
        io.emit('user_offline', {
          userId,
          username: user.username,
          status: 'offline',
          activeUsersCount: activeUsers.size
        });
        console.log(`User disconnected: ${user.username}`);
      }
    }
    userSockets.delete(socket.id);
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
});
