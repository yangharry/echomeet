/**
 * WebRTC 서비스 모듈
 *
 * 화상 통화 및 실시간 음성/영상 통신을 위한 WebRTC 관련 기능을 제공합니다.
 * 소켓 통신을 기반으로 P2P 연결을 설정하고 관리합니다.
 */
import { socketService } from './socket';
import { toast } from 'react-hot-toast';
import { Socket } from 'socket.io-client';

/**
 * 피어 연결 정보를 저장하는 인터페이스
 * @property connection - WebRTC 연결 객체
 * @property stream - 원격 사용자의 미디어 스트림
 */
interface PeerConnection {
  connection: RTCPeerConnection;
  stream: MediaStream;
}

/**
 * WebRTC 서비스 클래스
 *
 * 클라이언트 간 P2P 연결 관리, 미디어 스트림 교환, 연결 상태 관리 등
 * WebRTC 통신에 필요한 핵심 기능을 구현합니다.
 */
class WebRTCService {
  // 사용자 ID별 피어 연결 맵
  private peerConnections: Map<string, PeerConnection> = new Map();
  // 로컬 미디어 스트림 (카메라, 마이크)
  private localStream: MediaStream | null = null;
  // 사용자 ID와 닉네임 매핑 저장
  private nicknameMap: Map<string, string> = new Map();
  // 연결이 보류된 사용자 ID 저장 (스트림 준비 등의 이유로)
  private pendingConnections: Set<string> = new Set();
  // 소켓 연결 객체
  private socket: Socket | null = null;
  // Perfect Negotiation을 위한 변수들
  private makingOffer: Map<string, boolean> = new Map(); // 각 피어별 offer 생성 중 상태 추적
  private ignoreOffer: Map<string, boolean> = new Map(); // 각 피어별 offer 무시 상태 추적
  // 연결 생성 관리
  private connectionCreationTime: Map<string, number> = new Map(); // 각 피어 연결 생성 시간
  private static MAX_PEER_CONNECTIONS = 10; // 최대 동시 연결 수
  private static CONNECTION_CLEANUP_INTERVAL = 30000; // 30초마다 오래된 연결 정리
  // 보류 중인 ICE 후보
  private pendingIce: Record<string, RTCIceCandidateInit[]> = {};
  // 마지막 트랙 추가 시간 관리 (반복 호출 방지)
  private lastTrackAddTime: Map<string, number> = new Map();

