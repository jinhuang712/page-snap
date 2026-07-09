const I18N = {
  en: {
    langToggle: "中文",
    format: "Format",
    scroll: "Scroll full page first",
    readable: "Include readable text",
    capture: "Capture page",
    pill_ready: "Ready",
    pill_saving: "Saving",
    pill_done: "Done",
    pill_error: "Error",
    status_ready: "Choose a format and save the current page.",
    status_opening: "Opening the capture window.",
    status_opened: "Capture window opened.",
    err_no_tab: "No active tab found."
  },
  zh: {
    langToggle: "EN",
    format: "格式",
    scroll: "先滚动整页",
    readable: "包含可读文本",
    capture: "捕获页面",
    pill_ready: "就绪",
    pill_saving: "保存中",
    pill_done: "完成",
    pill_error: "错误",
    status_ready: "选择格式并保存当前页面。",
    status_opening: "正在打开捕获窗口。",
    status_opened: "捕获窗口已打开。",
    err_no_tab: "未找到活动标签页。"
  }
};

const storedLang = localStorage.getItem("pagesnap-lang");
let lang = storedLang || ((navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en");
const t = () => I18N[lang] || I18N.en;

const saveButton = document.querySelector("#save");
const formatSelect = document.querySelector("#format");
const scrollPageInput = document.querySelector("#scroll-page");
const includeReadableTextInput = document.querySelector("#include-readable-text");
const statusText = document.querySelector("#status");
const statusPill = document.querySelector("#status-pill");
const langButton = document.querySelector("#lang");

const PILL = { ready: "pill_ready", busy: "pill_saving", done: "pill_done", error: "pill_error" };
let lastStatus = { kind: "ready", key: "status_ready", raw: null };

function renderStatus() {
  const { kind, key, raw } = lastStatus;
  statusText.textContent = raw || t()[key] || "";
  statusPill.className = `status-pill ${kind === "ready" ? "" : kind}`;
  statusPill.textContent = t()[PILL[kind]] || t().pill_ready;
}

function setStatus(kind, key, raw) {
  lastStatus = { kind, key: key || "", raw: raw || null };
  renderStatus();
}

function applyI18n() {
  const d = t();
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = d[el.dataset.i18n];
  });
  renderStatus();
}

langButton.addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  localStorage.setItem("pagesnap-lang", lang);
  applyI18n();
});

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  setStatus("busy", "status_opening");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("no_tab");
    }

    const params = new URLSearchParams({
      tabId: String(tab.id),
      tabUrl: tab.url || "",
      tabTitle: tab.title || "",
      format: formatSelect.value,
      scrollPage: scrollPageInput.checked ? "1" : "0",
      includeReadableText: includeReadableTextInput.checked ? "1" : "0"
    });
    await chrome.windows.create({
      url: chrome.runtime.getURL(`runner/runner.html?${params.toString()}`),
      type: "popup",
      width: 430,
      height: 570,
      focused: true
    });

    setStatus("done", "status_opened");
  } catch (error) {
    const known = error.message === "no_tab" ? "err_no_tab" : "";
    setStatus("error", known, known ? null : error.message);
  } finally {
    saveButton.disabled = false;
  }
});

applyI18n();
setStatus("ready", "status_ready");
