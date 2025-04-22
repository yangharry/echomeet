/**
 * Redux 스토어 설정 파일
 *
 * 애플리케이션의 상태 관리를 위한 Redux 스토어를 구성합니다.
 * 여러 기능별로 분리된 리듀서를 하나의 스토어로 통합합니다.
 */
import { configureStore } from '@reduxjs/toolkit';
import userReducer from './slices/userSlice'; // 사용자 정보 상태 관리
import roomReducer from './slices/roomSlice'; // 방 정보 상태 관리
import chatReducer from './slices/chatSlice'; // 채팅 상태 관리
import mediaReducer from './slices/mediaSlice'; // 미디어 장치 상태 관리

/**
 * Redux 스토어 생성
 *
 * 각 기능별 리듀서를 통합하여 하나의 스토어로 구성합니다.
 */
const store = configureStore({
  reducer: {
    user: userReducer, // 사용자 정보 (닉네임, 로그인 상태 등)
    room: roomReducer, // 방 정보 (현재 방 ID, 방 상태 등)
    chat: chatReducer, // 채팅 기능 (메시지 목록, 채팅창 표시 상태 등)
    media: mediaReducer, // 미디어 장치 (카메라, 마이크 상태 등)
  },
});

export default store;

// TypeScript 타입 정의
export type RootState = ReturnType<typeof store.getState>; // 스토어 상태 타입
export type AppDispatch = typeof store.dispatch; // 디스패치 함수 타입
