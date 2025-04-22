/**
 * ChatPanel.tsx - 독립형 채팅 패널 컴포넌트
 *
 * 영상 통화 중 사용자 간 텍스트 메시지를 주고받을 수 있는 채팅 UI를 제공합니다.
 * Chat 컴포넌트와 유사하지만 독립적으로 사용 가능한 패널 형태로 구현되었습니다.
 */
import { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { addMessage } from '../store/slices/chatSlice';
import { v4 as uuidv4 } from 'uuid'; // 고유 ID 생성 라이브러리

/**
 * 독립형 채팅 패널 컴포넌트
 * 소켓을 사용하지 않고 로컬 Redux 상태만으로 채팅 기능을 제공합니다.
 */
export default function ChatPanel() {
  // 메시지 입력값 상태
  const [message, setMessage] = useState('');
  const dispatch = useDispatch();

  // Redux 상태에서 메시지 목록과 사용자 정보 가져오기
  const { messages } = useSelector((state: RootState) => state.chat);
  const { nickname, userId } = useSelector((state: RootState) => state.user);

  /**
   * 메시지 전송 처리 함수
   * 입력된 메시지를 Redux 스토어에 추가합니다.
   * @param e - 폼 제출 이벤트
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 빈 메시지는 전송하지 않음
    if (!message.trim()) return;

    // 새 메시지 객체 생성
    const newMessage = {
      id: uuidv4(), // 고유 ID 생성
      senderId: userId,
      senderNickname: nickname,
      content: message.trim(),
      timestamp: Date.now(), // 현재 시간 타임스탬프
    };

    // Redux 스토어에 메시지 추가
    dispatch(addMessage(newMessage));
    // 입력 필드 초기화
    setMessage('');
  };

  /**
   * 타임스탬프를 읽기 쉬운 시간 형식으로 변환
   * @param timestamp - UNIX 타임스탬프 (밀리초)
   * @returns 표준 시간 문자열 (HH:MM 형식)
   */
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full">
      {/* 채팅 헤더 */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold">채팅</h2>
      </div>

      {/* 메시지 목록 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.senderId === userId ? 'items-end' : 'items-start'}`}>
            {/* 메시지 헤더 (발신자 + 시간) */}
            <div className="flex items-center space-x-2 mb-1">
              <span className="text-sm font-medium">{msg.senderNickname}</span>
              <span className="text-xs text-gray-500">{formatTime(msg.timestamp)}</span>
            </div>
            {/* 메시지 내용 - 자신/타인 구분하여 스타일 적용 */}
            <div className={`rounded-lg px-4 py-2 max-w-[80%] break-words ${msg.senderId === userId ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* 메시지 입력 폼 */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
        <div className="flex space-x-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="메시지를 입력하세요"
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
            전송
          </button>
        </div>
      </form>
    </div>
  );
}
