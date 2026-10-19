// Vercel serves static files, so the dev server's dynamic /config.js is written out at build time.
// The Kakao JS key is public by design — it is restricted by registered domain, not by secrecy —
// but it still lives in Vercel's environment rather than in the repository.
const fs = require("node:fs");

const config = {
  kakaoJsKey: process.env.KAKAO_JS_KEY || "",
  // Left empty so the browser calls /api on this same origin, which vercel.json rewrites
  // to the backend. Same-origin means no CORS configuration on the backend.
  apiBase: "",
};

fs.writeFileSync("config.js", `window.APP_CONFIG = ${JSON.stringify(config)};\n`);
console.log(`config.js written (kakaoJsKey ${config.kakaoJsKey ? "set" : "MISSING"})`);
