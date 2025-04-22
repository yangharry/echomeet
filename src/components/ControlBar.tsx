/**
 * ControlBar.tsx - 화상 회의 제어 바 컴포넌트
 *
 * 화상 회의 중 미디어 장치(카메라, 마이크) 제어, 화면 공유, 채팅 토글 및
 * 회의 종료 기능을 제공하는 하단 제어 바입니다.
 */
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RootState } from '../store';
import { toggleAudio, toggleVideo, setScreenSharing, setScreenStream, clearMediaState } from '../store/slices/mediaSlice';
import { toggleChat } from '../store/slices/chatSlice';
import { clearRoom } from '../store/slices/roomSlice';
import { toast } from 'react-hot-toast';
import {
  MicrophoneIcon, // 마이크 켜짐 아이콘
  NoSymbolIcon, // 금지/끄기 아이콘
  VideoCameraIcon, // 카메라 켜짐 아이콘
  ComputerDesktopIcon, // 화면 공유 아이콘
  ChatBubbleLeftIcon, // 채팅 아이콘
  ArrowLeftOnRectangleIcon, // 나가기 아이콘
} from '@heroicons/react/24/solid';

/**
 * 확장된 Window 인터페이스 - Redux 스토어에 접근하기 위한 타입 정의
 */
interface WindowWithStore extends Window {
  store?: {
    getState: () => {
      media?: {
        screenStream: MediaStream | null;
      };
    };
  };
}

/**
 * 화상 회의 제어 바 컴포넌트
 * 회의 중 사용자가 미디어 장치와 기능을 제어할 수 있는 인터페이스를 제공합니다.
 */
export default function ControlBar() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Redux 상태에서 미디어 및 채팅 상태 정보 가져오기
  const { isAudioEnabled, isVideoEnabled, isScreenSharing, localStream } = useSelector((state: RootState) => state.media);
  const { isOpen: isChatOpen } = useSelector((state: RootState) => state.chat);

  /**
   * 마이크 켜기/끄기 토글 함수
   * 로컬 스트림의 오디오 트랙 활성화 상태를 변경합니다.
   */
  const handleToggleAudio = () => {
    if (localStream) {
      // 모든 오디오 트랙의 활성화 상태 변경
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !isAudioEnabled;
      });
      // Redux 상태 업데이트
      dispatch(toggleAudio());
    }
  };

  /**
   * 카메라 켜기/끄기 토글 함수
   * 로컬 스트림의 비디오 트랙 활성화 상태를 변경합니다.
   */
  const handleToggleVideo = () => {
    if (localStream) {
      // 모든 비디오 트랙의 활성화 상태 변경
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !isVideoEnabled;
      });
      // Redux 상태 업데이트
      dispatch(toggleVideo());
    }
  };

  /**
   * 화면 공유 시작/중지 함수
   * 화면 공유 스트림을 생성하거나 중지합니다.
   */
  const handleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        // 화면 공유 시작
        console.log('화면 공유 시작 시도...');

        // 간소화된 설정으로 화면 공유 요청
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: 'always',
          },
          audio: false,
        } as MediaStreamConstraints);

        console.log('화면 공유 성공:', screenStream.getVideoTracks()[0]?.label);

        // 사용자가 화면 공유를 중단했을 때 이벤트 처리
        screenStream.getVideoTracks()[0].onended = () => {
          console.log('사용자가 화면 공유를 중단했습니다.');
          dispatch(setScreenSharing(false));
          dispatch(setScreenStream(null));
          toast.success('화면 공유가 중단되었습니다.');
        };

        // Redux 상태 업데이트
        dispatch(setScreenStream(screenStream));
        dispatch(setScreenSharing(true));
        toast.success('화면 공유가 시작되었습니다.');
      } else {
        // 화면 공유 중지
        console.log('화면 공유 중지 시도...');

        // Redux 스토어에서 현재 화면 공유 스트림 가져오기
        const state = (window as WindowWithStore).store?.getState();
        const currentScreenStream = state?.media?.screenStream;

        // 화면 공유 트랙 중지
        if (currentScreenStream) {
          currentScreenStream.getTracks().forEach((track: MediaStreamTrack) => {
            track.stop();
            console.log(`트랙 중지: ${track.kind} (${track.label})`);
          });
        }

        // Redux 상태 업데이트
        dispatch(setScreenStream(null));
        dispatch(setScreenSharing(false));
        toast.success('화면 공유가 중지되었습니다.');
      }
    } catch (error) {
      console.error('화면 공유 오류:', error);

      // 오류 타입에 따른 메시지 표시
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          toast.error('화면 공유 권한이 거부되었습니다.');
        } else if (error.name === 'NotFoundError') {
          toast.error('공유할 화면을 찾을 수 없습니다.');
        } else if (error.name === 'NotReadableError') {
          toast.error('하드웨어 또는 시스템 오류로 화면을 공유할 수 없습니다.');
        } else if (error.name === 'AbortError') {
          toast.success('화면 공유가 취소되었습니다.');
        } else {
          toast.error(`화면 공유 오류: ${error.message}`);
        }
      } else {
        toast.error('화면 공유 중 오류가 발생했습니다.');
      }

      // 오류 발생 시 화면 공유 상태 초기화
      dispatch(setScreenSharing(false));
      dispatch(setScreenStream(null));
    }
  };

  /**
   * 회의실 나가기 함수
   * 모든 미디어 상태를 초기화하고 홈페이지로 이동합니다.
   */
  const handleLeaveRoom = () => {
    // 모든 미디어 및 방 상태 초기화
    dispatch(clearMediaState());
    dispatch(clearRoom());
    // 홈페이지로 이동
    navigate('/');
  };

  return (
    <div className="bg-gray-900 text-white p-4">
      <div className="container mx-auto flex items-center justify-center space-x-8">
        {/* 마이크 토글 버튼 */}
        <button onClick={handleToggleAudio} className={`p-3 rounded-full ${isAudioEnabled ? 'bg-gray-700' : 'bg-red-600'} hover:opacity-80 transition-opacity`}>
          {isAudioEnabled ? <MicrophoneIcon className="w-6 h-6" /> : <NoSymbolIcon className="w-6 h-6" />}
        </button>

        {/* 카메라 토글 버튼 */}
        <button onClick={handleToggleVideo} className={`p-3 rounded-full ${isVideoEnabled ? 'bg-gray-700' : 'bg-red-600'} hover:opacity-80 transition-opacity`}>
          {isVideoEnabled ? <VideoCameraIcon className="w-6 h-6" /> : <NoSymbolIcon className="w-6 h-6" />}
        </button>

        {/* 화면 공유 버튼 */}
        <button onClick={handleScreenShare} className={`p-3 rounded-full ${isScreenSharing ? 'bg-indigo-600' : 'bg-gray-700'} hover:opacity-80 transition-opacity`}>
          <ComputerDesktopIcon className="w-6 h-6" />
        </button>

        {/* 채팅 토글 버튼 */}
        <button onClick={() => dispatch(toggleChat())} className={`p-3 rounded-full ${isChatOpen ? 'bg-indigo-600' : 'bg-gray-700'} hover:opacity-80 transition-opacity`}>
          <ChatBubbleLeftIcon className="w-6 h-6" />
        </button>

        {/* 회의 나가기 버튼 */}
        <button onClick={handleLeaveRoom} className="p-3 rounded-full bg-red-600 hover:opacity-80 transition-opacity">
          <ArrowLeftOnRectangleIcon className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
