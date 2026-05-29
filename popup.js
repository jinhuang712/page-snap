const saveButton = document.querySelector("#save");
const formatSelect = document.querySelector("#format");
const scrollPageInput = document.querySelector("#scroll-page");
const includeReadableTextInput = document.querySelector("#include-readable-text");
const statusText = document.querySelector("#status");
const statusPill = document.querySelector("#status-pill");

function setStatus(kind, message) {
  statusText.textContent = message;
  statusPill.className = `status-pill ${kind === "ready" ? "" : kind}`;
  statusPill.textContent =
    kind === "busy" ? "Saving" : kind === "done" ? "Done" : kind === "error" ? "Error" : "Ready";
}

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  setStatus("busy", "Opening the capture window.");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
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
      url: chrome.runtime.getURL(`runner.html?${params.toString()}`),
      type: "popup",
      width: 430,
      height: 570,
      focused: true
    });

    setStatus("done", "Capture window opened.");
  } catch (error) {
    setStatus("error", error.message);
  } finally {
    saveButton.disabled = false;
  }
});

setStatus("ready", "Choose a format and save the current page.");
