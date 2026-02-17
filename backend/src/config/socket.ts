import { createServer, type Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import { config } from './index.js';
import logger from './logger.js';

let io: SocketIOServer | null = null;

interface SocketUser {
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

/**
 * Create a Socket.IO server attached to the Express app's HTTP server.
 *
 * Uses JWT cookie authentication -- parses the msedb_session cookie from
 * the WebSocket handshake headers and verifies it with the same JWT secret
 * used by the REST API.
 *
 * Each authenticated user joins a `user:{userId}` room for targeted event delivery.
 */
export function createSocketServer(app: Express): { httpServer: HttpServer; io: SocketIOServer } {
  const httpServer = createServer(app);

  const socketServer = new SocketIOServer(httpServer, {
    cors: {
      origin: config.appUrl,
      credentials: true,
    },
  });

  // JWT cookie authentication middleware
  socketServer.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
      return next(new Error('No session cookie'));
    }

    // Parse cookies from header (simple split approach -- no cookie-parser needed)
    let token: string | undefined;
    const cookies = cookieHeader.split(';');
    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.trim().split('=');
      if (name === 'msedb_session') {
        token = valueParts.join('=');
        break;
      }
    }

    if (!token) {
      return next(new Error('No session token in cookies'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as SocketUser;
      socket.data.user = decoded;
      next();
    } catch {
      next(new Error('Invalid or expired session'));
    }
  });

  // Connection handler
  socketServer.on('connection', (socket) => {
    const user = socket.data.user as SocketUser;
    const room = `user:${user.userId}`;

    socket.join(room);
    logger.info('Socket.IO client connected', {
      userId: user.userId,
      socketId: socket.id,
    });

    socket.on('disconnect', (reason) => {
      logger.info('Socket.IO client disconnected', {
        userId: user.userId,
        socketId: socket.id,
        reason,
      });
    });
  });

  io = socketServer;

  return { httpServer, io: socketServer };
}

/**
 * Get the Socket.IO server instance.
 * Throws if createSocketServer has not been called yet.
 */
export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.IO server not initialized -- call createSocketServer first');
  }
  return io;
}
