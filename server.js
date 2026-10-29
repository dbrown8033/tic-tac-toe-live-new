
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const rooms = new Map();
const wins = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function roomCode() {
  let code;
  do {
    code = randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function getWinner(board) {
  for (const [a, b, c] of wins) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return board.every(Boolean) ? "draw" : null;
}

function sendState(room) {
  io.to(room.id).emit("state", {
    id: room.id,
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    scores: room.scores,
    players: {
      X: Boolean(room.players.X),
      O: Boolean(room.players.O)
    },
    round: room.round
  });
}

function leaveRoom(socket) {
  const id = socket.data.roomId;
  const role = socket.data.role;
  if (!id || !role) return;

  const room = rooms.get(id);
  if (room && room.players[role] === socket.id) {
    room.players[role] = null;
    sendState(room);
    if (!room.players.X && !room.players.O) rooms.delete(id);
  }

  socket.leave(id);
  socket.data.roomId = null;
  socket.data.role = null;
}

io.on("connection", socket => {
  socket.data.roomId = null;
  socket.data.role = null;

  socket.on("create", (_data, callback) => {
    leaveRoom(socket);

    const id = roomCode();
    const room = {
      id,
      players: { X: socket.id, O: null },
      board: Array(9).fill(null),
      turn: "X",
      winner: null,
      scores: { X: 0, O: 0, draw: 0 },
      round: 1
    };

    rooms.set(id, room);
    socket.data.roomId = id;
    socket.data.role = "X";
    socket.join(id);

    if (typeof callback === "function") callback({ ok: true, id, role: "X" });
    sendState(room);
  });

  socket.on("join", (rawCode, callback) => {
    const id = String(rawCode || "").trim().toUpperCase();
    const room = rooms.get(id);

    if (!/^[A-F0-9]{6}$/.test(id) || !room) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Room not found. Check the code and try again." });
      }
      return;
    }

    if (room.players.X && room.players.O) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "This room already has two players." });
      }
      return;
    }

    leaveRoom(socket);

    const role = room.players.X ? "O" : "X";
    room.players[role] = socket.id;
    socket.data.roomId = id;
    socket.data.role = role;
    socket.join(id);

    if (typeof callback === "function") callback({ ok: true, id, role });
    sendState(room);
  });

  socket.on("move", index => {
    const room = rooms.get(socket.data.roomId);
    const role = socket.data.role;

    if (!room || !role || room.players[role] !== socket.id) return;
    if (!room.players.X || !room.players.O || room.winner) return;
    if (!Number.isInteger(index) || index < 0 || index > 8) return;
    if (room.turn !== role || room.board[index] !== null) return;

    room.board[index] = role;
    room.winner = getWinner(room.board);

    if (room.winner) {
      room.scores[room.winner]++;
    } else {
      room.turn = role === "X" ? "O" : "X";
    }
    sendState(room);
  });

  socket.on("again", () => {
    const room = rooms.get(socket.data.roomId);
    const role = socket.data.role;
    if (!room || !role || room.players[role] !== socket.id) return;
    if (!room.players.X || !room.players.O || !room.winner) return;

    room.board = Array(9).fill(null);
    room.winner = null;
    room.round++;
    room.turn = room.round % 2 ? "X" : "O";
    sendState(room);
  });

  socket.on("leave", () => leaveRoom(socket));
  socket.on("disconnect", () => leaveRoom(socket));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Tic-Tac-Toe server running on port ${PORT}`);
});
