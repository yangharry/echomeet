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

  // WebRTC 연결 설정 (STUN 서버 정보 등)
  private readonly configuration: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
  };

  /**
   * WebRTC 서비스 초기화 및 소켓 이벤트 리스너 설정
   * @param socket - 소켓.IO 클라이언트 객체
   */
  initialize(socket: ReturnType<typeof socketService.getSocket>) {
    if (!socket) return;

    this.socket = socket;
    const secureSocket = socket; // TypeScript 타입 가드를 위한 변수

    // 시그널링 이벤트 처리 (Offer, Answer, ICE Candidate)
    secureSocket.on('signal', async (data: { from: string; signal: RTCSessionDescriptionInit | RTCIceCandidateInit }) => {
      console.log('signal 이벤트 수신:', data);
      const { from, signal } = data;

      // socket ID를 이용하여 해당 사용자의 userId 찾기 시도
      let userId = from;
      // nicknameMap을 순회하여 userId 찾기
      for (const [id] of this.nicknameMap.entries()) {
        if (id === from) {
          userId = id;
          break;
        }
      }

      console.log(`신호 수신: ${from} (처리할 userId: ${userId})`);

      try {
        // 로컬 스트림이 준비되지 않은 경우 연결 지연
        if (!this.localStream) {
          console.warn('로컬 스트림이 준비되지 않아 연결이 지연됩니다.');
          this.pendingConnections.add(userId);
          return;
        }

        // 피어 연결 가져오기 또는 생성
        let peerConnection: RTCPeerConnection;
        const existingPeer = this.peerConnections.get(userId);

        if (existingPeer) {
          console.log(`기존 피어 연결 사용: ${userId}`);
          peerConnection = existingPeer.connection;
        } else {
          console.log(`새 피어 연결 생성: ${userId}`);
          try {
            peerConnection = await this.createPeerConnection(userId);
            console.log(`피어 연결 생성 성공: ${userId}`);
          } catch (error) {
            console.error(`피어 연결 생성 실패: ${userId}`, error);
            return;
          }
        }

        // 시그널 타입에 따른 처리
        if ('type' in signal) {
          if (signal.type === 'offer') {
            // Offer 수신 시 Answer 생성 및 전송
            console.log(`Offer 수신: ${userId}`);
            try {
              await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
              const answer = await peerConnection.createAnswer();
              await peerConnection.setLocalDescription(answer);
              this.sendSignal(userId, answer);
              console.log(`Answer 전송: ${userId}`);
            } catch (error) {
              console.error(`Offer 처리 중 오류: ${userId}`, error);
            }
          } else if (signal.type === 'answer') {
            // Answer 수신 시 Remote Description 설정
            console.log(`Answer 수신: ${userId}`);
            try {
              await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
              console.log(`Remote description 설정 완료: ${userId}`);
            } catch (error) {
              console.error(`Answer 처리 중 오류: ${userId}`, error);
            }
          }
        } else if ('candidate' in signal) {
          // ICE Candidate 수신 및 추가
          try {
            console.log(`ICE candidate 수신: ${userId}`);
            await peerConnection.addIceCandidate(new RTCIceCandidate(signal));
            console.log(`ICE candidate 추가 완료: ${userId}`);
          } catch (error) {
            console.error(`ICE candidate 추가 실패: ${userId}`, error);
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

    // 기존 연결이 있는 경우 재협상
    if (this.peerConnections.size > 0) {
      console.log('기존 연결 있음, 재협상 시작:', this.peerConnections.size);

      // 모든 피어 연결에 트랙 교체
      for (const [userId, { connection }] of this.peerConnections.entries()) {
        try {
          console.log(`${userId}와의 연결 재협상 중...`);

          // 기존 센더 가져오기 및 모두 제거
          const senders = connection.getSenders();
          console.log('기존 센더:', senders.length);

          // 모든 센더 제거
          for (const sender of senders) {
            try {
              connection.removeTrack(sender);
              console.log(`트랙 제거됨: ${sender.track?.kind}`);
            } catch (e) {
              console.error('트랙 제거 실패:', e);
            }
          }

          // 모든 새 트랙 추가
          console.log(`새 트랙 추가 시작 (총 ${stream.getTracks().length}개)`);
          stream.getTracks().forEach((track) => {
            try {
              console.log(`트랙 추가: ${track.kind}, 활성화: ${track.enabled}, ID: ${track.id}`);
              connection.addTrack(track, stream);
            } catch (e) {
              console.error(`트랙 추가 실패 (${track.kind}):`, e);
            }
          });

          // 명시적으로 협상 트리거
          console.log(`${userId}에게 새로운 offer 생성 중...`);
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          console.log(`새 로컬 설명: ${offer.type}, SDP 길이: ${offer.sdp?.length}자`);

          // 시그널 전송 전 짧은 지연 추가 (안정성 향상)
          await new Promise((resolve) => setTimeout(resolve, 200));
          this.sendSignal(userId, offer);
          console.log(`${userId}에게 새 offer 전송 완료`);
        } catch (error) {
          console.error(`${userId}와의 트랙 교체 실패:`, error);
          // 연결 재시도
          setTimeout(() => {
            console.log(`${userId}와 재연결 시도...`);
            this.removePeerConnection(userId);
            this.initiateCall(userId);
          }, 1000);
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
    const peerConnection = await this.createPeerConnection(userId);
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await peerConnection.setLocalDescription(offer);
    this.sendSignal(userId, offer);
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

          // 기존 같은 종류 트랙 제거 (화면 공유 여부에 따라 처리 방식 다름)
          if (isScreen && event.track.kind === 'video') {
            // 기존 비디오 트랙을 모두 제거하고 화면 공유 트랙 추가
            const existingVideoTracks = remoteStream.getVideoTracks();
            existingVideoTracks.forEach((track) => {
              console.log(`화면 공유 위해 기존 비디오 트랙 제거: ${track.id}`);
              remoteStream.removeTrack(track);
            });
          } else {
            // 화면 공유가 아닌 경우 동일 종류 트랙만 제거
            const existingTrack = remoteStream.getTracks().find((t) => t.kind === event.track.kind);
            if (existingTrack) {
              console.log(`기존 ${event.track.kind} 트랙 제거: ${existingTrack.id}`);
              remoteStream.removeTrack(existingTrack);
            }
          }

          // 새 트랙 추가
          console.log(`원격 스트림에 ${event.track.kind} 트랙 추가: ${event.track.id}, isScreen=${isScreen}`);
          remoteStream.addTrack(event.track);

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
          const existingTrack = remoteStream.getTracks().find((t) => t.kind === event.track.kind);
          if (existingTrack) {
            console.log(`기존 ${event.track.kind} 트랙 제거 (직접): ${existingTrack.id}`);
            remoteStream.removeTrack(existingTrack);
          }

          console.log(`원격 스트림에 ${event.track.kind} 트랙 직접 추가: ${event.track.id}`);
          remoteStream.addTrack(event.track);

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
  }

  private async createPeerConnection(remoteUserId: string): Promise<RTCPeerConnection> {
    // 로컬 스트림이 없어도 연결 가능하도록 수정
    if (!this.localStream) {
      console.log(`로컬 스트림 없이 ${remoteUserId}와 피어 연결 생성 중...`);
      // 빈 스트림을 생성하여 연결 진행
      this.localStream = new MediaStream();
    }

    const peerConnection = new RTCPeerConnection({
      ...this.configuration,
      // 추가 미디어 제약 조건 설정
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10, // ICE 후보 풀 크기 증가
      // 성능 개선을 위한 추가 설정
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    // 모든 로컬 트랙 추가 (트랙이 있는 경우에만)
    if (this.localStream.getTracks().length > 0) {
      console.log(`${remoteUserId}와의 연결에 ${this.localStream.getTracks().length}개 트랙 추가 시작`);

      this.localStream.getTracks().forEach((track) => {
        try {
          console.log(`${remoteUserId}에게 트랙 추가: ${track.kind}, 활성화: ${track.enabled}`);
          peerConnection.addTrack(track, this.localStream!);
        } catch (e) {
          console.error('트랙 추가 오류:', e);
        }
      });
    } else {
      console.log('로컬 스트림에 트랙이 없습니다. 비디오/오디오 없이 연결합니다.');
    }

    // 원격 스트림 처리
    const remoteStream = new MediaStream();

    // 연결 상태 모니터링
    peerConnection.onconnectionstatechange = () => {
      console.log(`연결 상태 변경 (${remoteUserId}): ${peerConnection.connectionState}`);

      switch (peerConnection.connectionState) {
        case 'connected':
          toast(`${this.nicknameMap.get(remoteUserId) || '상대방'}과 연결되었습니다.`);
          break;
        case 'disconnected':
        case 'failed':
          toast(`${this.nicknameMap.get(remoteUserId) || '상대방'}과 연결이 끊어졌습니다.`);
          this.removePeerConnection(remoteUserId);
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

    // 트랙 이벤트 리스너 설정
    this.setupTrackListeners(peerConnection, remoteStream, remoteUserId);

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

    this.socket.emit('signal', { to, from: this.socket.id, signal });
  }
}

export const webRTCService = new WebRTCService();