  // WebRTC 연결 설정 (STUN 서버 정보 등)
  private readonly configuration: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };

  /**
   * WebRTC 서비스 초기화 및 소켓 이벤트 리스너 설정
   * @param socket - 소켓.IO 클라이언트 객체
   */
  initialize(socket: ReturnType<typeof socketService.getSocket>) {
    if (!socket) return;

    this.socket = socket;
    const secureSocket = socket; // TypeScript 타입 가드를 위한 변수

    // 주기적으로 오래된 연결 정리
    setInterval(() => this.cleanupStaleConnections(), WebRTCService.CONNECTION_CLEANUP_INTERVAL);

    // 시그널링 이벤트 처리 (Offer, Answer, ICE Candidate)
    secureSocket.on('signal', async (data: { from: string; signal: RTCSessionDescriptionInit | RTCIceCandidateInit }) => {
      console.log('signal 이벤트 수신:', data);
      const { from, signal } = data;

      // 수신된 from은 서버에서 보내는 사용자 ID
      // 서버에서 동일한 이름의 필드로 userId를 보내고 있음
      const userId = from;
      console.log(`신호 수신: ${from} (처리할 userId: ${userId})`);

      try {
        // 로컬 스트림이 준비되지 않은 경우 연결 지연
        if (!this.localStream) {
          console.warn('로컬 스트림이 준비되지 않아 연결이 지연됩니다.');
          this.pendingConnections.add(userId);
          return;
        }

        // 피어 연결 가져오기 또는 생성
        const existingPeer = this.peerConnections.get(userId);

        // Perfect Negotiation을 위한 polite 여부 결정
        // userId를 기준으로 사전순 비교 (소켓 ID가 아님)
        const myUserId = socketService.getUserId();
        const isPolite = myUserId < userId;
        console.log(`Perfect Negotiation 설정 - 내 ID: ${myUserId}, 상대 ID: ${userId}, 내가 Polite: ${isPolite}`);

        // ==== ICE Candidate 처리 ====
        if ('candidate' in signal) {
          if (!existingPeer || !existingPeer.connection.remoteDescription) {
            // remoteDescription이 없으면 큐에 보관
            console.log(`ICE candidate 수신 - remoteDescription 없음, 큐에 보관: ${userId}`);
            (this.pendingIce[userId] ||= []).push(signal);
            return;
          }

          try {
            console.log(`ICE candidate 추가: ${userId}`);
            await existingPeer.connection.addIceCandidate(new RTCIceCandidate(signal));
            console.log(`ICE candidate 추가 완료: ${userId}`);
          } catch (error) {
            console.error(`ICE candidate 추가 실패: ${userId}`, error);
          }
          return;
        }

        // ==== Offer/Answer 처리 ====
        if ('type' in signal) {
          if (signal.type === 'offer') {
            // 충돌 감지
            const offerCollision = existingPeer && (this.makingOffer.get(userId) || existingPeer.connection.signalingState !== 'stable');

            // impolite 역할이고 충돌 시 자신의 Offer를 유지하고 상대방 Offer 무시
            if (offerCollision && !isPolite) {
              console.log('impolite → 상대 offer 무시');

              if (!this.makingOffer.get(userId)) {
                try {
                  this.makingOffer.set(userId, true);
                  const myOffer = await existingPeer.connection.createOffer();
                  await existingPeer.connection.setLocalDescription(myOffer);
                  this.sendSignal(userId, myOffer);
                } catch (error) {
                  console.error(`impolite 측 offer 생성 중 오류: ${userId}`, error);
                } finally {
                  this.makingOffer.set(userId, false);
                }
              }
              return; // ← 충돌 처리 끝
            }

            let peerConnection: RTCPeerConnection;

            // Offer 처리를 위한 연결 준비
            if (!existingPeer) {
              // 첫 연결 생성
              console.log(`첫 offer 수신, 새 피어 연결 생성: ${userId}`);
              try {
                const peerConnectionObj = await this.createPeerConnection(userId);
                peerConnection = peerConnectionObj.connection;
                console.log(`새 피어 연결 생성 성공: ${userId}`);
              } catch (error) {
                console.error(`새 피어 연결 생성 실패: ${userId}`, error);
                return;
              }
            } else {
              peerConnection = existingPeer.connection;
              console.log(`기존 피어 연결 사용: ${userId}, 상태: ${peerConnection.signalingState}`);

              // polite 역할이고 충돌 상태면 롤백 준비
              if (peerConnection.signalingState !== 'stable') {
                if (isPolite) {
                  console.log(`충돌 상태에서 offer 수신 - polite하므로 롤백 수행: ${userId}`);
                  await peerConnection.setLocalDescription({ type: 'rollback' });
                } else {
                  console.log(`충돌 상태에서 offer 수신 - impolite하지만 재사용: ${userId}`);
                }
              }
            }

            // Offer 처리
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));

            // 보류 중인 ICE 후보가 있으면 처리
            if (this.pendingIce[userId]?.length) {
              console.log(`보류 중인 ICE 후보 처리: ${userId}, ${this.pendingIce[userId].length}개`);
              for (const candidate of this.pendingIce[userId]) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
              }
              delete this.pendingIce[userId];
            }

            // Answer 생성 및 전송
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            this.sendSignal(userId, answer);
            console.log(`Answer 전송: ${userId}`);
          } else if (signal.type === 'answer') {
            if (!existingPeer) {
              console.warn(`Answer 수신했으나 연결이 없음: ${userId}, 무시함`);
              return;
            }

            const pc = existingPeer.connection;

            // Answer는 offer를 보냈을 때만 처리
            if (pc.signalingState === 'have-local-offer') {
              console.log(`Answer 처리: ${userId}`);
              await pc.setRemoteDescription(new RTCSessionDescription(signal));

              // 보류 중인 ICE 후보가 있으면 처리
              if (this.pendingIce[userId]?.length) {
                console.log(`Answer 후 보류 중인 ICE 후보 처리: ${userId}, ${this.pendingIce[userId].length}개`);
                for (const candidate of this.pendingIce[userId]) {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate));
                }
                delete this.pendingIce[userId];
              }

              this.makingOffer.set(userId, false);
            } else {
              console.warn(`Answer 수신, 상태 불일치 (${pc.signalingState}) - 무시`);
            }
          }
        }
      } catch (error) {
        console.error('signal 이벤트 처리 중 오류:', error);
        // 로컬 스트림 오류인 경우 보류 대기열에 추가
        if (error instanceof Error && error.message.includes('Local stream not initialized')) {
          this.pendingConnections.add(userId);
        }
      }
    });

    // 사용자 입장 이벤트 처리
    secureSocket.on('userJoined', async ({ userId, socketId, nickname }) => {
      // 자기 자신은 제외
      if (socketId !== secureSocket.id) {
        this.nicknameMap.set(userId, nickname);

        try {
          // 로컬 스트림이 준비되었는지 여부와 상관없이 피어 연결 생성
          if (this.localStream) {
            console.log(`${nickname}(${userId})와 연결 시도 중...`);
            await this.initiateCall(userId);
            toast(`${nickname}님이 입장했습니다.`);
          } else {
            console.log(`로컬 스트림이 없지만 ${nickname}(${userId})와 연결 생성 시도...`);
            // 더미 스트림 생성 (임시 연결용)
            const dummyStream = new MediaStream();
            this.localStream = dummyStream;
            await this.initiateCall(userId);
            toast(`${nickname}님이 입장했습니다. (비디오/오디오 없음)`);
            this.localStream = null; // 다시 null로 설정
          }
        } catch (error) {
          console.error(`${nickname}(${userId})와 연결 실패:`, error);
          this.pendingConnections.add(userId);
        }
      }
    });

    // 기존 참가자 정보 수신 이벤트 처리
    secureSocket.on('existing-participants', async (participants) => {
      console.log('기존 참가자 정보 수신:', participants);
      // 알림 표시 없이 연결만 설정
      for (const { userId, socketId, nickname } of participants) {
        // 자기 자신은 제외
        if (socketId !== secureSocket.id) {
          this.nicknameMap.set(userId, nickname);

          try {
            // 로컬 스트림이 준비되었는지 여부와 상관없이 피어 연결 생성
            if (this.localStream) {
              console.log(`${nickname}(${userId})와 연결 시도 중...`);
              await this.initiateCall(userId);
            } else {
              console.log(`로컬 스트림이 없지만 ${nickname}(${userId})와 연결 생성 시도...`);
              // 더미 스트림 생성 (임시 연결용)
              const dummyStream = new MediaStream();
              this.localStream = dummyStream;
              await this.initiateCall(userId);
              this.localStream = null; // 다시 null로 설정
            }
          } catch (error) {
            console.error(`${nickname}(${userId})와 연결 실패:`, error);
            this.pendingConnections.add(userId);

            // 실패해도 일정 시간 후에 재시도
            setTimeout(() => {
              if (this.pendingConnections.has(userId)) {
                console.log(`${nickname}(${userId})와 재연결 시도 중...`);
                try {
                  // 로컬 스트림이 없어도 연결 시도
                  if (!this.localStream) {
                    const dummyStream = new MediaStream();
                    this.localStream = dummyStream;
                    this.initiateCall(userId).catch((e) => console.error(`재시도 중 오류: ${nickname}(${userId})`, e));
                    this.localStream = null;
                  } else {
                    this.initiateCall(userId).catch((e) => console.error(`재시도 중 오류: ${nickname}(${userId})`, e));
                  }
                } catch (e) {
                  console.error(`재시도 설정 중 오류: ${nickname}(${userId})`, e);
                }
              }
            }, 2000);
          }
        }
      }
    });

    // 사용자 퇴장 이벤트 처리
    secureSocket.on('userLeft', ({ userId }) => {
      console.log('참가자 퇴장:', userId);
      const nickname = this.nicknameMap.get(userId) || '알 수 없음';
      toast(`${nickname}님이 퇴장했습니다.`);
      // 연결 제거 및 정리
      this.removePeerConnection(userId);
      // 보류 대기열에서도 제거
      this.pendingConnections.delete(userId);
    });

    // 사용자 재접속 이벤트 처리
    secureSocket.on('userRejoined', async ({ userId, socketId, nickname }) => {
      console.log('참가자 재접속 이벤트 수신:', userId, socketId, nickname);

      // 디버깅을 위한 알림 사용
      try {
        toast(`${nickname}님이 입장했습니다.`);
      } catch (e) {
        console.error('알림 표시 오류:', e);
      }

      // 자기 자신은 제외
      if (socketId !== secureSocket.id) {
        // 기존 연결이 있으면 제거
        this.removePeerConnection(userId);

        // 닉네임 맵 업데이트
        this.nicknameMap.set(userId, nickname);

        // 로컬 스트림이 준비되었는지 확인
        if (this.localStream) {
          try {
            await this.initiateCall(userId);
            toast(`${nickname}님이 입장했습니다.`);
          } catch {
            // 실패한 경우 보류 대기열에 추가
            this.pendingConnections.add(userId);
          }
        } else {
          console.log(`로컬 스트림이 준비되지 않아 ${nickname}(${userId})와의 재연결이 지연됩니다.`);
          this.pendingConnections.add(userId);
        }
      }
    });
  }

  /**
   * 로컬 미디어 스트림 설정 및 기존 연결에 적용
   * @param stream - 로컬 미디어 스트림 (카메라/마이크 또는 화면 공유)
   */
  async setLocalStream(stream: MediaStream) {
    // 스트림 타입 로깅
    const videoTrack = stream.getVideoTracks()[0];
    console.log('setLocalStream 호출됨:', {
      트랙수: stream.getTracks().length,
      비디오: stream.getVideoTracks().length > 0,
      오디오: stream.getAudioTracks().length > 0,
      비디오종류: videoTrack?.kind,
      비디오설정: videoTrack?.getSettings(),
    });

    // 새 스트림으로 업데이트
    this.localStream = stream;

    // 기존 연결이 있는 경우 모두 닫고 새로 연결 시작
    if (this.peerConnections.size > 0) {
      console.log('기존 연결 모두 닫고 새로 시작:', this.peerConnections.size);

      // 기존 연결된 피어들의 ID 저장
      const existingPeers = Array.from(this.peerConnections.keys());

      // 모든 연결 닫기
      for (const userId of existingPeers) {
        console.log(`${userId}와의 기존 연결 종료`);
        this.removePeerConnection(userId);
      }

      // 잠시 지연 후 새 연결 시작
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 모든 피어와 새로운 연결 시작
      for (const userId of existingPeers) {
        try {
          console.log(`${userId}와 새 연결 시작`);
          await this.initiateCall(userId);
        } catch (error) {
          console.error(`${userId}와의 새 연결 실패:`, error);
          // 실패한 경우 보류 목록에 추가
          this.pendingConnections.add(userId);
        }
      }
    } else {
      console.log('피어 연결 없음, 새 연결 대기');
    }

    // 스트림이 설정된 후 보류 중인 연결 처리
    if (this.pendingConnections.size > 0) {
      const pendingConnections = Array.from(this.pendingConnections);
      this.pendingConnections.clear();
      console.log('보류 중인 연결 처리:', pendingConnections.length);

      // 보류 중인 연결 시도
      for (const userId of pendingConnections) {
        try {
          console.log(`보류 중이던 ${userId}와 연결 시도`);
          await this.initiateCall(userId);
        } catch (error) {
          console.error(`보류 중이던 ${userId}와 연결 실패:`, error);
          this.pendingConnections.add(userId);
        }
      }
    }
  }

  getLocalStream() {
    return this.localStream;
  }

  getRemoteStreams(): { userId: string; stream: MediaStream; nickname: string }[] {
    const streams = Array.from(this.peerConnections.entries()).map(([userId, { stream }]) => ({
      userId,
      stream,
      nickname: this.nicknameMap.get(userId) || 'Unknown',
    }));

    console.log('WebRTC 서비스 - 피어 연결 상태:', {
      연결수: this.peerConnections.size,
      닉네임맵: Array.from(this.nicknameMap.entries()),
      스트림: streams.length,
    });

    return streams;
  }

  // RTP 송신자 목록 반환 (비트레이트 조정 등에 활용)
  getSenders(): RTCRtpSender[] {
    const senders: RTCRtpSender[] = [];
    this.peerConnections.forEach(({ connection }) => {
      connection.getSenders().forEach((sender) => {
        senders.push(sender);
      });
    });
    return senders;
  }

  // 특정 트랙 유형의 송신자만 반환 (video/audio)
  getTrackSenders(kind: 'video' | 'audio'): RTCRtpSender[] {
    return this.getSenders().filter((sender) => sender.track && sender.track.kind === kind);
  }

  // 모든 피어 연결에 비트레이트 설정 적용
  async setVideoSendBitrate(maxBitrate: number): Promise<void> {
    const videoSenders = this.getTrackSenders('video');

    for (const sender of videoSenders) {
      try {
        const params = sender.getParameters();
        if (!params.encodings) {
          params.encodings = [{}];
        }

        // 각 인코딩 레이어에 비트레이트 설정
        params.encodings.forEach((encoding) => {
          encoding.maxBitrate = maxBitrate;
        });

        await sender.setParameters(params);
        console.log(`비디오 송신자 비트레이트 설정: ${maxBitrate}bps`);
      } catch (error) {
        console.error('비트레이트 설정 오류:', error);
      }
    }
  }

  async initiateCall(userId: string) {
    console.log(`${userId}에 대한 initiateCall 호출됨`);
    try {
      // 피어 연결 생성 또는 가져오기
      const peerConnection = await this.createPeerConnection(userId);

      // 새 참가자 판단 (이벤트 발생 시점에 따라)
      const myUserId = socketService.getUserId();
      const isNewParticipant = false; // 기본값: 기존 참가자가 새로운 사람에게 연결 요청

      // 새 참가자만 offer 전송, 기존 참가자는 트랙만 추가하고 onnegotiationneeded가 처리하도록 함
      const isPolite = myUserId < userId;

      if (isNewParticipant || isPolite) {
        // Perfect Negotiation을 위한 offer 생성 플래그 설정
        try {
          // 이미 offer 생성 중이면 중복 실행 방지
          if (this.makingOffer.get(userId)) {
            console.log(`이미 ${userId}에 대한 offer 생성 중임`);
            return;
          }

          this.makingOffer.set(userId, true);

          // 시그널링 상태 확인 (충돌 방지)
          if (peerConnection.connection.signalingState !== 'stable') {
            console.log(`시그널링 상태가 stable이 아님 (${peerConnection.connection.signalingState}), offer 생성 취소`);
            this.makingOffer.set(userId, false);
            return;
          }

          const offer = await peerConnection.connection.createOffer();

          // createOffer 후 상태 확인
          if (peerConnection.connection.signalingState !== 'stable') {
            console.log(`offer 생성 후 상태가 변경됨, offer 폐기`);
            this.makingOffer.set(userId, false);
            return;
          }

          await peerConnection.connection.setLocalDescription(offer);
          this.sendSignal(userId, offer);

          console.log(`${userId}에게 offer 전송 완료`);
        } catch (error) {
          console.error(`${userId}에게 offer 전송 실패:`, error);
        } finally {
          this.makingOffer.set(userId, false);
        }
      } else {
        console.log(`${userId}에게 offer를 보내지 않고 트랙만 추가함 (onnegotiationneeded 이벤트에 의해 처리될 것임)`);
      }

      return peerConnection;
    } catch (error) {
      console.error(`initiateCall 실패: ${userId}`, error);
      throw error;
    }
  }

  /**
   * 피어 연결 생성 및 설정
   * @param remoteUserId 원격 사용자 ID
   * @returns 생성된 피어 연결 객체
   */
  private async createPeerConnection(remoteUserId: string): Promise<PeerConnection> {
    // 기존 연결이 있으면 반환
    const existingConnection = this.peerConnections.get(remoteUserId);
    if (existingConnection) {
      return existingConnection;
    }

    console.log(`${remoteUserId}와 새 피어 연결 생성 중...`);

    if (!this.localStream) {
      throw new Error(`Local stream not initialized (${remoteUserId})`);
    }

    // 연결 제한 초과 처리
    if (this.peerConnections.size >= WebRTCService.MAX_PEER_CONNECTIONS) {
      console.warn(`최대 연결 수 초과 (${WebRTCService.MAX_PEER_CONNECTIONS}), 오래된 연결 정리`);
      this.cleanupOldestConnection();
    }

    const myUserId = socketService.getUserId();
    const isPolite = myUserId < remoteUserId;
    console.log(`Perfect Negotiation 설정 - 내 ID: ${myUserId}, 상대 ID: ${remoteUserId}, 내가 Polite: ${isPolite}`);

    // RTCPeerConnection 생성 및 설정
    const peerConnection = new RTCPeerConnection(this.configuration);

    // 연결 생성 시간 기록
    this.connectionCreationTime.set(remoteUserId, Date.now());

    // 원격 스트림 생성
    const newRemoteStream = new MediaStream();

    // 트랙 이벤트 리스너 설정 (트랙 추가는 여기서 하지 않음)
    this.setupTrackListeners(peerConnection, newRemoteStream, remoteUserId);

    // 모든 로컬 트랙 추가 (트랙이 있는 경우에만)
    if (this.localStream && this.localStream.getTracks().length > 0) {
      console.log(`createPeerConnection: ${remoteUserId}와의 연결에 ${this.localStream.getTracks().length}개 트랙 추가 시작`);

      // 추가 시간 업데이트
      this.lastTrackAddTime.set(remoteUserId, Date.now());

      this.localStream.getTracks().forEach((track) => {
        try {
          console.log(`createPeerConnection: ${remoteUserId}에게 트랙 추가: ${track.kind}, 활성화: ${track.enabled}, ID: ${track.id}`);
          peerConnection.addTrack(track, this.localStream!);
        } catch (e) {
          console.error('트랙 추가 오류:', e);
        }
      });
    } else {
      console.log('로컬 스트림에 트랙이 없습니다. 비디오/오디오 없이 연결합니다.');
    }

    // 피어 연결 객체 생성 및 저장
    const peerConnectionObj: PeerConnection = {
      connection: peerConnection,
      stream: newRemoteStream,
    };

    this.peerConnections.set(remoteUserId, peerConnectionObj);

    return peerConnectionObj;
  }

  private setupTrackListeners(peerConnection: RTCPeerConnection, remoteStream: MediaStream, remoteUserId: string) {
    peerConnection.ontrack = (event) => {
      console.log(`트랙 수신됨 (${remoteUserId}): ${event.track.kind}, 활성화: ${event.track.enabled}, 트랙ID: ${event.track.id}`);

      // 트랙 메타데이터 로깅
      console.log(`트랙 설정:`, {
        ID: event.track.id,
        종류: event.track.kind,
        레이블: event.track.label || '레이블 없음',
        제약조건: event.track.getConstraints(),
      });

      // 트랙이 수신되면 활성화 상태로 설정
      event.track.enabled = true;

      // 화면 공유 여부 감지 (레이블 및 설정값 활용)
      const trackSettings = event.track.getSettings();
      const isScreen =
        (event.track.label &&
          (event.track.label.toLowerCase().includes('screen') ||
            event.track.label.toLowerCase().includes('window') ||
            event.track.label.toLowerCase().includes('tab') ||
            event.track.label.toLowerCase().includes('display'))) ||
        (trackSettings && trackSettings.displaySurface) || // displaySurface 속성 확인
        (event.track.kind === 'video' && trackSettings && (trackSettings.width || 0) > 1000 && (trackSettings.height || 0) > 700); // 해상도가 큰 비디오는 화면 공유로 취급

      console.log(`트랙 타입 감지: ${isScreen ? '화면 공유' : '일반'}, 설정값:`, trackSettings);

      // 트랙을 즉시 추가하고 스트림 업데이트
      if (event.streams && event.streams.length > 0) {
        try {
          const incomingStream = event.streams[0];
          console.log(`수신 스트림 정보: ID=${incomingStream.id}, 트랙 수=${incomingStream.getTracks().length}`);

          // 화면 공유 트랙인 경우
          if (isScreen && event.track.kind === 'video') {
            // 화면 공유 트랙이 있다면 별도로 관리
            // 화면 공유가 들어오면 해당 트랙은 그대로 추가만 함
            console.log(`화면 공유 트랙 추가: ${event.track.id}`);

            // 기존에 화면 공유 트랙이 있으면 제거
            const existingScreenTracks = remoteStream
              .getVideoTracks()
              .filter(
                (track) =>
                  track.label &&
                  (track.label.toLowerCase().includes('screen') ||
                    track.label.toLowerCase().includes('window') ||
                    track.label.toLowerCase().includes('tab') ||
                    track.label.toLowerCase().includes('display'))
              );

            existingScreenTracks.forEach((track) => {
              console.log(`기존 화면 공유 트랙 제거: ${track.id}`);
              remoteStream.removeTrack(track);
            });

            // 새 화면 공유 트랙 추가
            remoteStream.addTrack(event.track);
          } else {
            // 일반 트랙인 경우(오디오 또는 카메라 비디오), 동일 종류의 일반 트랙만 제거
            const existingTrack = remoteStream.getTracks().find(
              (t) =>
                t.kind === event.track.kind &&
                // 화면 공유 트랙은 제외
                !(
                  t.label &&
                  (t.label.toLowerCase().includes('screen') ||
                    t.label.toLowerCase().includes('window') ||
                    t.label.toLowerCase().includes('tab') ||
                    t.label.toLowerCase().includes('display'))
                )
            );

            if (existingTrack) {
              console.log(`기존 ${event.track.kind} 트랙 제거: ${existingTrack.id}`);
              remoteStream.removeTrack(existingTrack);
            }

            // 새 트랙 추가
            console.log(`원격 스트림에 ${event.track.kind} 트랙 추가: ${event.track.id}, isScreen=${isScreen}`);
            remoteStream.addTrack(event.track);
          }

          // 화면 공유면 알림 표시
          if (isScreen) {
            console.log(`화면 공유 감지: ${this.nicknameMap.get(remoteUserId) || '상대방'}의 화면이 공유됨`);
            toast(`${this.nicknameMap.get(remoteUserId) || '상대방'}이(가) 화면을 공유하기 시작했습니다.`);
          }
        } catch (error) {
          console.error('트랙 처리 중 오류:', error);
        }
      } else {
        // 스트림 없이 개별 트랙만 온 경우 (보통 화면 공유)
        try {
          // 화면 공유 트랙인 경우
          if (isScreen && event.track.kind === 'video') {
            // 기존에 화면 공유 트랙이 있으면 제거
            const existingScreenTracks = remoteStream
              .getVideoTracks()
              .filter(
                (track) =>
                  track.label &&
                  (track.label.toLowerCase().includes('screen') ||
                    track.label.toLowerCase().includes('window') ||
                    track.label.toLowerCase().includes('tab') ||
                    track.label.toLowerCase().includes('display'))
              );

            existingScreenTracks.forEach((track) => {
              console.log(`기존 화면 공유 트랙 제거 (직접): ${track.id}`);
              remoteStream.removeTrack(track);
            });

            // 새 화면 공유 트랙 추가
            console.log(`원격 스트림에 화면 공유 트랙 직접 추가: ${event.track.id}`);
            remoteStream.addTrack(event.track);
          } else {
            // 일반 트랙인 경우(오디오 또는 카메라 비디오), 동일 종류의 일반 트랙만 제거
            const existingTrack = remoteStream.getTracks().find(
              (t) =>
                t.kind === event.track.kind &&
                // 화면 공유 트랙은 제외
                !(
                  t.label &&
                  (t.label.toLowerCase().includes('screen') ||
                    t.label.toLowerCase().includes('window') ||
                    t.label.toLowerCase().includes('tab') ||
                    t.label.toLowerCase().includes('display'))
                )
            );

            if (existingTrack) {
              console.log(`기존 ${event.track.kind} 트랙 제거 (직접): ${existingTrack.id}`);
              remoteStream.removeTrack(existingTrack);
            }

            // 새 트랙 추가
            console.log(`원격 스트림에 ${event.track.kind} 트랙 직접 추가: ${event.track.id}`);
            remoteStream.addTrack(event.track);
          }

          // 화면 공유면 알림 표시
          if (isScreen) {
            console.log(`화면 공유 감지 (개별 트랙): ${this.nicknameMap.get(remoteUserId) || '상대방'}의 화면이 공유됨`);
            toast(`${this.nicknameMap.get(remoteUserId) || '상대방'}이(가) 화면을 공유하기 시작했습니다.`);
          }
        } catch (error) {
          console.error('개별 트랙 처리 중 오류:', error);
        }
      }
    };

    // 협상 필요 이벤트 처리 개선
    let negotiationDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    peerConnection.onnegotiationneeded = async () => {
      // 이미 내가 offer를 만들고 있다면 아무 것도 안 함
      if (this.makingOffer.get(remoteUserId)) return;

      // 디바운스 처리로 300ms 이내에 들어온 다수의 요청 무시
      if (negotiationDebounceTimer) {
        clearTimeout(negotiationDebounceTimer);
      }

      negotiationDebounceTimer = setTimeout(async () => {
        // 이 시점에서도 flag 확인
        if (this.makingOffer.get(remoteUserId)) return;

        this.makingOffer.set(remoteUserId, true);
        try {
          /* --------------------------------------------
             ① createOffer() 전에 한 번 더 상태 점검
          ---------------------------------------------*/
          if (peerConnection.signalingState !== 'stable') {
            console.log(`(negotiation) 이미 stable 아님 → 종료: ${remoteUserId}`);
            this.makingOffer.set(remoteUserId, false); // 여기서도 flag 복원
            return;
          }

          console.log(`새 offer 생성 중: ${remoteUserId}`);
          const offer = await peerConnection.createOffer();

          /* --------------------------------------------
             ② createOffer() 동안 원격 Offer가 들어올 수도 있음
                다시 stable 인지 확인
          ---------------------------------------------*/
          if (peerConnection.signalingState !== 'stable') {
            console.log(`createOffer 후 상태 변동! offer 폐기: ${remoteUserId}`);
            this.makingOffer.set(remoteUserId, false); // 여기서도 flag 복원
            return; // setLocalDescription 하지 않는다
          }

          await peerConnection.setLocalDescription(offer);
          this.sendSignal(remoteUserId, peerConnection.localDescription!);
          console.log(`협상 필요로 인한 offer 전송 완료: ${remoteUserId}`);
        } catch (err) {
          console.warn(`자동 협상 중 오류 (${remoteUserId})`, err);
        } finally {
          this.makingOffer.set(remoteUserId, false);
        }
      }, 300); // 300ms 디바운스
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(`ICE 연결 상태 변경 (${remoteUserId}): ${peerConnection.iceConnectionState}`);

      // ICE 연결 문제 탐지 및 복구 시도
      if (peerConnection.iceConnectionState === 'failed') {
        // ICE 재시작 시도
        console.log(`ICE 연결 실패, 재시작 시도 (${remoteUserId})`);
        this.restartIce(remoteUserId, peerConnection);
      }
    };

    // onconnectionstatechange 이벤트 핸들러 개선
    peerConnection.onconnectionstatechange = () => {
      console.log(`연결 상태 변경 (${remoteUserId}): ${peerConnection.connectionState}`);

      switch (peerConnection.connectionState) {
        case 'connected':
          toast(`${this.nicknameMap.get(remoteUserId) || '상대방'}과 연결되었습니다.`);
          // 성공적으로 연결되면 재연결 시도 횟수 초기화 (추가할 수 있음)
          break;
        case 'disconnected':
          // 연결이 끊어진 경우 즉시 재연결을 시도하지 않고 상태만 알림
          console.log(`${remoteUserId}와의 연결이 일시적으로 끊어졌습니다. 자동 재연결을 시도합니다.`);
          // 5초 후에 여전히 disconnected 상태이면 재연결 시도
          setTimeout(() => {
            // 이미 연결이 제거되었거나 재연결이 진행 중인지 확인
            if (!this.peerConnections.has(remoteUserId)) {
              console.log(`${remoteUserId}와의 연결이 이미 제거됨`);
              return;
            }

            const currentConnection = this.peerConnections.get(remoteUserId)?.connection;
            if (!currentConnection || currentConnection !== peerConnection) {
              console.log(`${remoteUserId}와의 연결이 이미 변경됨`);
              return;
            }

            if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
              console.log(`${remoteUserId}와의 연결 복구 시도...`);
              this.removePeerConnection(remoteUserId);

              // 재연결 시도를 예약하여 즉시 실행 방지 (무한 재귀 방지)
              this.pendingConnections.add(remoteUserId);
              setTimeout(() => {
                if (this.pendingConnections.has(remoteUserId)) {
                  console.log(`${remoteUserId}에 대한 지연된 재연결 시도...`);
                  this.pendingConnections.delete(remoteUserId);
                  this.initiateCall(remoteUserId).catch((err) => {
                    console.error(`${remoteUserId}와의 재연결 실패:`, err);
                    // 재연결 실패 시 보류 목록에 다시 추가
                    this.pendingConnections.add(remoteUserId);
                  });
                }
              }, 2000);
            }
          }, 5000);
          break;
        case 'failed':
          console.log(`${remoteUserId}와의 연결이 실패했습니다. 재연결 시도...`);
          // 연결이 완전히 실패한 경우 기존 연결을 정리하고 새로운 연결 시도
          this.removePeerConnection(remoteUserId);

          // 재연결 시도를 예약하여 즉시 실행 방지 (무한 재귀 방지)
          this.pendingConnections.add(remoteUserId);
          setTimeout(() => {
            if (this.pendingConnections.has(remoteUserId)) {
              console.log(`${remoteUserId}에 대한 지연된 재연결 시도...`);
              this.pendingConnections.delete(remoteUserId);
              this.initiateCall(remoteUserId).catch((err) => {
                console.error(`${remoteUserId}와의 재연결 실패:`, err);
                // 재연결 실패 시 보류 목록에 다시 추가
                this.pendingConnections.add(remoteUserId);
                // 사용자에게 연결 문제 알림
                toast(`${this.nicknameMap.get(remoteUserId) || '상대방'}과의 연결에 문제가 있습니다. 재연결을 시도합니다.`);
              });
            }
          }, 2000);
          break;
      }
    };

    // ICE 후보 처리
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`ICE 후보 생성 (${remoteUserId}): ${event.candidate.type || '표준'}`);

        // ICE 후보를 모아서 보내기 위해 약간의 지연 추가
        setTimeout(() => {
          if (peerConnection.iceGatheringState !== 'complete' && event.candidate) {
            this.sendSignal(remoteUserId, event.candidate.toJSON());
          }
        }, 100);
      } else {
        console.log(`ICE 후보 수집 완료 (${remoteUserId})`);
      }
    };

    // 매핑 저장
    this.peerConnections.set(remoteUserId, {
      connection: peerConnection,
      stream: remoteStream,
    });

    return peerConnection;
  }

  removePeerConnection(userId: string) {
    const peerConnection = this.peerConnections.get(userId)?.connection;
    if (peerConnection) {
      peerConnection.close();
      this.peerConnections.delete(userId);
      // 연관 데이터도 함께 정리
      this.connectionCreationTime.delete(userId);
      this.makingOffer.delete(userId);
      this.ignoreOffer.delete(userId);

      // pendingIce 엔트리도 삭제하여 메모리 누수 방지
      delete this.pendingIce[userId];
    }
  }

  closeAllConnections() {
    this.peerConnections.forEach(({ connection }) => connection.close());
    this.peerConnections.clear();
    this.nicknameMap.clear();
    this.localStream = null;
  }

  sendSignal(to: string, signal: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    // to: userId, signal: 시그널 데이터
    if (!this.socket) return;

    // ICE candidate인 경우 type 속성이 없으므로 조건부로 표시
    const signalType = 'type' in signal ? signal.type : 'ICE candidate';
    console.log(`시그널 전송 (${to})`, signalType);

    // 서버가 'to'로 userId를 기대하기 때문에 userId로 보냄
    this.socket.emit('signal', {
      to: to, // 상대방 userId
      from: socketService.getUserId(), // 내 userId
      signal,
    });
  }

  // ICE 재시작 메서드 개선
  private async restartIce(userId: string, peerConnection: RTCPeerConnection) {
    try {
      // 이미 제거된 연결인지 확인
      if (!this.peerConnections.has(userId)) {
        console.log(`ICE 재시작 취소: ${userId}에 대한 연결이 이미 제거됨`);
        return;
      }

      // 현재 연결이 전달된 연결과 같은지 확인
      const currentConnection = this.peerConnections.get(userId)?.connection;
      if (!currentConnection || currentConnection !== peerConnection) {
        console.log(`ICE 재시작 취소: ${userId}에 대한 연결이 이미 변경됨`);
        return;
      }

      // ICE 재시작을 위한 새로운 offer 생성
      const offer = await peerConnection.createOffer({ iceRestart: true });
      await peerConnection.setLocalDescription(offer);

      console.log(`ICE 재시작 offer 생성 및 전송 (${userId})`);
      this.sendSignal(userId, offer);
    } catch (error) {
      console.error(`ICE 재시작 실패 (${userId}):`, error);
      // 재시작 실패 시 연결 다시 생성
      this.removePeerConnection(userId);

      // 재연결 예약 (지연 실행으로 무한 재귀 방지)
      this.pendingConnections.add(userId);
      setTimeout(() => {
        if (this.pendingConnections.has(userId)) {
          console.log(`ICE 재시작 후 지연된 재연결 시도: ${userId}`);
          this.pendingConnections.delete(userId);
          this.initiateCall(userId).catch((err) => {
            console.error(`ICE 재시작 후 재연결 실패 (${userId}):`, err);
            this.pendingConnections.add(userId);
          });
        }
      }, 2000);
    }
  }

  // 가장 오래된 연결 정리
  private cleanupOldestConnection() {
    if (this.peerConnections.size === 0) return;

    // 연결 시간순으로 정렬
    const sortedConnections = Array.from(this.connectionCreationTime.entries()).sort((a, b) => a[1] - b[1]);

    if (sortedConnections.length > 0) {
      const oldestUserId = sortedConnections[0][0];
      console.log(`가장 오래된 연결 제거: ${oldestUserId}`);
      this.removePeerConnection(oldestUserId);
      this.pendingConnections.add(oldestUserId); // 나중에 재연결 시도
    }
  }

  // 오래된 연결 정리 (30초 이상 사용하지 않은 연결)
  private cleanupStaleConnections() {
    const now = Date.now();
    const staleTime = 60000; // 1분 이상 된 연결은 오래된 것으로 간주

    // 연결 상태 로깅
    console.log(`연결 상태 점검 - 현재 ${this.peerConnections.size}개 연결, ${this.pendingConnections.size}개 보류 중`);

    let cleanedCount = 0;

    // 각 연결의 상태 확인
    for (const [userId, { connection }] of this.peerConnections.entries()) {
      const creationTime = this.connectionCreationTime.get(userId) || 0;
      const age = now - creationTime;

      // 오래된 연결이고 현재 연결 상태가 좋지 않은 경우
      if (
        age > staleTime &&
        (connection.connectionState === 'disconnected' ||
          connection.connectionState === 'failed' ||
          connection.iceConnectionState === 'disconnected' ||
          connection.iceConnectionState === 'failed')
      ) {
        console.log(`오래된 연결 정리: ${userId} (${Math.round(age / 1000)}초, 상태: ${connection.connectionState})`);
        this.removePeerConnection(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`${cleanedCount}개의 오래된 연결 정리 완료`);
    }
  }
}

export const webRTCService = new WebRTCService();
