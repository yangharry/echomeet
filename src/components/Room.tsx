// Room.tsx - 웹RTC 서비스를 활용한 화상 회의 컴포넌트
// 화상 회의방을 관리하고 사용자 간의 실시간 음성/영상 통신을 제공합니다.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import {
  VideoCameraIcon, // 카메라 켜기 아이콘
  VideoCameraSlashIcon, // 카메라 끄기 아이콘
  MicrophoneIcon, // 마이크 켜기 아이콘
  SpeakerXMarkIcon, // 마이크 끄기 아이콘
  ArrowLeftIcon, // 뒤로가기 아이콘
  ComputerDesktopIcon, // 화면 공유 아이콘
  PresentationChartLineIcon, // 프레젠테이션 아이콘
  ChatBubbleLeftRightIcon, // 채팅 아이콘
  ClipboardDocumentIcon, // 복사 아이콘 추가
} from '@heroicons/react/24/solid';
import Chat from './Chat';
import { setChatOpen } from '../store/slices/chatSlice';
import toast from 'react-hot-toast';
import { socketService } from '../services/socket';
import { webRTCService } from '../services/webrtc';
import { Socket } from 'socket.io-client';
import { addMessage } from '../store/slices/chatSlice';

/**
 * Room 컴포넌트: 화상 회의방 기능을 제공하는 메인 컴포넌트
 * - 웹RTC를 통한 화상/음성 통신 관리
 * - 사용자 인터페이스 및 미디어 스트림 제어
 * - 화면 공유 및 채팅 기능 통합
 */
