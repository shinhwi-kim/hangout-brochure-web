"use strict";

const CONFIG = window.APP_CONFIG || {};
const API_BASE = (CONFIG.apiBase || "").replace(/\/$/, "");
const PAGE_SIZE = 300;
const MAX_PAGES = 30;
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };

// /api/hangout-categories 가 응답하지 않을 때 쓰는 코드 -> 표시 이름 폴백.
const CATEGORY_NAME_FALLBACK = {
  music: "음악",
  food: "음식",
  market: "마켓",
  art: "예술",
  sport: "스포츠",
  workshop: "워크숍",
  community: "커뮤니티",
  family: "가족",
};

const STATUS = {
  ending: { label: "곧 종료", order: 0 },
  ongoing: { label: "진행중", order: 1 },
  upcoming: { label: "곧 시작", order: 2 },
  ended: { label: "종료됨", order: 3 },
};

const state = {
  map: null,
  hangouts: [],
  markers: new Map(), // id -> { overlay, el, hangout, status, position }
  categories: [],
  categoriesLoaded: false,
  selectedCategories: new Set(),
  activeStatuses: new Set(["ending", "ongoing", "upcoming"]),
  onlyInView: true,
  selectedId: null,
  bubble: null,
  loading: false,
};

const $ = (sel) => document.querySelector(sel);
const el = {
  from: $("#from"),
  to: $("#to"),
  searchBtn: $("#searchBtn"),
  categoryToggle: $("#categoryToggle"),
  categoryLabel: $("#categoryLabel"),
  categoryDropdown: $("#categoryDropdown"),
  categoryList: $("#categoryList"),
  legend: $("#legend"),
  list: $("#list"),
  listSummary: $("#listSummary"),
  onlyInView: $("#onlyInView"),
  loading: $("#mapLoading"),
  keyGate: $("#keyGate"),
};

/* ------------------------------------------------------------------ dates */

const pad = (n) => String(n).padStart(2, "0");

