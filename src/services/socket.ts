/**
 * Socket.IO 클라이언트 서비스 모듈
 *
 * 실시간 통신을 위한 소켓 연결 관리 및 이벤트 처리 기능을 제공합니다.
 * 화상 회의에 필요한 시그널링, 채팅, 사용자 참여 등의 이벤트를 처리합니다.
 */
import { io, Socket } from 'socket.io-client';

/**
 * 서버에서 클라이언트로 전송되는 이벤트 인터페이스
 * 소켓 서버가 클라이언트에게 보내는 이벤트 타입을 정의합니다.
 */
interface ServerToClientEvents {
  signal: (data: { from: string; signal: RTCSessionDescriptionInit | RTCIceCandidateInit }) => void; // WebRTC 시그널링 수신
  userJoined: (data: { userId: string; socketId: string; nickname: string }) => void; // 사용자 입장
  userRejoined: (data: { userId: string; socketId: string; nickname: string }) => void; // 사용자 재접속
  userLeft: (data: { userId: string }) => void; // 사용자 퇴장
  'participant-count': (count: number) => void; // 참가자 수 업데이트
  'existing-participants': (participants: { userId: string; socketId: string; nickname: string }[]) => void; // 기존 참가자 목록
  receiveMessage: (message: { id: string; senderId: string; senderNickname: string; content: string; timestamp: number }) => void; // 채팅 메시지 수신
  connect: () => void; // 소켓 연결 완료
  connect_error: (err: Error) => void; // 소켓 연결 오류
  disconnect: () => void; // 소켓 연결 해제
  reconnect_attempt: (attempt: number) => void; // 재연결 시도
  reconnect: () => void; // 재연결 성공
}

/**
 * 클라이언트에서 서버로 전송되는 이벤트 인터페이스
 * 클라이언트가 서버에게 보내는 이벤트 타입을 정의합니다.
 */
interface ClientToServerEvents {
  'join-room': (data: { roomId: string; userId: string; nickname: string }) => void; // 방 입장
  'leave-room': (data: { roomId: string; userId: string }) => void; // 방 퇴장
  signal: (data: { to: string; from: string; signal: RTCSessionDescriptionInit | RTCIceCandidateInit }) => void; // WebRTC 시그널링 전송
  'chat-message': (data: { roomId: string; id: string; senderId: string; senderNickname: string; content: string; timestamp: number }) => void; // 채팅 메시지 전송
  'request-participants': (data: { roomId: string }) => void; // 기존 참가자 요청
}

// Vite 환경 변수에서 서버 URL 가져오기 (기본값 설정)
const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.0.47:3000';

/**
 * 소켓 서비스 클래스
 *
 * 소켓.IO 클라이언트 연결을 관리하고 실시간 이벤트 통신을 제공합니다.
 * 화상 회의에 필요한 방 입장/퇴장, 메시지 전송, 시그널링 등의 기능을 구현합니다.
 */
class SocketService {
  // 소켓 인스턴스 (연결되지 않은 경우 null)
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

  /**
   * 소켓 서버에 연결하는 메서드
   * 이미 연결된 경우 기존 연결을 반환하고, 아닌 경우 새 연결을 생성합니다.
   * @returns 연결된 소켓 객체 또는 연결 실패 시 null
   */
  connect() {
    try {
      // 이미 연결된 소켓이 있으면 재사용
      if (this.socket && this.socket.connected) {
        return this.socket;
      }

      console.log(`소켓 서버에 연결 중: ${API_URL}`);

      // 소켓 연결
      this.socket = io(API_URL, {
        transports: ['websocket', 'polling'], // polling 추가하여 fallback 제공
        reconnectionAttempts: 5, // 재연결 시도 횟수
        reconnectionDelay: 1000,
        timeout: 20000, // 타임아웃 시간
        forceNew: true, // 새로운 연결 강제 (문제 해결 위해)
        autoConnect: true, // 자동 연결 활성화
      });

      // 디버깅을 위한 이벤트 리스너
      this.socket.on('connect', () => {
        console.log('소켓 연결 성공:', this.socket?.id);
      });

      this.socket.on('connect_error', (err) => {
        console.error('소켓 연결 오류:', err.message);
      });

      return this.socket;
    } catch (error) {
      console.error('소켓 초기화 중 오류:', error);
      return null;
    }
  }

  /**
   * 현재 소켓 연결 객체를 반환하는 메서드
   * @returns 소켓 객체 또는 연결되지 않은 경우 null
   */
  getSocket() {
    return this.socket;
  }

  /**
   * 특정 방에 입장하는 메서드
   * @param roomId - 입장할 방의 ID
   * @param userId - 사용자 ID
   * @param nickname - 사용자 닉네임
   */
  joinRoom(roomId: string, userId: string, nickname: string) {
    if (!this.socket) {
      console.error('소켓이 연결되지 않았습니다. 방 입장 실패.');
      return;
    }
    console.log(`방 입장 시도: ${roomId}, 사용자: ${nickname}(${userId})`);
    this.socket.emit('join-room', { roomId, userId, nickname });
  }

  /**
   * 특정 방에서 퇴장하는 메서드
   * @param roomId - 퇴장할 방의 ID
   * @param userId - 사용자 ID
   */
  leaveRoom(roomId: string, userId: string) {
    if (!this.socket) {
      console.error('소켓이 연결되지 않았습니다. 방 퇴장 실패.');
      return;
    }
    console.log(`방 퇴장: ${roomId}, 사용자 ID: ${userId}`);
    this.socket.emit('leave-room', { roomId, userId });
  }

  /**
   * WebRTC 시그널링 데이터를 전송하는 메서드
   * @param to - 데이터를 전송할 대상 사용자 ID
   * @param signal - 전송할 시그널링 데이터 (Offer, Answer, ICE Candidate)
   */
  sendSignal(to: string, signal: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    if (!this.socket) {
      console.error('소켓이 연결되지 않았습니다. 시그널링 실패.');
      return;
    }
    this.socket.emit('signal', { to, from: this.socket.id!, signal });
  }

  /**
   * 채팅 메시지를 전송하는 메서드
   * @param roomId - 메시지를 전송할 방 ID
   * @param id - 메시지 고유 ID
   * @param senderId - 발신자 ID
   * @param senderNickname - 발신자 닉네임
   * @param content - 메시지 내용
   * @returns 전송된 메시지 객체
   */
  sendMessage(roomId: string, id: string, senderId: string, senderNickname: string, content: string) {
    if (!this.socket) {
      console.error('소켓이 연결되지 않았습니다. 메시지 전송 실패.');
      return { id, senderId, senderNickname, content, timestamp: Date.now() };
    }
    const timestamp = Date.now();
    this.socket.emit('chat-message', { roomId, id, senderId, senderNickname, content, timestamp });
    return { id, senderId, senderNickname, content, timestamp };
  }

  /**
   * 현재 방 참가자 목록 요청 메서드
   * @param roomId - 정보를 요청할 방 ID
   */
  requestParticipants(roomId: string) {
    if (!this.socket) {
      console.error('소켓이 연결되지 않았습니다. 참가자 목록 요청 실패.');
      return;
    }
    console.log(`방 참가자 목록 요청: ${roomId}`);
    this.socket.emit('request-participants', { roomId });
  }

  /**
   * 소켓 연결을 종료하는 메서드
   * 모든 리스너를 정리하고 연결을 해제합니다.
   */
  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}

// 소켓 서비스의 싱글톤 인스턴스 생성 및 내보내기
export const socketService = new SocketService();
