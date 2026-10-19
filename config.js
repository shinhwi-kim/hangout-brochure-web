// 카카오 개발자 콘솔(https://developers.kakao.com/console/app)에서 발급한 JavaScript 키를 넣으세요.
// 플랫폼 > Web > 사이트 도메인에 http://localhost:5173 을 등록해야 지도가 뜹니다.
// 비워두면 첫 실행 시 입력창이 뜨고, 입력한 키는 브라우저 localStorage 에 저장됩니다.
window.APP_CONFIG = {
  kakaoJsKey: "",
  // dev 서버(server.js)가 /api 를 localhost:8080 으로 프록시하므로 비워두면 됩니다.
  // 백엔드를 직접 호출하려면 "http://localhost:8080" 으로 바꾸고 백엔드에 CORS 설정을 추가하세요.
  apiBase: "",
};