export default function Room() {
  // URL 파라미터에서 방 ID 가져오기
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Redux 상태 가져오기
  const { nickname, userId, isLoggedIn } = useSelector((state: RootState) => state.user);
  const { isOpen } = useSelector((state: RootState) => state.chat);

  // 로컬 상태 관리
  const [isCameraOn, setIsCameraOn] = useState(true); // 카메라 상태 (켜짐/꺼짐)
  const [isMicOn, setIsMicOn] = useState(true); // 마이크 상태 (켜짐/꺼짐)
  const [isScreenSharing, setIsScreenSharing] = useState(false); // 화면 공유 상태
  const [participantCount, setParticipantCount] = useState(1); // 참가자 수
  const [localStream, setLocalStream] = useState<MediaStream | null>(null); // 로컬 미디어 스트림
  const [remotePeers, setRemotePeers] = useState<{ userId: string; stream: MediaStream; nickname: string }[]>([]); // 원격 피어 정보
  const [videoDisplayMode, setVideoDisplayMode] = useState<'cover' | 'contain'>('cover'); // 비디오 표시 모드
  const [showLocalControls, setShowLocalControls] = useState(false); // 로컬 비디오 컨트롤 표시 여부
  const [hoveredPeer, setHoveredPeer] = useState<string | null>(null); // 마우스 오버된 피어 ID
  const [windowWidth, setWindowWidth] = useState(window.innerWidth); // 창 너비 상태 추가
  const [showChat, setShowChat] = useState<boolean>(false); // 채팅 패널 표시 여부
  const [socket, setSocket] = useState<Socket | null>(null);

  // 원격 피어 상태 변경 로깅
  useEffect(() => {
    console.log('remotePeers 상태 변경:', remotePeers);
  }, [remotePeers]);

  // 컴포넌트 마운트 시 소켓 연결 및 미디어 장치 초기화
  useEffect(() => {
    // 소켓 연결 설정
    const socketInstance = socketService.connect();
    setSocket(socketInstance);
    console.log('Room 컴포넌트: 소켓 연결 시도', socketInstance ? '성공' : '실패');

    // WebRTC 서비스 초기화
    webRTCService.initialize(socketInstance);
    console.log('Room 컴포넌트: WebRTC 서비스 초기화 완료');

    // 참가자 수 업데이트 이벤트 리스너 등록
    if (socketInstance) {
      socketInstance.on('participant-count', (count) => {
        setParticipantCount(count);
      });
    }

    // 미디어 장치 초기화 및 스트림 설정 함수
    const initMedia = async () => {
      try {
        // 간소화된 비디오/오디오 설정
        const constraints: MediaStreamConstraints = {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: true,
        };

        console.log('미디어 장치 접근 시도 중...');
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('미디어 장치 접근 성공!');

        // 카메라 설정 정보 로깅
        console.log('카메라 정보:', {
          비디오트랙: stream.getVideoTracks().length > 0 ? stream.getVideoTracks()[0].label : '없음',
          오디오트랙: stream.getAudioTracks().length > 0 ? stream.getAudioTracks()[0].label : '없음',
        });

        // 로컬 스트림 상태 설정
        setLocalStream(stream);

        // WebRTC 서비스에 로컬 스트림 설정 및 룸 입장
        await webRTCService.setLocalStream(stream);
        socketService.joinRoom(roomId!, userId, nickname);

        toast.success('카메라와 마이크가 연결되었습니다.');
      } catch (error: unknown) {
        console.error('미디어 장치 접근 오류:', error);

        // 상세한 오류 메시지 출력
        if (error instanceof Error) {
          if (error.name === 'NotFoundError') {
            toast.error('카메라나 마이크를 찾을 수 없습니다. 장치가 연결되어 있는지 확인하세요.');
          } else if (error.name === 'NotAllowedError') {
            toast.error('카메라와 마이크 접근 권한이 거부되었습니다. 브라우저 권한을 확인하세요.');
          } else if (error.name === 'NotReadableError') {
            toast.error('카메라나 마이크에 접근할 수 없습니다. 다른 앱이 사용 중인지 확인하세요.');
          } else if (error.name === 'OverconstrainedError') {
            console.warn('고급 설정이 지원되지 않음, 기본 설정으로 재시도합니다.');
            try {
              // 기본 설정으로 재시도
              const basicStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
              });

              setLocalStream(basicStream);
              await webRTCService.setLocalStream(basicStream);
              socketService.joinRoom(roomId!, userId, nickname);
              toast.success('기본 설정으로 카메라와 마이크가 연결되었습니다.');
              return;
            } catch (fallbackError: unknown) {
              console.error('기본 설정도 실패:', fallbackError);
              const errorMessage = fallbackError instanceof Error ? fallbackError.message || fallbackError.name : '알 수 없는 오류';
              toast.error(`미디어 장치 접근 실패: ${errorMessage}`);
            }
          } else {
            toast.error(`미디어 장치 오류: ${error.message || error.name}`);
          }
        } else {
          toast.error('알 수 없는 미디어 장치 오류가 발생했습니다.');
        }

        // 오디오만 시도
        try {
          console.log('오디오만 접근 시도 중...');
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true,
          });

          setLocalStream(audioOnlyStream);
          setIsCameraOn(false);

          await webRTCService.setLocalStream(audioOnlyStream);
          toast.success('오디오만 연결되었습니다. 카메라는 사용할 수 없습니다.');
        } catch (audioError) {
          // 빈 스트림으로 접속
          console.error('오디오 접근도 실패:', audioError);
          const emptyStream = new MediaStream();
          setLocalStream(emptyStream);
          await webRTCService.setLocalStream(emptyStream);
          socketService.joinRoom(roomId!, userId, nickname);

          setIsCameraOn(false);
          setIsMicOn(false);
          toast.error('미디어 장치 없이 접속합니다.');
        }
      }
    };

    // 미디어 초기화 실행
    initMedia();

    // 원격 피어 상태 주기적 업데이트를 위한 인터벌 설정
    const interval = setInterval(() => {
      const remoteStreams = webRTCService.getRemoteStreams();
      console.log('원격 피어 상태 확인:', remoteStreams);

      if (remoteStreams.length > 0) {
        setRemotePeers(remoteStreams);
      }
    }, 1000);

    // 컴포넌트 언마운트 시 정리 작업
    return () => {
      // 로컬 미디어 트랙 중지
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      // WebRTC 연결 종료 및 소켓 연결 해제
      webRTCService.closeAllConnections();
      socketService.leaveRoom(roomId!, userId);
      socketService.disconnect();
      clearInterval(interval);
    };
  }, [roomId, userId, nickname]);

  // 소켓 이벤트 리스너 설정 및 정리
  useEffect(() => {
    // 채팅 메시지 수신 이벤트 핸들러 등록
    if (socket) {
      const handleReceiveMessage = (message: { id: string; senderId: string; senderNickname: string; content: string; timestamp: number }) => {
        console.log('수신된 메시지:', message);
        dispatch(addMessage(message));
      };

      // 'receiveMessage' 이벤트 리스너 등록
      socket.on('receiveMessage', handleReceiveMessage);

      // 컴포넌트 언마운트 시 이벤트 리스너 정리
      return () => {
        socket.off('receiveMessage', handleReceiveMessage);
      };
    }
  }, [socket, dispatch]);

  // 로그인 상태 확인 - 로그인되지 않은 경우 홈으로 리다이렉트
  useEffect(() => {
    if (!isLoggedIn) navigate('/');
  }, [isLoggedIn, navigate]);

  // 카메라 상태(켜짐/꺼짐) 변경 시 트랙 활성화/비활성화
  useEffect(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => (track.enabled = isCameraOn));
    }
  }, [isCameraOn, localStream]);

  // 마이크 상태(켜짐/꺼짐) 변경 시 트랙 활성화/비활성화
  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => (track.enabled = isMicOn));
    }
  }, [isMicOn, localStream]);

  // 창 크기 변경 감지
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);

      // 작은 화면에서 채팅이 열려있으면 닫기 (888px 이하)
      if (window.innerWidth <= 888 && isOpen) {
        dispatch(setChatOpen(false));
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, dispatch]);

  /**
   * 화면 공유 시작/중지 함수
   * - 현재 화면 공유 중이 아니면 화면 공유 시작
   * - 이미 화면 공유 중이면 화면 공유 중지
   */
  const handleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        // 화면 공유 중지 시
        console.log('화면 공유 중지');

        // 기존 스크린 트랙 중지
        if (localStream) {
          localStream.getTracks().forEach((track) => track.stop());
          setLocalStream(null);
        }

        // 카메라 비디오가 있는 경우 해당 트랙에 대한 비디오 활성화 처리
        const videoTrack = localStream?.getVideoTracks()[0];
        if (videoTrack && isCameraOn) {
          videoTrack.enabled = true;
          console.log('카메라 비디오 재활성화');

          // WebRTC 서비스에 로컬 스트림 다시 설정하여 업데이트
          if (localStream) {
            await webRTCService.setLocalStream(localStream);
          }
        }

        setIsScreenSharing(false);
      } else {
        // 화면 공유 시작 시
        console.log('화면 공유 시작');
        // 기존 로컬 스트림 트랙 중지
        if (localStream) {
          localStream.getTracks().forEach((track) => track.stop());
        }

        try {
          // 간소화된 화면 공유 설정
          const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30 },
              displaySurface: 'monitor',
            },
            audio: false,
          });

          console.log('화면 공유 스트림 획득:', screenStream.getVideoTracks()[0]?.label);

          // 사용자가 화면 공유를 중단했을 때 이벤트 처리
          screenStream.getVideoTracks()[0].onended = () => {
            console.log('사용자가 화면 공유를 중단함');
            handleStopScreenShare();
          };

          // 로컬 스트림 업데이트 및 화면 공유 상태 설정
          setLocalStream(screenStream);
          setIsScreenSharing(true);
          setIsCameraOn(true);

          // WebRTC 서비스에 화면 공유 스트림 설정
          await webRTCService.setLocalStream(screenStream);
          console.log('WebRTC 서비스에 화면 공유 스트림 설정 완료');
          toast.success('화면 공유가 시작되었습니다.');
        } catch (error) {
          // 화면 공유 권한 거부 또는 지원 불가 오류 처리
          console.error('화면 공유 액세스 오류:', error);

          if (error instanceof DOMException) {
            if (error.name === 'NotAllowedError') {
              toast.error('화면 공유 권한이 거부되었습니다.');
            } else if (error.name === 'NotFoundError') {
              toast.error('공유할 화면을 찾을 수 없습니다.');
            } else if (error.name === 'NotReadableError') {
              toast.error('화면을 읽을 수 없습니다. 다른 앱이 사용 중인지 확인하세요.');
            } else if (error.name === 'AbortError') {
              toast.error('화면 공유가 취소되었습니다.');
            } else {
              toast.error(`화면 공유 오류: ${error.name}`);
            }
          } else {
            toast.error('화면 공유 권한이 거부되었거나 지원되지 않습니다.');
          }

          handleStopScreenShare();
        }
      }
    } catch (error) {
      console.error('화면 공유 오류:', error);
      toast.error('화면 공유에 실패했습니다.');
    }
  };

  /**
   * 화면 공유 중지 및 카메라 스트림으로 복귀하는 함수
   */
  const handleStopScreenShare = async () => {
    try {
      console.log('화면 공유 중단');
      // 기존 스트림 트랙 중지
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          track.stop();
        });
      }

      // 화면 공유 상태 해제
      setIsScreenSharing(false);
      toast.success('화면 공유가 중단되었습니다.');

      try {
        // 카메라 설정에 고정 해상도 추가
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: true,
        });

        // 카메라 활성화 상태 적용
        cameraStream.getVideoTracks().forEach((track) => {
          track.enabled = isCameraOn;
          // 비디오 트랙 제약 조건 확인 및 로깅
          console.log('카메라 복구 - 비디오 트랙 설정:', track.getSettings());
        });

        cameraStream.getAudioTracks().forEach((track) => {
          track.enabled = isMicOn;
        });

        // 로컬 스트림 업데이트
        setLocalStream(cameraStream);

        // WebRTC 서비스에 카메라 스트림 설정
        await webRTCService.setLocalStream(cameraStream);
        console.log('WebRTC 서비스에 카메라 스트림 재설정 완료');
      } catch (error) {
        console.error('카메라 스트림 획득 실패:', error);

        // 오디오만 시도
        try {
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true,
          });

          setLocalStream(audioOnlyStream);
          setIsCameraOn(false);

          await webRTCService.setLocalStream(audioOnlyStream);
          toast.success('오디오만 연결되었습니다. 카메라는 사용할 수 없습니다.');
        } catch (audioError) {
          // 모든 시도 실패 시 빈 스트림으로 대체
          console.error('오디오 접근도 실패:', audioError);
          const emptyStream = new MediaStream();
          setLocalStream(emptyStream);
          setIsCameraOn(false);
          setIsMicOn(false);

          await webRTCService.setLocalStream(emptyStream);
          toast.error('미디어 장치 없이 접속합니다.');
        }
      }
    } catch (error) {
      console.error('화면 공유 종료 과정 오류:', error);
      toast.error('카메라로 돌아가는데 실패했습니다.');
    }
  };

  /**
   * 회의실 나가기 함수
   * - 모든 미디어 트랙을 중지하고 연결을 종료한 후 홈페이지로 이동
   */
  const handleLeaveRoom = () => {
    // 모든 미디어 트랙 중지
    localStream?.getTracks().forEach((track) => track.stop());
    // WebRTC 연결 종료
    webRTCService.closeAllConnections();
    // 소켓 연결 해제 및 방 나가기
    socketService.leaveRoom(roomId!, userId);
    socketService.disconnect();
    // 마지막 방 정보 삭제
    localStorage.removeItem('lastRoomId');
    // 채팅 패널 닫기
    dispatch(setChatOpen(false));
    // 홈페이지로 이동
    navigate('/');
  };

  /**
   * 참가자 연결 상태 확인 및 재연결 요청
   * - 참가자가 2명 이상이지만 원격 피어가 없는 경우 참가자 목록 요청
   */
  useEffect(() => {
    if (!isLoggedIn || !roomId) return;

    const connectionCheckInterval = setInterval(() => {
      // 참가자는 있지만 원격 피어 연결이 없는 경우 재요청
      if (participantCount > 1 && remotePeers.length === 0) {
        const socket = socketService.getSocket();
        if (socket) {
          socket.emit('request-participants', { roomId });
        }
      }
    }, 5000);

    // 정리 함수
    return () => {
      clearInterval(connectionCheckInterval);
    };
  }, [isLoggedIn, roomId, participantCount, remotePeers.length]);

  /**
   * 비디오 표시 모드 전환 함수 (화면 맞춤/원본 비율)
   */
  const toggleVideoDisplayMode = () => {
    setVideoDisplayMode((prev) => (prev === 'cover' ? 'contain' : 'cover'));
    toast(`화면 표시 모드: ${videoDisplayMode === 'cover' ? '원본 비율' : '화면에 맞춤'}`);
  };

  /**
   * 전체화면 모드 전환 함수
   * @param element 전체화면으로 표시할 HTML 요소
   */
  const toggleFullScreen = (element: HTMLElement) => {
    try {
      if (!document.fullscreenElement) {
        // 전체화면 모드 진입
        element
          .requestFullscreen()
          .then(() => toast.success('전체화면 모드입니다'))
          .catch((err: Error) => {
            toast.error(`전체화면 전환 오류: ${err.message}`);
          });
      } else {
        // 전체화면 모드 종료
        document
          .exitFullscreen()
          .then(() => toast.success('전체화면을 종료했습니다'))
          .catch((err: Error) => {
            toast.error(`전체화면 종료 오류: ${err.message}`);
          });
      }
    } catch (err: unknown) {
      console.error('전체화면 토글 중 오류:', err);
      toast.error('전체화면 기능 사용 중 오류가 발생했습니다');
    }
  };

  /**
   * 비디오 더블클릭 이벤트 핸들러 - 전체화면 전환
   */
  const handleVideoDoubleClick = (event: React.MouseEvent<HTMLVideoElement>) => {
    toggleFullScreen(event.currentTarget);
    event.stopPropagation();
  };

  // 로그인되지 않은 경우 렌더링하지 않음
  if (!isLoggedIn) return null;

  // 채팅 토글 함수
  const handleToggleChat = () => {
    // 화면이 좁을 때(888px 이하) 채팅을 열 때 경고 표시
    if (!showChat && windowWidth <= 888) {
      toast('작은 화면에서는 채팅창이 영상을 가릴 수 있습니다', {
        icon: '📱',
        duration: 3000,
      });
    }
    setShowChat(!showChat);
  };

  // 방 ID 복사 함수 추가
  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId || '');
    toast.success('룸 ID가 클립보드에 복사되었습니다', {
      duration: 2000,
    });
  };

  return (
    <div className="h-screen w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-gray-900 dark:to-gray-800 text-gray-900 dark:text-white">
      <div className="h-full  w-full flex flex-col">
        {/* 상단 헤더 영역 */}
        <div className="w-full px-6 py-4 bg-white/70 dark:bg-gray-800/70 backdrop-blur-lg border-b border-gray-200 dark:border-gray-700">
          <div className="w-full flex items-center justify-between">
            {/* 왼쪽: 뒤로가기 버튼과 방 정보 */}
            <div className="w-[calc(80%-44px)] flex items-center">
              <button onClick={handleLeaveRoom} className="mr-2 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
              <div className="w-full flex flex-col items-center ">
                <h1 className="w-full text-lg font-semibold flex items-center">
                  EchoMeet <span className="text-sm text-gray-500 dark:text-gray-400">• 참가자: {participantCount}명</span>
                </h1>
                <div className="w-full text-sm text-gray-500 dark:text-gray-400 flex items-center">
                  <span className="w-[calc(100%-20px)] max-w-[344px] truncate inline-block">Room: {roomId} </span>
                  <button onClick={copyRoomId} className="pl-1 inline-block hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors" title="룸 ID 복사하기">
                    <ClipboardDocumentIcon className="w-4 h-4 text-gray-400 hover:text-indigo-500" />
                  </button>
                </div>
              </div>
            </div>
            {/* 오른쪽: 사용자 닉네임 표시 */}
            <div className="w-[20%] flex items-center  justify-end">
              <span className="px-2 py-1 sm:px-4 sm:py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm font-medium truncate max-w-[80px] sm:max-w-none">{nickname}</span>
            </div>
          </div>
        </div>

        {/* 메인 콘텐츠 영역: 비디오와 채팅 */}
        <div className="flex-1 flex overflow-hidden min-w-[320px]">
          {/* 비디오 그리드 */}
          <div className="flex-1 p-1 sm:p-2 md:p-4 overflow-auto">
            <div
              className={`grid grid-cols-1 sm:grid-cols-1 ${
                showChat ? 'md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-4' : 'md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              } gap-2 sm:gap-4`}
            >
              {/* 로컬 비디오 컨테이너 */}
              <div
                className="relative rounded-xl sm:rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-700 shadow-lg aspect-video w-full"
                style={{ minHeight: '120px', maxHeight: '80vh', maxWidth: '100%' }}
                onMouseEnter={() => setShowLocalControls(true)}
                onMouseLeave={() => setShowLocalControls(false)}
              >
                {/* 로컬 비디오 요소 */}
                <video
                  ref={(video) => {
                    if (video && localStream) {
                      if (video.srcObject !== localStream) {
                        video.srcObject = localStream;
                        video.muted = true; // 로컬 비디오는 항상 음소거
                      }
                    }
                  }}
                  autoPlay
                  muted
                  className={`w-full h-full object-${videoDisplayMode}`}
                  style={{ minWidth: '100%', minHeight: '100%', maxWidth: '100%' }}
                  onDoubleClick={handleVideoDoubleClick}
                />
                {/* 사용자 이름 및 마이크 상태 표시 */}
                <div className="absolute bottom-4 left-4 px-4 py-2 bg-black/50 backdrop-blur-md rounded-xl">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${isMicOn ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm text-white font-medium">{nickname} (나)</span>
                  </div>
                </div>

                {/* 마우스 호버 시 나타나는 컨트롤 */}
                {showLocalControls && (
                  <div className="absolute top-2 right-2 flex space-x-2 transition-opacity duration-300">
                    {/* 비디오 표시 모드 전환 버튼 */}
                    <button
                      onClick={toggleVideoDisplayMode}
                      className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors"
                      title={videoDisplayMode === 'cover' ? '원본 비율로 보기' : '화면에 맞춰 보기'}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        {videoDisplayMode === 'cover' ? (
                          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                        ) : (
                          <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
                        )}
                      </svg>
                    </button>
                    {/* 전체화면 도움말 */}
                    <div className="p-2 bg-black/60 text-white text-xs rounded-full backdrop-blur-sm flex items-center">더블클릭: 전체화면</div>
                  </div>
                )}

                {/* 카메라가 꺼져있거나 사용 불가능한 경우 보여줄 오버레이 */}
                {(!isCameraOn || localStream?.getVideoTracks().length === 0) && !isScreenSharing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-800/80 backdrop-blur-sm">
                    <div className="text-center">
                      <div className="w-20 h-20 mx-auto mb-2 rounded-full bg-gray-700 flex items-center justify-center">
                        <span className="text-2xl font-bold text-white">{nickname.substring(0, 1)}</span>
                      </div>
                      <span className="text-white font-medium px-4 py-2 rounded-lg bg-gray-900/50">카메라 꺼짐</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 원격 피어 비디오 그리드 */}
              {remotePeers.map(({ userId, stream, nickname }) => {
                const hasVideo = stream.getVideoTracks().length > 0;
                const hasAudio = stream.getAudioTracks().length > 0 && stream.getAudioTracks()[0].enabled;

                return (
                  <div
                    key={userId}
                    className="relative rounded-xl sm:rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-700 shadow-lg aspect-video w-full"
                    style={{ minHeight: '120px', maxHeight: '80vh', maxWidth: '100%' }}
                    onMouseEnter={() => setHoveredPeer(userId)}
                    onMouseLeave={() => setHoveredPeer(null)}
                  >
                    {/* 비디오 트랙이 있는 경우 비디오 요소 렌더링 */}
                    {hasVideo ? (
                      <video
                        ref={(video) => {
                          if (video && stream) {
                            if (video.srcObject !== stream) {
                              video.srcObject = stream;
                              video.onloadedmetadata = () => {
                                video.play();
                              };
                            }
                          }
                        }}
                        data-peer-id={userId}
                        autoPlay
                        className={`w-full h-full object-${videoDisplayMode}`}
                        style={{ minWidth: '100%', minHeight: '100%', maxWidth: '100%' }}
                        onDoubleClick={handleVideoDoubleClick}
                      />
                    ) : (
                      // 비디오 트랙이 없는 경우 아바타 표시
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-800/80 backdrop-blur-sm">
                        <div className="text-center">
                          <div className="w-20 h-20 mx-auto mb-2 rounded-full bg-gray-700 flex items-center justify-center">
                            <span className="text-2xl font-bold text-white">{nickname.substring(0, 1)}</span>
                          </div>
                          <span className="text-white font-medium px-4 py-2 rounded-lg bg-gray-900/50">{nickname}</span>
                        </div>
                      </div>
                    )}
                    {/* 사용자 이름 및 마이크 상태 표시 */}
                    <div className="absolute bottom-4 left-4 px-4 py-2 bg-black/50 backdrop-blur-md rounded-xl">
                      <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${hasAudio ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="text-sm text-white font-medium">{nickname}</span>
                      </div>
                    </div>

                    {/* 마우스 호버 시 나타나는 컨트롤 */}
                    {hoveredPeer === userId && (
                      <div className="absolute top-2 right-2 flex space-x-2 transition-opacity duration-300">
                        {/* 비디오 표시 모드 전환 버튼 */}
                        <button
                          onClick={toggleVideoDisplayMode}
                          className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors"
                          title={videoDisplayMode === 'cover' ? '원본 비율로 보기' : '화면에 맞춰 보기'}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            {videoDisplayMode === 'cover' ? (
                              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                            ) : (
                              <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
                            )}
                          </svg>
                        </button>
                        {/* 전체화면 도움말 */}
                        <div className="p-2 bg-black/60 text-white text-xs rounded-full backdrop-blur-sm flex items-center">더블클릭: 전체화면</div>
                      </div>
                    )}

                    {/* 비디오 트랙이 있지만 비활성화된 경우 */}
                    {hasVideo && !stream.getVideoTracks()[0].enabled && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-800/80 backdrop-blur-sm">
                        <div className="text-center">
                          <div className="w-20 h-20 mx-auto mb-2 rounded-full bg-gray-700 flex items-center justify-center">
                            <span className="text-2xl font-bold text-white">{nickname.substring(0, 1)}</span>
                          </div>
                          <span className="text-white font-medium px-4 py-2 rounded-lg bg-gray-900/50">{nickname}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 채팅 패널 */}
          {showChat && (
            <div
              style={{
                position: windowWidth <= 636 ? 'absolute' : 'relative',
                right: windowWidth <= 636 ? '8px' : '',
                height: windowWidth <= 636 ? 'calc(100% - 170px)' : 'auto',
              }}
              className="bg-white dark:bg-gray-900 shadow-lg transition-all transform w-[300px]"
            >
              <Chat onClose={() => setShowChat(false)} roomId={roomId || ''} />
            </div>
          )}
        </div>

        {/* 하단 제어 바 */}
        <div className="px-6 py-4 bg-white/70 dark:bg-gray-800/70 backdrop-blur-lg border-t border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto flex justify-center space-x-4">
            {/* 카메라 제어 버튼 */}
            <button
              onClick={() => setIsCameraOn(!isCameraOn)}
              className={`p-4 rounded-xl transition-all ${
                isCameraOn ? 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600' : 'bg-red-500 hover:bg-red-600 text-white'
              }`}
              title={isCameraOn ? '카메라 끄기' : '카메라 켜기'}
            >
              {isCameraOn ? <VideoCameraIcon className="w-6 h-6 text-blue-500" /> : <VideoCameraSlashIcon className="w-6 h-6 text-blue-500" />}
            </button>

            {/* 마이크 제어 버튼 */}
            <button
              onClick={() => setIsMicOn(!isMicOn)}
              className={`p-4 rounded-xl transition-all ${
                isMicOn ? 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600' : 'bg-red-500 hover:bg-red-600 text-white'
              }`}
              title={isMicOn ? '마이크 끄기' : '마이크 켜기'}
            >
              {isMicOn ? <MicrophoneIcon className="w-6 h-6 text-blue-500" /> : <SpeakerXMarkIcon className="w-6 h-6 text-blue-500" />}
            </button>

            {/* 화면 공유 버튼 */}
            <button
              onClick={handleScreenShare}
              className={`p-4 rounded-xl transition-all ${
                isScreenSharing ? 'bg-indigo-500 hover:bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              title={isScreenSharing ? '화면 공유 중지' : '화면 공유'}
            >
              {isScreenSharing ? <ComputerDesktopIcon className="w-6 h-6 text-blue-500" /> : <PresentationChartLineIcon className="w-6 h-6 text-blue-500" />}
            </button>

            {/* 채팅 토글 버튼 */}
            <button
              onClick={handleToggleChat}
              className={`p-4 rounded-xl transition-all ${
                showChat ? 'bg-indigo-500 hover:bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
              title={showChat ? '채팅 닫기' : '채팅 열기'}
            >
              <ChatBubbleLeftRightIcon className={`w-6 h-6 ${showChat ? 'text-white' : 'text-indigo-500'}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
