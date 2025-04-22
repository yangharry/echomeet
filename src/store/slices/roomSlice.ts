/**
 * 회의실 정보 관리를 위한 Redux Slice
 *
 * 현재 접속 중인 회의실 ID와 참가자 목록을 관리합니다.
 * 실시간으로 업데이트되는 참가자 정보를 저장하고 관리합니다.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/**
 * 참가자 정보 인터페이스
 * @property userId - 참가자 고유 ID
 * @property nickname - 참가자 닉네임
 */
interface Participant {
  userId: string;
  nickname: string;
}

/**
 * 회의실 상태 인터페이스
 * @property roomId - 현재 접속 중인 회의실 ID
 * @property participants - 현재 회의실 참가자 목록
 */
interface RoomState {
  roomId: string;
  participants: Participant[];
}

// 초기 상태 설정
const initialState: RoomState = {
  roomId: '', // 초기 룸 ID는 빈 문자열
  participants: [], // 초기 참가자 목록은 빈 배열
};

/**
 * 회의실 정보 관리 슬라이스
 * 방 정보 설정 및 참가자 관리 기능 구현
 */
export const roomSlice = createSlice({
  name: 'room',
  initialState,
  reducers: {
    /**
     * 회의실 ID 설정 액션
     * 현재 접속 중인 회의실의 ID를 설정합니다.
     */
    setRoomId: (state, action: PayloadAction<string>) => {
      state.roomId = action.payload;
    },
    /**
     * 참가자 추가 액션
     * 새로운 참가자를 회의실 참가자 목록에 추가합니다.
     */
    addParticipant: (state, action: PayloadAction<Participant>) => {
      state.participants.push(action.payload);
    },
    /**
     * 참가자 제거 액션
     * 지정된 ID를 가진 참가자를 회의실 참가자 목록에서 제거합니다.
     */
    removeParticipant: (state, action: PayloadAction<string>) => {
      state.participants = state.participants.filter((p) => p.userId !== action.payload);
    },
    /**
     * 회의실 정보 초기화 액션
     * 회의실 정보와 참가자 목록을 모두 초기화합니다.
     */
    clearRoom: (state) => {
      state.roomId = '';
      state.participants = [];
    },
  },
});

// 액션 및 리듀서 내보내기
export const { setRoomId, addParticipant, removeParticipant, clearRoom } = roomSlice.actions;
export default roomSlice.reducer;
