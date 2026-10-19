// Vercel serves static files, so the dev server's dynamic /config.js is written out at build time.
// The Kakao JS key is public by design — it is restricted by registered domain, not by secrecy —
// but it still lives in Vercel's environment rather than in the repository.
const fs = require("node:fs");

const config = {
  kakaoJsKey: process.env.KAKAO_JS_KEY || "",
  // Set BACKEND in Vercel to make the browser call the API directly.
  apiBase: (process.env.BACKEND || "").replace(/\/+$/, ""),
};

fs.writeFileSync("config.js", `window.APP_CONFIG = ${JSON.stringify(config)};\n`);
console.log(`config.js written (kakaoJsKey ${config.kakaoJsKey ? "set" : "MISSING"}, BACKEND ${config.apiBase ? "set" : "MISSING"})`);
