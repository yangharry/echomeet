/**
 * 채팅 기능을 위한 Redux Slice
 *
 * 채팅 메시지 목록과 채팅창 표시 상태를 관리합니다.
 * 실시간으로 주고받는 메시지를 저장하고 채팅 UI 상태를 제어합니다.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/**
 * 채팅 메시지 인터페이스
 * @property id - 메시지 고유 ID
 * @property senderId - 발신자 ID
 * @property senderNickname - 발신자 닉네임
 * @property content - 메시지 내용
 * @property timestamp - 메시지 전송 시간 (타임스탬프)
 */
interface Message {
  id: string;
  senderId: string;
  senderNickname: string;
  content: string;
  timestamp: number;
}

/**
 * 채팅 상태 인터페이스
 * @property messages - 채팅 메시지 목록
 * @property isOpen - 채팅창 표시 여부
 */
interface ChatState {
  messages: Message[];
  isOpen: boolean;
}

// 초기 상태 설정
const initialState: ChatState = {
  messages: [], // 빈 메시지 목록으로 시작
  isOpen: false, // 채팅창 초기 상태는 닫힘
};

/**
 * 채팅 기능 관리 슬라이스
 * 메시지 추가/삭제 및 채팅창 표시 상태 관리 기능 구현
 */
const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    /**
     * 메시지 추가 액션
     * 새로운 메시지를 메시지 목록에 추가합니다.
     */
    addMessage: (state, action: PayloadAction<Message>) => {
      state.messages.push(action.payload);
    },
    /**
     * 메시지 목록 초기화 액션
     * 모든 메시지를 삭제하고 빈 목록으로 초기화합니다.
     */
    clearMessages: (state) => {
      state.messages = [];
    },
    /**
     * 채팅창 토글 액션
     * 채팅창의 표시 상태를 반전시킵니다. (열려있으면 닫고, 닫혀있으면 엽니다)
     */
    toggleChat: (state) => {
      state.isOpen = !state.isOpen;
    },
    /**
     * 채팅창 표시 상태 직접 설정 액션
     * 채팅창의 표시 상태를 지정된 값으로 설정합니다.
     */
    setChatOpen: (state, action: PayloadAction<boolean>) => {
      state.isOpen = action.payload;
    },
  },
});

// 액션 및 리듀서 내보내기
export const { addMessage, clearMessages, toggleChat, setChatOpen } = chatSlice.actions;
export default chatSlice.reducer;