function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localOffset() {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "2026-12-24" as local midnight. new Date(str) would read it as UTC and shift the day in KST. */
function parseDate(value) {
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatRange(startDate, endDate) {
  const fmt = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  const s = fmt(parseDate(startDate));
  const e = fmt(parseDate(endDate));
  return s === e ? s : `${s} ~ ${e}`;
}

/** Shown only when a card is open. Each entry yields null when the source gave us nothing. */
const DETAIL_ROWS = [
  ["시간", (h) => h.eventTimeDesc],
  ["장소", (h) => [h.locationName, h.address].filter(Boolean).join(" · ") || null],
  ["지역", (h) => h.district],
  ["주최", (h) => h.organizer],
  ["관람 대상", (h) => h.targetAudience],
  ["요금", (h) => (h.isFree === true ? "무료" : h.feeDesc || (h.isFree === false ? "유료" : null))],
  ["문의", (h) => h.contact],
  ["출연", (h) => h.performers],
  ["프로그램", (h) => h.programDesc],
  ["안내", (h) => h.etcDesc],
];

/** Sources give a day range plus free-text times such as "19:30" or "programme varies". */
function rangeText(hangout) {
  const range = formatRange(hangout.startDate, hangout.endDate);
  return hangout.eventTimeDesc ? `${range} · ${hangout.eventTimeDesc}` : range;
}

function dayDiff(target, from) {
  return Math.round((target - from) / 86400000);
}

function ddayText(hangout, status) {
  const today = startOfToday();
  if (status === "upcoming") {
    const d = dayDiff(parseDate(hangout.startDate), today);
    return d === 0 ? "오늘 시작" : `시작 D-${d}`;
  }
  if (status === "ended") return "종료";
  const d = dayDiff(parseDate(hangout.endDate), today);
  if (d === 0) return "오늘 종료";
  if (d === 1) return "내일 종료";
  return `종료 D-${d}`;
}

function statusOf(hangout) {
  const today = startOfToday().getTime();
  const starts = parseDate(hangout.startDate).getTime();
  const ends = parseDate(hangout.endDate).getTime();
  if (ends < today) return "ended";
  if (starts > today) return "upcoming";
  return ends <= today + 86400000 ? "ending" : "ongoing";
}

/* -------------------------------------------------------------------- api */

async function getJson(path, params) {
  const query = params ? `?${params.toString()}` : "";
  const res = await fetch(`${API_BASE}${path}${query}`);
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).message || "";
    } catch (_) {
      /* ignore */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` - ${detail}` : ""}`);
  }
  return res.json();
}

async function fetchCategories() {
  const items = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ size: "100" });
    if (cursor != null) params.set("cursor", String(cursor));
    const data = await getJson("/api/hangout-categories", params);
    items.push(...data.items);
    if (!data.hasNext || data.nextCursor == null) break;
    cursor = data.nextCursor;
  }
  return items;
}

async function fetchHangouts({ from, to, categories }) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ from, to, size: String(PAGE_SIZE) });
    categories.forEach((code) => params.append("categories", code));
    if (cursor) params.set("cursor", cursor);
    const data = await getJson("/api/hangouts", params);
    items.push(...data.items);
    if (!data.hasNext || !data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return items;
}

/* ------------------------------------------------------------------- kakao */

function loadKakaoSdk(appKey) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.onload = () => {
      if (!window.kakao || !window.kakao.maps) {
        reject(new Error("SDK 는 받았지만 kakao.maps 가 없습니다. 앱 키가 JavaScript 키가 맞는지 확인하세요."));
        return;
      }
      window.kakao.maps.load(() => {
        if (typeof window.kakao.maps.Map !== "function") {
          reject(new Error("kakao.maps.Map 을 사용할 수 없습니다. 도메인 등록을 확인하세요."));
          return;
        }
        resolve();
      });
    };
    script.onerror = () =>
      reject(
        new Error(
          `SDK 요청이 거부되었습니다 (dapi.kakao.com 401/403). 원인은 보통 둘 중 하나입니다: ` +
            `(1) JavaScript 키가 아닌 다른 키(REST API 키 등)를 넣었다 ` +
            `(2) 플랫폼 키 화면의 JavaScript SDK 도메인에 ${window.location.origin} 이 등록되지 않았다`
        )
      );
    document.head.appendChild(script);
  });
}

// 키·도메인 문제를 화면에 그대로 보여준다. 콘솔을 안 봐도 원인이 보이도록.
function showMapError(message, appKey) {
  const masked = appKey ? `${appKey.slice(0, 6)}…${appKey.slice(-4)} (${appKey.length}자)` : "(없음)";
  const panel = document.createElement("div");
  panel.className = "map-error";
  panel.innerHTML = `
    <h3>지도를 띄우지 못했습니다</h3>
    <p class="map-error__msg"></p>
    <dl>
      <dt>사용한 키</dt><dd class="js-key"></dd>
      <dt>현재 주소</dt><dd class="js-origin"></dd>
      <dt>등록해야 할 도메인</dt><dd class="js-origin2"></dd>
    </dl>
    <p class="map-error__hint">
      브라우저 콘솔(⌥⌘I)에 카카오가 찍는 메시지를 보면 키 문제인지 도메인 문제인지 확실해집니다.
    </p>
    <button type="button" class="btn btn--primary js-reset">키 다시 입력하기</button>
  `;
  panel.querySelector(".map-error__msg").textContent = message;
  panel.querySelector(".js-key").textContent = masked;
  panel.querySelector(".js-origin").textContent = window.location.href;
  panel.querySelector(".js-origin2").textContent = window.location.origin;
  panel.querySelector(".js-reset").addEventListener("click", () => {
    localStorage.removeItem("kakaoJsKey");
    window.location.reload();
  });
  document.getElementById("map").appendChild(panel);
}

function initMap() {
  state.map = new kakao.maps.Map(document.getElementById("map"), {
    center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
    level: 7,
  });
  state.map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  kakao.maps.event.addListener(state.map, "idle", () => {
    if (state.onlyInView) renderList();
  });
  kakao.maps.event.addListener(state.map, "click", () => closeBubble());
}

function createPin(hangout, status) {
  const pin = document.createElement("div");
  pin.className = `pin pin--${status}`;
  pin.title = hangout.title;
  pin.innerHTML = `
    <div class="pin__frame"><img class="pin__img" alt="" loading="lazy"></div>
    <div class="pin__tail"></div>
  `;
  const img = pin.querySelector(".pin__img");
  if (hangout.imageUrl) {
    img.src = hangout.imageUrl;
    // A broken poster should leave the status colour behind, not an empty frame.
    img.addEventListener("error", () => img.remove());
  } else {
    img.remove();
  }
  pin.addEventListener("click", (event) => {
    event.stopPropagation();
    select(hangout.id, { pan: false, openBubble: true, scrollList: true });
  });
  return pin;
}

function rebuildMarkers() {
  state.markers.forEach(({ overlay }) => overlay.setMap(null));
  state.markers.clear();
  closeBubble();

  const now = Date.now();
  state.hangouts.forEach((hangout) => {
    const status = statusOf(hangout);
    const position = new kakao.maps.LatLng(hangout.latitude, hangout.longitude);
    const pin = createPin(hangout, status);
    const overlay = new kakao.maps.CustomOverlay({
      position,
      content: pin,
      xAnchor: 0.5,
      yAnchor: 0.97,
      zIndex: 1000 - STATUS[status].order,
    });
    state.markers.set(hangout.id, { overlay, el: pin, hangout, status, position });
  });
  syncMarkerVisibility();
}

function syncMarkerVisibility() {
  state.markers.forEach(({ overlay, status }) => {
    overlay.setMap(state.activeStatuses.has(status) ? state.map : null);
  });
}

function fitToMarkers() {
  const visible = [...state.markers.values()].filter((m) => state.activeStatuses.has(m.status));
  if (visible.length === 0) return;
  if (visible.length === 1) {
    state.map.setCenter(visible[0].position);
    state.map.setLevel(5);
    return;
  }
  const bounds = new kakao.maps.LatLngBounds();
  visible.forEach((m) => bounds.extend(m.position));
  state.map.setBounds(bounds, 40, 40, 40, 40);
}

/* ------------------------------------------------------------------ bubble */

function closeBubble() {
  if (state.bubble) {
    state.bubble.setMap(null);
    state.bubble = null;
  }
}

function openBubble(marker) {
  closeBubble();
  const { hangout, status } = marker;
  const node = document.createElement("div");
  node.className = "bubble";
  node.innerHTML = `
    <button type="button" class="bubble__close" aria-label="닫기">&times;</button>
    <p class="bubble__title"></p>
    <p class="bubble__row"><span class="dot dot--${status}"></span> <b>${STATUS[status].label}</b> · <span class="js-dday"></span></p>
    <p class="bubble__row js-range"></p>
    <p class="bubble__row js-place"></p>
  `;
  node.querySelector(".bubble__title").textContent = hangout.title;
  node.querySelector(".js-dday").textContent = ddayText(hangout, status);
  node.querySelector(".js-range").textContent = rangeText(hangout);
  node.querySelector(".js-place").textContent = hangout.locationName || hangout.address || "";
  node.querySelector(".bubble__close").addEventListener("click", (event) => {
    event.stopPropagation();
    closeBubble();
  });
  node.addEventListener("click", (event) => event.stopPropagation());

  state.bubble = new kakao.maps.CustomOverlay({
    position: marker.position,
    content: node,
    xAnchor: 0.5,
    yAnchor: 1.25,
    zIndex: 2000,
  });
  state.bubble.setMap(state.map);
}

/* -------------------------------------------------------------------- list */

function visibleHangouts() {
  const bounds = state.onlyInView && state.map ? state.map.getBounds() : null;
  const result = [];
  state.markers.forEach((marker) => {
    if (!state.activeStatuses.has(marker.status)) return;
    if (bounds && !bounds.contain(marker.position)) return;
    result.push(marker);
  });
  result.sort((a, b) => {
    const order = STATUS[a.status].order - STATUS[b.status].order;
    if (order !== 0) return order;
    const key = a.status === "upcoming" ? "startDate" : "endDate";
    return parseDate(a.hangout[key]) - parseDate(b.hangout[key]);
  });
  return result;
}

function categoryName(code) {
  const found = state.categories.find((c) => c.code === code);
  if (found) return found.name;
  return CATEGORY_NAME_FALLBACK[code] || code;
}

// 카테고리 API 가 실패하면 조회된 행사들의 코드로 목록을 만든다.
function deriveCategoriesFromHangouts() {
  const codes = new Set();
  state.hangouts.forEach((hangout) => (hangout.categories || []).forEach((code) => codes.add(code)));
  const derived = [...codes]
    .sort()
    .map((code) => ({ id: code, code, name: CATEGORY_NAME_FALLBACK[code] || code }));
  const known = new Set(state.categories.map((c) => c.code));
  derived.forEach((category) => {
    if (!known.has(category.code)) {
      state.categories.push(category);
      state.selectedCategories.add(category.code);
    }
  });
  if (derived.length > 0) renderCategoryOptions();
}

function renderList() {
  const markers = visibleHangouts();
  const counts = { ending: 0, ongoing: 0, upcoming: 0, ended: 0 };
  state.markers.forEach((m) => {
    counts[m.status] += 1;
  });
  el.legend.querySelectorAll("[data-count]").forEach((node) => {
    node.textContent = counts[node.dataset.count];
  });

  el.listSummary.textContent = state.loading
    ? "불러오는 중…"
    : `${markers.length}건${state.onlyInView ? " (지도 영역 내)" : ""} / 전체 ${state.markers.size}건`;

  if (markers.length === 0) {
    el.list.innerHTML = `<div class="empty">${
      state.markers.size === 0
        ? "조건에 맞는 행사가 없습니다.<br />기간이나 카테고리를 바꿔보세요."
        : "지도 영역 안에 표시된 행사가 없습니다.<br />지도를 움직이거나 축소해보세요."
    }</div>`;
    return;
  }

  const now = Date.now();
  const fragment = document.createDocumentFragment();
  markers.forEach(({ hangout, status }) => {
    const card = document.createElement("article");
    card.className = `card card--${status}${hangout.id === state.selectedId ? " is-active" : ""}`;
    card.dataset.id = hangout.id;
    card.innerHTML = `
      <div class="card__top">
        <span class="badge">${STATUS[status].label}</span>
        <span class="card__dday"></span>
      </div>
      <div class="card__body">
        <img class="card__thumb js-thumb" alt="" loading="lazy" hidden>
        <div class="card__text">
          <h3 class="card__title"></h3>
          <div class="card__meta">
            <div>🗓 <span class="js-range"></span></div>
            <div>📍 <b class="js-place"></b><span class="js-address"></span></div>
            <div class="js-organizer" hidden></div>
          </div>
        </div>
      </div>
      <div class="chips"></div>
      <div class="card__detail">
        <dl class="detail js-detail-rows"></dl>
        <div class="card__links js-links"></div>
      </div>
    `;
    card.querySelector(".card__dday").textContent = ddayText(hangout, status);
    card.querySelector(".card__title").textContent = hangout.title;
    card.querySelector(".js-range").textContent = rangeText(hangout);
    card.querySelector(".js-place").textContent = hangout.locationName || "-";
    if (hangout.address && hangout.address !== hangout.locationName) {
      card.querySelector(".js-address").textContent = ` · ${hangout.address}`;
    }
    if (hangout.imageUrl) {
      const thumb = card.querySelector(".js-thumb");
      thumb.src = hangout.imageUrl;
      thumb.hidden = false;
      thumb.addEventListener("error", () => { thumb.hidden = true; });
    }
    if (hangout.organizer) {
      const org = card.querySelector(".js-organizer");
      org.textContent = `🏛 ${hangout.organizer}${hangout.isFree === true ? " · 무료" : ""}`;
      org.hidden = false;
    }
    const rows = card.querySelector(".js-detail-rows");
    DETAIL_ROWS.forEach(([label, read]) => {
      const value = read(hangout);
      if (!value) return;
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      rows.append(dt, dd);
    });
    const links = card.querySelector(".js-links");
    [["상세 보기", hangout.detailUrl], ["주최 홈페이지", hangout.organizerUrl]].forEach(([label, href]) => {
      if (!href) return;
      const link = document.createElement("a");
      link.className = "card__link";
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `${label} ↗`;
      link.addEventListener("click", (event) => event.stopPropagation());
      links.appendChild(link);
    });
    const chips = card.querySelector(".chips");
    (hangout.categories || []).forEach((code) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = categoryName(code);
      chips.appendChild(chip);
    });
    card.addEventListener("click", () => select(hangout.id, { pan: true, openBubble: true }));
    fragment.appendChild(card);
  });

  el.list.innerHTML = "";
  el.list.appendChild(fragment);
}

function select(id, { pan = false, openBubble: withBubble = false, scrollList = false } = {}) {
  const marker = state.markers.get(id);
  if (!marker) return;

  state.selectedId = id;
  state.markers.forEach(({ el: pinEl }) => pinEl.classList.remove("is-active"));
  marker.el.classList.add("is-active");

  el.list.querySelectorAll(".card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.id === id);
  });

  if (pan) state.map.panTo(marker.position);
  if (withBubble) openBubble(marker);
  if (scrollList) {
    const card = el.list.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/* ----------------------------------------------------------------- filters */

function renderCategoryOptions() {
  el.categoryList.innerHTML = "";
  state.categories.forEach((category) => {
    const label = document.createElement("label");
    label.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = category.code;
    input.checked = state.selectedCategories.has(category.code);
    input.addEventListener("change", () => {
      if (input.checked) state.selectedCategories.add(category.code);
      else state.selectedCategories.delete(category.code);
      updateCategoryLabel();
    });
    const text = document.createElement("span");
    text.textContent = category.name;
    label.append(input, text);
    el.categoryList.appendChild(label);
  });
  updateCategoryLabel();
}

function updateCategoryLabel() {
  const count = state.selectedCategories.size;
  if (count === 0 || count === state.categories.length) {
    el.categoryLabel.textContent = "전체";
    return;
  }
  const names = [...state.selectedCategories].map(categoryName);
  el.categoryLabel.textContent = count <= 2 ? names.join(", ") : `${names[0]} 외 ${count - 1}개`;
}

function setLoading(loading) {
  state.loading = loading;
  el.loading.hidden = !loading;
  el.searchBtn.disabled = loading;
  el.searchBtn.textContent = loading ? "검색 중…" : "검색";
}

async function search({ fit = true } = {}) {
  if (!el.from.value || !el.to.value) {
    alert("행사 시작/끝 날짜를 모두 선택하세요.");
    return;
  }
  if (el.from.value > el.to.value) {
    alert("시작일은 종료일보다 앞서야 합니다.");
    return;
  }

  setLoading(true);
  renderList();
  try {
    const categories =
      state.selectedCategories.size === state.categories.length ? [] : [...state.selectedCategories];
    state.hangouts = await fetchHangouts({
      from: el.from.value,
      to: el.to.value,
      categories,
    });
    state.selectedId = null;
    if (!state.categoriesLoaded) deriveCategoriesFromHangouts();
    rebuildMarkers();
    if (fit) fitToMarkers();
    renderList();
  } catch (error) {
    console.error(error);
    state.hangouts = [];
    rebuildMarkers();
    el.list.innerHTML = `<div class="empty">행사를 불러오지 못했습니다.<br /><small>${error.message}</small><br /><br />백엔드(localhost:8080)가 떠 있는지 확인하세요.</div>`;
  } finally {
    setLoading(false);
    if (state.markers.size > 0) renderList();
  }
}

function bindEvents() {
  el.searchBtn.addEventListener("click", () => search());
  [el.from, el.to].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") search();
    });
  });

  el.categoryToggle.addEventListener("click", () => {
    const open = el.categoryDropdown.hidden;
    el.categoryDropdown.hidden = !open;
    el.categoryToggle.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!el.categoryDropdown.hidden && !event.target.closest(".field--category")) {
      el.categoryDropdown.hidden = true;
      el.categoryToggle.setAttribute("aria-expanded", "false");
    }
  });
  el.categoryDropdown.querySelector("[data-select-all]").addEventListener("click", () => {
    state.categories.forEach((c) => state.selectedCategories.add(c.code));
    renderCategoryOptions();
  });
  el.categoryDropdown.querySelector("[data-clear-all]").addEventListener("click", () => {
    state.selectedCategories.clear();
    renderCategoryOptions();
  });

  el.legend.querySelectorAll(".legend__item").forEach((button) => {
    button.addEventListener("click", () => {
      const status = button.dataset.status;
      if (state.activeStatuses.has(status)) state.activeStatuses.delete(status);
      else state.activeStatuses.add(status);
      button.classList.toggle("is-on", state.activeStatuses.has(status));
      syncMarkerVisibility();
      closeBubble();
      renderList();
    });
  });

  el.onlyInView.addEventListener("change", () => {
    state.onlyInView = el.onlyInView.checked;
    renderList();
  });
}

/* -------------------------------------------------------------------- boot */

function resolveKey() {
  const stored = localStorage.getItem("kakaoJsKey");
  return (CONFIG.kakaoJsKey || stored || "").trim();
}

function askForKey() {
  const gate = el.keyGate;
  gate.hidden = false;
  document.getElementById("originHint").textContent = window.location.origin;
  const input = document.getElementById("keyInput");
  const save = () => {
    const value = input.value.trim();
    if (!value) return;
    localStorage.setItem("kakaoJsKey", value);
    window.location.reload();
  };
  document.getElementById("keySave").addEventListener("click", save);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save();
  });
  input.focus();
}

async function boot() {
  const today = new Date();
  const later = new Date();
  later.setDate(later.getDate() + 30);
  el.from.value = toDateInputValue(today);
  el.to.value = toDateInputValue(later);

  const key = resolveKey();
  if (!key) {
    askForKey();
    return;
  }

  bindEvents();

  try {
    await loadKakaoSdk(key);
    initMap();
  } catch (error) {
    // 키를 지우지 않는다. 지워버리면 새로고침마다 입력창만 다시 떠서 원인을 못 본다.
    console.error(error);
    showMapError(error.message, key);
    el.list.innerHTML = `<div class="empty">지도를 띄우지 못해 행사를 불러오지 않았습니다.<br />왼쪽의 안내를 확인하세요.</div>`;
    return;
  }

  try {
    state.categories = await fetchCategories();
    state.categoriesLoaded = state.categories.length > 0;
    state.categories.forEach((c) => state.selectedCategories.add(c.code));
    renderCategoryOptions();
  } catch (error) {
    // 카테고리 API 가 죽어 있어도 지도는 떠야 하므로 행사 목록에서 카테고리를 역산한다.
    console.warn("카테고리 API 호출 실패, 행사 목록에서 추출합니다.", error);
    state.categoriesLoaded = false;
  }

  await search();
}

boot();
