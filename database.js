const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

class Database {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Database connection error:', err);
      } else {
        console.log('Connected to SQLite database');
        this.initializeTables();
      }
    });
  }

  initializeTables() {
    this.db.serialize(() => {
      // Users table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Rooms table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          description TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          createdBy INTEGER
        )
      `);

      // Messages table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          roomId INTEGER NOT NULL,
          userId INTEGER NOT NULL,
          username TEXT NOT NULL,
          message TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(roomId) REFERENCES rooms(id),
          FOREIGN KEY(userId) REFERENCES users(id)
        )
      `);

      // Private messages table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS private_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fromUserId INTEGER NOT NULL,
          toUserId INTEGER NOT NULL,
          fromUsername TEXT NOT NULL,
          toUsername TEXT NOT NULL,
          message TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          read BOOLEAN DEFAULT 0,
          FOREIGN KEY(fromUserId) REFERENCES users(id),
          FOREIGN KEY(toUserId) REFERENCES users(id)
        )
      `);

      // Notifications table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER NOT NULL,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          read BOOLEAN DEFAULT 0,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(userId) REFERENCES users(id)
        )
      `);

      // User presence table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS user_presence (
          userId INTEGER PRIMARY KEY,
          status TEXT DEFAULT 'offline',
          lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(userId) REFERENCES users(id)
        )
      `);

      // Create default general room
      this.db.run(`
        INSERT OR IGNORE INTO rooms (id, name, description) 
        VALUES (1, 'General', 'General discussion room')
      `);
    });
  }

  registerUser(username, password) {
    return new Promise((resolve, reject) => {
      const hashedPassword = bcrypt.hashSync(password, 10);
      
      this.db.run(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, hashedPassword],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              resolve({ success: false, error: 'Username already exists' });
            } else {
              reject(err);
            }
          } else {
            resolve({ success: true, userId: this.lastID });
          }
        }
      );
    });
  }

  loginUser(username, password) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE username = ?',
        [username],
        (err, user) => {
          if (err) reject(err);
          else if (!user) {
            resolve({ success: false, error: 'User not found' });
          } else if (bcrypt.compareSync(password, user.password)) {
            resolve({ success: true, userId: user.id });
          } else {
            resolve({ success: false, error: 'Invalid password' });
          }
        }
      );
    });
  }

  getRooms() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM rooms ORDER BY createdAt DESC',
        (err, rooms) => {
          if (err) reject(err);
          else resolve(rooms || []);
        }
      );
    });
  }

  createRoom(name, description) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO rooms (name, description) VALUES (?, ?)',
        [name, description],
        function(err) {
          if (err) reject(err);
          else {
            resolve({
              id: this.lastID,
              name,
              description,
              createdAt: new Date()
            });
          }
        }
      );
    });
  }

  saveMessage(roomId, userId, username, message) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO messages (roomId, userId, username, message) VALUES (?, ?, ?, ?)',
        [roomId, userId, username, message],
        function(err) {
          if (err) reject(err);
          else {
            resolve({
              id: this.lastID,
              roomId,
              userId,
              username,
              message,
              timestamp: new Date()
            });
          }
        }
      );
    });
  }

  getChatHistory(roomId, limit = 50) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp DESC LIMIT ?',
        [roomId, limit],
        (err, messages) => {
          if (err) reject(err);
          else resolve((messages || []).reverse());
        }
      );
    });
  }

  savePrivateMessage(fromUserId, toUserId, fromUsername, toUsername, message) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO private_messages (fromUserId, toUserId, fromUsername, toUsername, message) VALUES (?, ?, ?, ?, ?)',
        [fromUserId, toUserId, fromUsername, toUsername, message],
        function(err) {
          if (err) reject(err);
          else {
            resolve({
              id: this.lastID,
              fromUserId,
              toUserId,
              message,
              timestamp: new Date()
            });
          }
        }
      );
    });
  }

  getPrivateMessages(userId1, userId2, limit = 50) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM private_messages 
         WHERE (fromUserId = ? AND toUserId = ?) OR (fromUserId = ? AND toUserId = ?)
         ORDER BY timestamp DESC LIMIT ?`,
        [userId1, userId2, userId2, userId1, limit],
        (err, messages) => {
          if (err) reject(err);
          else resolve((messages || []).reverse());
        }
      );
    });
  }

  saveNotification(userId, type, message) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO notifications (userId, type, message) VALUES (?, ?, ?)',
        [userId, type, message],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  getNotifications(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC',
        [userId],
        (err, notifications) => {
          if (err) reject(err);
          else resolve(notifications || []);
        }
      );
    });
  }

  updateUserPresence(userId, status) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO user_presence (userId, status) VALUES (?, ?)',
        [userId, status],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  close() {
    this.db.close((err) => {
      if (err) console.error('Error closing database:', err);
      else console.log('Database connection closed');
    });
  }
}

module.exports = Database;
