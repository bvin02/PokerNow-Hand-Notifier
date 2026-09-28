"use strict";

const utils = globalThis.PokerHandUtils;
const enabledInput = document.getElementById("enabled");
const autoActionsInput = document.getElementById("autoActionsEnabled");
const rangeInput = document.getElementById("rangeText");
const saveButton = document.getElementById("save");
const testButton = document.getElementById("test");
const refreshButton = document.getElementById("refresh");
const statusElement = document.getElementById("status");
const detailsElement = document.getElementById("details");
const messageElement = document.getElementById("message");

function showMessage(text, isError = false) {
  messageElement.textContent = text;
  messageElement.classList.toggle("error", isError);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get({
    enabled: true,
    autoActionsEnabled: true,
    rangeText: utils.DEFAULT_RANGE_TEXT,
    goodHands: [...utils.DEFAULT_GOOD_HANDS]
  });

  const migrateDefaults = utils.shouldMigrateLegacyDefaults(
    stored.rangeText,
    stored.goodHands
  );

  enabledInput.checked = stored.enabled !== false;
  autoActionsInput.checked = stored.autoActionsEnabled !== false;
  rangeInput.value = migrateDefaults
    ? utils.DEFAULT_RANGE_TEXT
    : stored.rangeText || utils.DEFAULT_RANGE_TEXT;

  if (migrateDefaults) {
    await chrome.storage.sync.set({
      rangeText: utils.DEFAULT_RANGE_TEXT,
      goodHands: [...utils.DEFAULT_GOOD_HANDS]
    });
  }
}

async function saveSettings() {
  const rangeText = rangeInput.value.trim();
  const goodHands = utils.expandRangeInput(rangeText);

  if (goodHands.length === 0) {
    showMessage("No valid hands found. Example: AA, AKs, AQ, TT", true);
    return;
  }

  await chrome.storage.sync.set({
    enabled: enabledInput.checked,
    autoActionsEnabled: autoActionsInput.checked,
    rangeText,
    goodHands
  });

  showMessage(`Saved ${goodHands.length} exact good-hand combinations.`);
  await refreshStatus();
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isPokerNowGameTab(tab) {
  return Boolean(tab?.url && /^https?:\/\/[^/]*pokernow\.(com|club)\/games\//i.test(tab.url));
}

async function refreshStatus() {
  const tab = await getActiveTab();

  if (!isPokerNowGameTab(tab)) {
    statusElement.textContent = "Open a PokerNow game tab to see live detector status.";
    detailsElement.textContent = "";
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
    if (!response?.ok) {
      throw new Error("No detector response");
    }

    const live = response.liveScan || {};
    const status = response.status || {};
    statusElement.textContent = status.message || "Detector is running.";
    detailsElement.textContent = JSON.stringify(
      {
        cards: live.cards || [],
        hand: live.hand || null,
        matched: Boolean(live.matched),
        board: live.board || null,
        position: live.position || null,
        blinds: live.blinds || null,
        callAmount: live.callAmount ?? null,
        heroTurn: Boolean(live.heroTurn),
        buttons: live.buttons || null,
        actionHandled: Boolean(live.autoActionHandledForDeal),
        clickInFlight: live.actionClickInFlight || null,
        clickAttempts: live.actionClickAttemptsForState || live.actionClickAttemptsForDeal || 0,
        sawPostflop: Boolean(live.dealSawPostflop),
        flopNotificationHandled: Boolean(live.flopNotificationHandledForDeal),
        selector: live.selector || null
      },
      null,
      2
    );
  } catch (error) {
    statusElement.textContent = "Detector is not connected. Reload this PokerNow tab once after installing or updating the extension.";
    detailsElement.textContent = String(error);
  }
}

enabledInput.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: enabledInput.checked });
  showMessage(enabledInput.checked ? "Detector enabled." : "Detector disabled.");
  await refreshStatus();
});

autoActionsInput.addEventListener("change", async () => {
  await chrome.storage.sync.set({ autoActionsEnabled: autoActionsInput.checked });
  showMessage(
    autoActionsInput.checked
      ? "Bad-hand preflop auto-actions enabled for future deals."
      : "All automatic poker actions disabled."
  );
  await refreshStatus();
});

saveButton.addEventListener("click", () => {
  saveSettings().catch((error) => showMessage(String(error), true));
});

testButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TEST_NOTIFICATION" }, (response) => {
    if (chrome.runtime.lastError) {
      showMessage(chrome.runtime.lastError.message, true);
      return;
    }

    showMessage(response?.ok ? "Test notification sent." : response?.error || "Test failed.", !response?.ok);
  });
});

refreshButton.addEventListener("click", () => {
  refreshStatus().catch((error) => showMessage(String(error), true));
});

Promise.all([loadSettings(), refreshStatus()]).catch((error) => showMessage(String(error), true));
