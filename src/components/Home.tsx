/**
 * Home.tsx - 애플리케이션 홈 컴포넌트
 *
 * 사용자 로그인, 방 생성 및 참가 기능을 제공하는 랜딩 페이지입니다.
 * 닉네임 설정과 회의실 생성/참가 기능을 통해 화상 회의를 시작할 수 있습니다.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { setUserInfo } from '../store/slices/userSlice';
import { setRoomId } from '../store/slices/roomSlice';
import { v4 as uuidv4 } from 'uuid'; // 고유 ID 생성을 위한 UUID 라이브러리
import { VideoCameraIcon, UserCircleIcon } from '@heroicons/react/24/solid';
import { RootState } from '../store';
import { socketService } from '../services/socket';

export default function Home() {
  // 로컬 상태 관리
  const [nickname, setNickname] = useState(''); // 사용자 닉네임 입력값
  const [roomIdInput, setRoomIdInput] = useState(''); // 방 ID 입력값
  const [isCreating, setIsCreating] = useState(true); // 방 생성 모드 여부
  const [isLoading, setIsLoading] = useState(false); // 로딩 상태
  const [error, setError] = useState(''); // 오류 메시지
  const [socketConnected, setSocketConnected] = useState(false); // 소켓 연결 상태

  const navigate = useNavigate();
  const dispatch = useDispatch();
  // Redux에서 사용자 정보 가져오기
  const { isLoggedIn, nickname: savedNickname } = useSelector((state: RootState) => state.user);

  // Socket.IO 연결 설정
  useEffect(() => {
    // 서버와 소켓 연결 수립
    const socket = socketService.connect();

    if (socket) {
      // 연결 상태 초기화
      setSocketConnected(socket.connected);

      // 연결 성공 이벤트 처리
      socket.on('connect', () => {
        console.log('서버에 연결되었습니다.');
        setSocketConnected(true);
        setError('');
      });

      // 연결 오류 이벤트 처리
      socket.on('connect_error', (err) => {
        console.error('서버 연결 오류:', err);
        setSocketConnected(false);
        setError('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.');
      });

      // 연결 해제 이벤트 처리
      socket.on('disconnect', () => {
        console.log('서버와 연결이 끊어졌습니다.');
        setSocketConnected(false);
      });
    }

    // 컴포넌트 언마운트 시 소켓 연결 해제
    return () => {
      socketService.disconnect();
    };
  }, []);

  // 이전 세션 정보 확인 및 자동 로그인/방 입장 처리
  useEffect(() => {
    // localStorage에서 마지막 접속 방 ID 확인
    const lastRoomId = localStorage.getItem('lastRoomId');
    // 로그인 상태이고 마지막 방 ID가 있으면 해당 방으로 이동
    if (isLoggedIn && lastRoomId) {
      dispatch(setRoomId(lastRoomId));
      navigate(`/room/${lastRoomId}`);
    }
    // 저장된 닉네임이 있으면 입력 필드에 자동 설정
    if (savedNickname) {
      setNickname(savedNickname);
    }
  }, [isLoggedIn, savedNickname, navigate, dispatch]);

  /**
   * 방 생성 또는 참가 처리 함수
   * 새 방을 생성하거나 기존 방에 참가합니다.
   * @param e - 폼 제출 이벤트
   */
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    // 닉네임 검증
    if (!nickname.trim()) {
      setError('닉네임을 입력해주세요.');
      return;
    }

    // 서버 연결 상태 확인
    const socket = socketService.getSocket();
    if (!socket?.connected) {
      // 연결이 없으면 새로 시도
      socketService.connect();
      setError('서버에 연결 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // 사용자 ID 생성 및 방 ID 설정
      const userId = uuidv4();
      const roomId = isCreating ? uuidv4() : roomIdInput;

      if (!isCreating && !roomId.trim()) {
        setError('방 ID를 입력해주세요.');
        setIsLoading(false);
        return;
      }

      // 사용자 정보 Redux 저장
      dispatch(setUserInfo({ nickname, userId }));
      dispatch(setRoomId(roomId));

      // 마지막 방 ID 저장 (자동 재접속용)
      localStorage.setItem('lastRoomId', roomId);

      // 방 페이지로 이동
      navigate(`/room/${roomId}`);
    } catch (err) {
      console.error('방 생성/참가 오류:', err);
      setError('방을 생성하거나 참가하는 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 메인 카드 컨테이너 */}
        <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-lg rounded-2xl shadow-xl p-8 border border-gray-200 dark:border-gray-700">
          {/* 앱 타이틀 및 설명 */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-500/10 dark:bg-indigo-500/20 mb-4">
              <VideoCameraIcon className="w-8 h-8 text-indigo-500" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark: mb-2">EchoMeet</h1>
            <p className="text-gray-500 dark:text-gray-400">간편한 화상 회의 서비스</p>
          </div>

          {/* 서버 연결 상태 표시 */}
          <div className={`mb-4 flex items-center justify-center ${socketConnected ? 'text-green-500' : 'text-red-500'}`}>
            <span className={`inline-block w-3 h-3 rounded-full mr-2 ${socketConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            <span className="text-sm">{socketConnected ? '서버에 연결됨' : '서버 연결 안됨'}</span>
          </div>

          {/* 오류 메시지 표시 영역 */}
          {error && <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm">{error}</div>}

          {/* 입력 폼 */}
          <form onSubmit={handleJoinRoom} className="space-y-6">
            {/* 닉네임 입력 필드 */}
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <UserCircleIcon className="w-5 h-5 text-gray-400" />
                <label htmlFor="nickname" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  닉네임
                </label>
              </div>
              <input
                type="text"
                id="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-xl border border-transparent focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 focus:outline-none transition-all text-gray-900 dark: placeholder-gray-400 dark:placeholder-gray-500"
                placeholder="닉네임을 입력하세요"
                required
                disabled={isLoading}
              />
            </div>

            {/* 방 생성/참가 모드 전환 버튼 */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className={`px-4 py-3 rounded-xl font-medium transition-all ${
                  isCreating ? 'bg-indigo-500  hover:bg-indigo-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                disabled={isLoading}
              >
                회의 만들기
              </button>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className={`px-4 py-3 rounded-xl font-medium transition-all ${
                  !isCreating ? 'bg-indigo-500  hover:bg-indigo-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                disabled={isLoading}
              >
                회의 참가
              </button>
            </div>

            {/* 방 ID 입력 필드 (참가 모드일 때만 표시) */}
            {!isCreating && (
              <div className="space-y-2">
                <label htmlFor="roomId" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  방 ID
                </label>
                <input
                  type="text"
                  id="roomId"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-xl border border-transparent focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 focus:outline-none transition-all text-gray-900 dark: placeholder-gray-400 dark:placeholder-gray-500"
                  placeholder="방 ID를 입력하세요"
                  required={!isCreating}
                  disabled={isLoading}
                />
              </div>
            )}

            {/* 제출 버튼 */}
            <button
              type="submit"
              className="w-full px-4 py-3 bg-indigo-500 hover:bg-indigo-600  rounded-xl font-medium transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading || !socketConnected}
            >
              {isLoading ? '처리 중...' : isCreating ? '새 회의 시작하기' : '회의 참가하기'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
