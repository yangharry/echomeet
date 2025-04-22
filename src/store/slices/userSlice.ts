/**
 * 사용자 정보 관리를 위한 Redux Slice
 *
 * 사용자 로그인 상태, 닉네임, ID 등의 정보를 관리하고
 * localStorage를 통해 페이지 새로고침에도 로그인 상태를 유지합니다.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/**
 * 사용자 상태 인터페이스
 * @property nickname - 사용자 닉네임
 * @property userId - 사용자 고유 ID
 * @property isLoggedIn - 로그인 상태 여부
 */
interface UserState {
  nickname: string;
  userId: string;
  isLoggedIn: boolean;
}

/**
 * localStorage에서 사용자 정보를 불러오는 함수
 * 저장된 정보가 없을 경우 기본값을 반환합니다.
 */
const loadUserFromStorage = (): UserState => {
  const savedUser = localStorage.getItem('user');
  if (savedUser) {
    return JSON.parse(savedUser);
  }
  return {
    nickname: '',
    userId: '',
    isLoggedIn: false,
  };
};

// 초기 상태 설정 (localStorage에서 로드)
const initialState: UserState = loadUserFromStorage();

/**
 * 사용자 정보 관리 슬라이스
 * 로그인, 로그아웃 상태 변경 및 사용자 정보 저장/삭제 기능 구현
 */
const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    /**
     * 사용자 정보 설정 액션
     * 닉네임과 ID를 설정하고 로그인 상태로 변경합니다.
     * localStorage에 사용자 정보를 저장하여 세션 유지 기능을 제공합니다.
     */
    setUserInfo: (state, action: PayloadAction<{ nickname: string; userId: string }>) => {
      state.nickname = action.payload.nickname;
      state.userId = action.payload.userId;
      state.isLoggedIn = true;
      // localStorage에 사용자 정보 저장
      localStorage.setItem(
        'user',
        JSON.stringify({
          nickname: action.payload.nickname,
          userId: action.payload.userId,
          isLoggedIn: true,
        })
      );
    },
    /**
     * 사용자 정보 초기화 액션
     * 사용자 정보를 초기화하고 로그아웃 상태로 변경합니다.
     * localStorage에서 저장된 사용자 정보를 삭제합니다.
     */
    clearUserInfo: (state) => {
      state.nickname = '';
      state.userId = '';
      state.isLoggedIn = false;
      // localStorage에서 사용자 정보 삭제
      localStorage.removeItem('user');
    },
  },
});

// 액션 및 리듀서 내보내기
export const { setUserInfo, clearUserInfo } = userSlice.actions;
export default userSlice.reducer;
