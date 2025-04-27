import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
const __dirname = path.resolve();

const app = express();
app.use(
  cors({
    origin: '*', // 모든 오리진 허용 (프로덕션에서는 특정 도메인으로 제한하는 것이 좋음)
    methods: ['GET', 'POST'],
    credentials: true,
  })
);

// 정적 파일 제공 - 빌드된 클라이언트 파일
app.use(express.static(path.join(__dirname, 'public')));

// 모든 경로에서 index.html 제공 (SPA 지원)
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 방 정보를 반환하는 API
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;

  if (!rooms.has(roomId)) {
    return res.status(404).send({
      error: 'Room not found',
      message: '요청한 방을 찾을 수 없습니다.',
    });
  }

  const roomParticipants = Array.from(rooms.get(roomId)).map(([userId, data]) => ({
    userId,
    nickname: data.nickname,
  }));

  res.send({
    roomId,
    participants: roomParticipants,
    participantCount: roomParticipants.length,
  });
});

// 모든 활성 방 목록 반환 API
app.get('/api/rooms', (req, res) => {
  const activeRooms = Array.from(rooms.entries()).map(([roomId, participants]) => ({
    roomId,
    participantCount: participants.size,
    participants: Array.from(participants).map(([userId, data]) => ({
      userId,
      nickname: data.nickname,
    })),
  }));

  res.send({
    rooms: activeRooms,
    count: activeRooms.length,
  });
});

// 클라이언트 라우트 처리 (SPA를 위한 모든 경로에서 index.html 제공)
app.get('*', (req, res) => {
  // API 라우트는 제외
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public/index.html'));
  }
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // 모든 오리진 허용
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000, // 핑 타임아웃 증가 (60초)
  pingInterval: 25000, // 핑 간격 (25초)
});

