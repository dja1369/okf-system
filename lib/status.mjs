// 진단용 헬퍼. 로그·상태 파일에는 transcript 파생 텍스트(경로·내용·토큰)를 절대 싣지 않는다.
export function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
  return /^[A-Z0-9_-]{1,64}$/.test(code) ? code : 'UNKNOWN';
}
