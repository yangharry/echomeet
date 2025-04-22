/**
 * 미디어 장치 관리를 위한 Redux Slice
 *
 * 로컬 미디어 스트림(카메라, 마이크), 화면 공유 상태, 오디오/비디오 활성화 여부 등
 * 화상 회의에 필요한 미디어 관련 상태를 관리합니다.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/**
 * 미디어 상태 인터페이스
 * @property localStream - 로컬 카메라/마이크 스트림
 * @property screenStream - 화면 공유 스트림
 * @property isAudioEnabled - 오디오(마이크) 활성화 여부
 * @property isVideoEnabled - 비디오(카메라) 활성화 여부
 * @property isScreenSharing - 화면 공유 활성화 여부
 */
interface MediaState {
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
}

// 초기 상태 설정
const initialState: MediaState = {
  localStream: null, // 초기 로컬 스트림은 null
  screenStream: null, // 초기 화면 공유 스트림은 null
  isAudioEnabled: true, // 오디오 초기 상태는 활성화
  isVideoEnabled: true, // 비디오 초기 상태는 활성화
  isScreenSharing: false, // 화면 공유 초기 상태는 비활성화
};

/**
 * 미디어 장치 관리 슬라이스
 * 미디어 스트림 설정 및 상태 제어 기능 구현
 */
export const mediaSlice = createSlice({
  name: 'media',
  initialState,
  reducers: {
    /**
     * 로컬 스트림 설정 액션
     * 카메라/마이크의 미디어 스트림을 설정합니다.
     */
    setLocalStream: (state, action: PayloadAction<MediaStream | null>) => {
      state.localStream = action.payload;
    },
    /**
     * 화면 공유 스트림 설정 액션
     * 화면 공유를 위한 미디어 스트림을 설정합니다.
     */
    setScreenStream: (state, action: PayloadAction<MediaStream | null>) => {
      state.screenStream = action.payload;
    },
    /**
     * 오디오 토글 액션
     * 마이크 활성화 상태를 반전시킵니다. (켜짐→꺼짐, 꺼짐→켜짐)
     */
    toggleAudio: (state) => {
      state.isAudioEnabled = !state.isAudioEnabled;
    },
    /**
     * 비디오 토글 액션
     * 카메라 활성화 상태를 반전시킵니다. (켜짐→꺼짐, 꺼짐→켜짐)
     */
    toggleVideo: (state) => {
      state.isVideoEnabled = !state.isVideoEnabled;
    },
    /**
     * 화면 공유 상태 설정 액션
     * 화면 공유 활성화 상태를 설정합니다.
     */
    setScreenSharing: (state, action: PayloadAction<boolean>) => {
      state.isScreenSharing = action.payload;
    },
    /**
     * 미디어 상태 초기화 액션
     * 모든 미디어 관련 상태를 기본값으로 초기화합니다.
     */
    clearMediaState: (state) => {
      state.localStream = null;
      state.screenStream = null;
      state.isAudioEnabled = true;
      state.isVideoEnabled = true;
      state.isScreenSharing = false;
    },
  },
});

// 액션 및 리듀서 내보내기
export const { setLocalStream, setScreenStream, toggleAudio, toggleVideo, setScreenSharing, clearMediaState } = mediaSlice.actions;

export default mediaSlice.reducer;