// 방 및 사용자 정보 저장 맵
const rooms = new Map();
const userSocketMap = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // 방 입장 이벤트 처리
  socket.on('join-room', ({ roomId, userId, nickname }) => {
    console.log('User joining room:', { roomId, userId, nickname, socketId: socket.id });

    // 재접속 여부 확인 (페이지 새로고침 등)
    let isRejoin = false;
    let oldSocketId = null;

    if (rooms.has(roomId)) {
      // 기존 참가자 중 동일한 userId를 가진 사용자 찾기
      const existingParticipants = rooms.get(roomId);
      for (const [existingUserId, data] of existingParticipants.entries()) {
        if (existingUserId === userId) {
          // 동일한 userId를 가진 사용자를 찾음 (재접속)
          oldSocketId = data.socketId;
          console.log(`User ${userId} is reconnecting, old socket: ${oldSocketId}, new socket: ${socket.id}`);
          isRejoin = true;

          // 기존 연결 정보 제거
          existingParticipants.delete(existingUserId);
          break;
        }
      }
    }

    // 소켓을 해당 방에 조인
    socket.join(roomId);
    // userId와 socketId 매핑 저장
    userSocketMap.set(userId, socket.id);

    // 방이 없으면 새로 생성
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    // 사용자 정보 저장
    rooms.get(roomId).set(userId, { socketId: socket.id, nickname });

    // 참가자 목록 생성
    const participants = Array.from(rooms.get(roomId)).map(([userId, data]) => ({
      userId,
      socketId: data.socketId,
      nickname: data.nickname,
    }));

    console.log('Sending existing participants to user:', participants);
    // 현재 접속한 사용자에게 기존 참가자 정보 전송
    socket.emit('existing-participants', participants);

    // 재접속인지 새 접속인지에 따라 다른 이벤트 발생
    if (isRejoin) {
      console.log('Notifying others about user rejoining:', { userId, nickname, socketId: socket.id });
      socket.to(roomId).emit('userRejoined', {
        userId,
        socketId: socket.id,
        nickname,
      });
    } else {
      console.log('Notifying others about new user:', { userId, nickname, socketId: socket.id });
      socket.to(roomId).emit('userJoined', {
        userId,
        socketId: socket.id,
        nickname,
      });
    }

    // 모든 참가자에게 현재 참가자 수 알림
    io.to(roomId).emit('participant-count', rooms.get(roomId).size);
    console.log(`Room ${roomId} now has ${rooms.get(roomId).size} participants`);
  });

  // 방 퇴장 이벤트 처리
  socket.on('leave-room', ({ roomId, userId }) => {
    console.log('User leaving room:', { roomId, userId });

    if (rooms.has(roomId)) {
      // 방에서 사용자 제거
      rooms.get(roomId).delete(userId);

      // 방이 비었으면 방 자체를 제거
      if (rooms.get(roomId).size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} is now empty and removed`);
      } else {
        // 남은 참가자들에게 참가자 수 업데이트
        io.to(roomId).emit('participant-count', rooms.get(roomId).size);
        console.log(`Room ${roomId} now has ${rooms.get(roomId).size} participants`);
      }
    }

    // 사용자 매핑 제거
    [...userSocketMap.entries()].filter(([, sid]) => sid === socket.id).forEach(([uid]) => userSocketMap.delete(uid));

    // 다른 참가자들에게 사용자 퇴장 알림
    socket.to(roomId).emit('userLeft', { userId });
    // 소켓을 방에서 제거
    socket.leave(roomId);
  });

  // 채팅 메시지 이벤트 처리
  socket.on('chat-message', ({ roomId, id, senderId, senderNickname, content, timestamp }) => {
    console.log('Chat message received:', { roomId, id, senderId, senderNickname, content, timestamp });
    // 메시지를 같은 방의 다른 사용자들에게 전송
    socket.to(roomId).emit('receiveMessage', {
      id,
      senderId,
      senderNickname,
      content,
      timestamp,
    });
  });

  // WebRTC 시그널링 이벤트 처리
  socket.on('signal', ({ to, from, signal }) => {
    console.log('Signal received:', { to, from, type: signal.type || 'ICE candidate' });

    // userId로 해당 사용자의 socketId 조회
    const targetSocketId = userSocketMap.get(to);

    if (targetSocketId) {
      console.log(`신호 전달: ${from} -> ${to}, 타겟 소켓: ${targetSocketId}`);

      // from은 이미 userId 이므로 그대로 사용
      let fromUserId = from;

      // userId가 실제로 존재하는지 확인 (선택적)
      let isValidUser = false;
      for (const [roomId, participants] of rooms.entries()) {
        if (participants.has(fromUserId)) {
          isValidUser = true;
          break;
        }
      }

      if (!isValidUser) {
        console.warn(`알 수 없는 출처의 신호: ${fromUserId}. 하지만 그대로 전달합니다.`);
      }

      // 시그널 데이터 전송
      io.to(targetSocketId).emit('signal', {
        from: fromUserId,
        signal,
      });
    } else {
      console.warn(`대상 유저를 찾을 수 없음: ${to}. 신호 전달 실패. 현재 맵:`, Array.from(userSocketMap.entries()));
    }
  });

  // 연결 해제 이벤트 처리
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // 모든 방을 검색하여 해당 소켓의 사용자 찾기
    rooms.forEach((participants, roomId) => {
      participants.forEach((data, userId) => {
        if (data.socketId === socket.id) {
          // 방에서 사용자 제거
          participants.delete(userId);
          // 다른 참가자들에게 사용자 퇴장 알림
          socket.to(roomId).emit('userLeft', { userId });

          // 방이 비었으면 제거
          if (participants.size === 0) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} is now empty and removed`);
          } else {
            // 참가자 수 업데이트
            io.to(roomId).emit('participant-count', participants.size);
            console.log(`Room ${roomId} now has ${participants.size} participants`);
          }
        }
      });
    });

    // 사용자 매핑 제거
    [...userSocketMap.entries()].filter(([, sid]) => sid === socket.id).forEach(([uid]) => userSocketMap.delete(uid));
  });

  // 재연결 시도 이벤트 처리
  socket.on('reconnect_attempt', (attempt) => {
    console.log(`소켓 재연결 시도 (${attempt}/5)...`);
  });

  // 재연결 성공 이벤트 처리
  socket.on('reconnect', () => {
    console.log('소켓 재연결 성공:', socket?.id);
  });

  // 참가자 목록 요청 이벤트 처리
  socket.on('request-participants', ({ roomId }) => {
    if (rooms.has(roomId)) {
      const participants = Array.from(rooms.get(roomId)).map(([userId, data]) => ({
        userId,
        socketId: data.socketId,
        nickname: data.nickname,
      }));

      // 요청한 사용자에게 현재 참가자 목록 전송
      socket.emit('existing-participants', participants);
      console.log(`Sending participant list for room ${roomId}:`, participants);
    } else {
      console.log(`Room ${roomId} not found for participant request`);
      socket.emit('existing-participants', []);
    }
  });
});

const PORT = 3000;

server.listen(PORT, () => {
  console.log(`== EchoMeet 서버가 시작되었습니다 ==`);
  console.log(`http://localhost:${PORT} 에서 서버 실행 중`);
  console.log(`현재 시간: ${new Date().toISOString()}`);
  console.log('=================================');
});
