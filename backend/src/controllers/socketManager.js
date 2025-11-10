// controllers/socketManager.js
import { Server } from "socket.io";

// In-memory data storage
let connections = {};  // { roomId: [ socketId, ... ] }
let userNames = {};    // { socketId: username }
let messages = {};     // { roomId: [ { sender, data, socketId } ] }

export const connectToSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["*"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("✅ Client connected:", socket.id);

    // -----------------------------
    // 1️⃣ JOIN CALL
    // -----------------------------
    socket.on("join-call", ({ roomId, username }) => {
      const room = roomId || "default-room";
      if (!connections[room]) connections[room] = [];

      // Save username
      userNames[socket.id] = username || `User-${socket.id.substring(0, 5)}`;

      // Avoid duplicates
      if (!connections[room].includes(socket.id)) {
        connections[room].push(socket.id);
      }

      socket.join(room);
      console.log(`📞 ${username} joined room ${room}`);

      // Send existing users list to the new user
      const existingUsers = connections[room]
        .filter((id) => id !== socket.id)
        .map((id) => ({
          id,
          username: userNames[id] || "Peer",
        }));

      io.to(socket.id).emit("existing-users", existingUsers);

      // Notify others in the room that a new user joined
      existingUsers.forEach((peer) => {
        io.to(peer.id).emit("user-joined", {
          id: socket.id,
          username: userNames[socket.id],
        });
      });

      // Send chat history to the new user
      if (messages[room]) {
        messages[room].forEach((msg) => {
          io.to(socket.id).emit(
            "chat-message",
            msg.data,
            msg.sender,
            msg["socket-id-sender"]
          );
        });
      }
    });

    // -----------------------------
    // 2️⃣ SIGNALING (WebRTC)
    // -----------------------------
    socket.on("signal", (toId, message) => {
      io.to(toId).emit("signal", socket.id, message);
    });

    // -----------------------------
    // 3️⃣ CHAT MESSAGES
    // -----------------------------
    socket.on("chat-message", (data, sender) => {
      const [room] =
        Object.entries(connections).find(([_, users]) =>
          users.includes(socket.id)
        ) || [];

      if (!room) return;

      if (!messages[room]) messages[room] = [];
      messages[room].push({
        sender,
        data,
        "socket-id-sender": socket.id,
      });

      connections[room].forEach((id) => {
        io.to(id).emit("chat-message", data, sender, socket.id);
      });
    });

    // -----------------------------
    // 4️⃣ LIVE CAPTIONS
    // -----------------------------
    socket.on("caption", (data) => {
      // { roomId, text, sender }
      const { roomId, text, sender } = data;
      if (!roomId || !text) return;

      // Broadcast caption text to all in the same room (except sender)
      socket.to(roomId).emit("caption", { sender, text });
    });

    // -----------------------------
    // 5️⃣ HAND RAISE
    // -----------------------------
    socket.on("hand-raise", ({ roomId, username, raised }) => {
      console.log(`✋ ${username} ${raised ? "raised" : "lowered"} hand in ${roomId}`);
      socket.to(roomId).emit("hand-raise", { username, raised });
    });

    // -----------------------------
    // 6️⃣ DISCONNECT
    // -----------------------------
    socket.on("disconnect", () => {
      console.log("❌ Disconnected:", socket.id);

      Object.entries(connections).forEach(([room, users]) => {
        if (users.includes(socket.id)) {
          // Notify others in the same room
          users.forEach((peerId) => {
            if (peerId !== socket.id) {
              io.to(peerId).emit("user-left", socket.id);
            }
          });

          // Remove user from room
          connections[room] = users.filter((id) => id !== socket.id);
          if (connections[room].length === 0) delete connections[room];
        }
      });

      delete userNames[socket.id];
    });
  });

  return io;
};
