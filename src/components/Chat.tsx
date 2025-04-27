/**
 * Chat.tsx - 실시간 채팅 컴포넌트
 * 화상 회의 중 사용자 간 텍스트 메시지를 주고받을 수 있는 채팅 인터페이스를 제공합니다.
 */
import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { addMessage } from '../store/slices/chatSlice';
import { XMarkIcon, PaperAirplaneIcon } from '@heroicons/react/24/solid'; // 닫기 및 메시지 전송 아이콘
import { format } from 'date-fns'; // 날짜 포맷팅 라이브러리
import { ko } from 'date-fns/locale'; // 한국어 지역화
import { v4 as uuidv4 } from 'uuid'; // 고유 ID 생성 라이브러리
import { socketService } from '../services/socket';

/**
 * Message 인터페이스 - 채팅 메시지 타입 정의
 */
export interface Message {
  id: string;
  senderId: string;
  userId: string;
  senderNickname?: string;
  nickname?: string;
  content: string;
  timestamp: number;
}

/**
 * 채팅 컴포넌트 Props 인터페이스
 * @property onClose - 채팅창 닫기 이벤트 핸들러
 * @property socket - 소켓.IO 클라이언트 객체
 * @property roomId - 현재 접속 중인 방 ID
 */
interface ChatProps {
  onClose: () => void;
  roomId: string;
}

/**
 * 채팅 컴포넌트
 * - 실시간 메시지 송수신 기능
 * - 메시지 목록 표시 및 스크롤 자동화
 * - 사용자 구분 및 시간 표시
 */
export default function Chat({ onClose, roomId }: ChatProps) {
  const dispatch = useDispatch();
  // Redux 상태에서 메시지 목록 및 사용자 정보 가져오기
  const { messages } = useSelector((state: RootState) => state.chat);
  const { userId, nickname } = useSelector((state: RootState) => state.user);

  // 메시지 입력창 상태 관리
  const [inputMessage, setInputMessage] = useState('');
  // 메시지 리스트의 마지막 항목 참조 (스크롤 제어용)
  const messageEndRef = useRef<HTMLDivElement>(null);

  // 새 메시지가 추가될 때마다 스크롤을 아래로 이동시키는 효과
  useEffect(() => {
    // 메시지가 추가될 때마다 스크롤을 아래로 이동
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * 메시지 전송 함수
   * - 입력된 메시지를 소켓을 통해 전송하고 Redux 스토어에 저장
   * @param e - 폼 제출 이벤트
   */
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    // 빈 메시지는 전송하지 않음
    if (!inputMessage.trim()) return;

    // 메시지 고유 ID 생성
    const messageId = uuidv4();

    // 소켓 서비스를 통해 메시지 전송
    const newMessage = socketService.sendMessage(roomId, messageId, userId, nickname, inputMessage.trim());

    // 로컬 상태에 추가
    dispatch(addMessage(newMessage));

    // 입력 필드 초기화
    setInputMessage('');
  };

  return (
    <div className="flex flex-col h-full" style={{ position: 'relative', zIndex: 50 }}>
      {/* 채팅 헤더 */}
      <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2 flex justify-between items-center">
        <h3 className="font-medium text-sm sm:text-base">채팅</h3>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full">
          <XMarkIcon className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </div>

      {/* 메시지 목록 영역 */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2 sm:space-y-3">
        {messages.length === 0 ? (
          // 메시지가 없는 경우 안내 문구 표시
          <div className="text-center text-gray-500 dark:text-gray-400 py-4 text-xs sm:text-sm">첫 메시지를 보내보세요!</div>
        ) : (
          // 메시지 목록 렌더링
          messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] ${
                message.senderId === userId ? 'ml-auto bg-indigo-500 text-white' : 'bg-gray-100 dark:bg-gray-700 dark:text-white'
              } rounded-lg px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm`}
            >
              {/* 다른 사용자의 메시지인 경우 발신자 닉네임 표시 */}
              {message.senderId !== userId && <div className="font-medium text-xs mb-0.5">{message.senderNickname}</div>}
              {/* 메시지 내용 */}
              <div className="break-words">{message.content}</div>
              {/* 메시지 전송 시간 (한국어 형식) */}
              <div className="text-[10px] sm:text-xs mt-0.5 sm:mt-1 opacity-70">{format(new Date(message.timestamp), 'p', { locale: ko })}</div>
            </div>
          ))
        )}
        {/* 스크롤 위치 조정을 위한 참조 요소 */}
        <div ref={messageEndRef} />
      </div>

      {/* 메시지 입력 폼 */}
      <form onSubmit={sendMessage} className="border-t border-gray-200 dark:border-gray-700 p-2 sm:p-3 flex items-center">
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="메시지를 입력하세요..."
          className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
        />
        {/* 전송 버튼 - 입력 내용이 없으면 비활성화 */}
        <button type="submit" disabled={!inputMessage.trim()} className="ml-1 sm:ml-2 p-1.5 sm:p-2 bg-indigo-500 text-white rounded-full disabled:opacity-50">
          <PaperAirplaneIcon className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </form>
    </div>
  );
}
