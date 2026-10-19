// 의존성 없는 개발용 정적 서버 + /api 프록시.
//   node server.js            → http://localhost:5173
//   PORT=3000 BACKEND=http://localhost:8080 node server.js
// /api 요청을 백엔드로 그대로 넘겨주기 때문에 CORS 설정이 필요 없습니다.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Load .env, then .env.local without requiring a package. Shell variables win.
const fileEnv = {};
for (const fileName of [".env", ".env.local"]) {
  const envFile = path.join(__dirname, fileName);
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    fileEnv[match[1]] = value;
  }
}
for (const [name, value] of Object.entries(fileEnv)) {
  if (!Object.hasOwn(process.env, name)) process.env[name] = value;
}

const PORT = Number(process.env.PORT || 5173);
const BACKEND = process.env.BACKEND || "http://localhost:8080";
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith("/api/")) {
    try {
      const upstream = await fetch(`${BACKEND}${url.pathname}${url.search}`, {
        method: req.method,
        headers: { accept: req.headers.accept || "application/json" },
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/json",
      });
      res.end(body);
    } catch (error) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ message: `백엔드(${BACKEND}) 연결 실패: ${error.message}` }));
    }
    return;
  }

  if (url.pathname === "/config.js") {
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(`window.APP_CONFIG = ${JSON.stringify({ kakaoJsKey: process.env.KAKAO_JS_KEY || "", apiBase: "" })};\n`);
    return;
  }

  const relative = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(ROOT, path.normalize(relative).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`hangoutBrochure-web  →  http://localhost:${PORT}`);
  console.log(`API proxy            →  ${BACKEND}/api/*`);
});
