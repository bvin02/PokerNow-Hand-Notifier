"use strict";

const NOTIFICATION_PREFIX = "pnhn";
const ICON_URL = chrome.runtime.getURL("icons/icon128.png");

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument = null;

async function ensureOffscreenAudioDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (contexts.length > 0) {
      return;
    }
  }

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play a short local chime when a PokerNow notification is created."
    })
    .catch((error) => {
      // Older Chrome versions may not expose getContexts. In that case,
      // creating an already-open document raises this harmless error.
      if (!/single offscreen document|already exists/i.test(String(error))) {
        throw error;
      }
    })
    .finally(() => {
      creatingOffscreenDocument = null;
    });

  await creatingOffscreenDocument;
}

async function playNotificationSound() {
  try {
    await ensureOffscreenAudioDocument();
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "PLAY_ALERT_SOUND"
    });
  } catch (error) {
    // A sound failure must never block the visible notification.
    console.warn("[PokerNow Hand Notifier] Alert sound failed:", error);
  }
}

function notificationIdForTab(tabId) {
  const safeTabId = Number.isInteger(tabId) ? tabId : -1;
  return `${NOTIFICATION_PREFIX}|${safeTabId}|${Date.now()}`;
}

async function showHandNotification({ hand, cards, tabId, windowId, isTest = false }) {
  const notificationId = notificationIdForTab(tabId);
  const cardText = Array.isArray(cards) && cards.length > 0 ? cards.join(" ") : hand;

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: ICON_URL,
    title: isTest ? "PokerNow notifier test" : `Good hand detected: ${hand}`,
    message: isTest
      ? "Notifications are working. Click this alert to return to the PokerNow tab."
      : `${cardText} matches your saved range. Click to return to the table.`,
    contextMessage: "PokerNow Hand Notifier",
    priority: 2,
    requireInteraction: true,
    silent: true
  });

  void playNotificationSound();

  if (Number.isInteger(tabId) && tabId >= 0) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#16a34a" });
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setTitle({
      tabId,
      title: isTest ? "Test notification sent" : `Good hand: ${hand}`
    });
  }

  await chrome.storage.local.set({
    lastNotification: {
      hand,
      cards,
      tabId,
      windowId,
      isTest,
      timestamp: Date.now()
    }
  });

  return notificationId;
}

async function showFlopNotification({ hand, cards, tabId, windowId }) {
  const notificationId = notificationIdForTab(tabId);
  const cardText = Array.isArray(cards) && cards.length > 0 ? cards.join(" ") : hand;

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: ICON_URL,
    title: "Flop dealt — your hand is still live",
    message: `${cardText}${hand ? ` (${hand})` : ""}. Click to return and play the flop.`,
    contextMessage: "PokerNow Hand Notifier",
    priority: 2,
    requireInteraction: true,
    silent: true
  });

  void playNotificationSound();

  if (Number.isInteger(tabId) && tabId >= 0) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
    await chrome.action.setBadgeText({ tabId, text: "F" });
    await chrome.action.setTitle({
      tabId,
      title: "Flop dealt — live hand"
    });
  }

  await chrome.storage.local.set({
    lastNotification: {
      type: "flop",
      hand,
      cards,
      tabId,
      windowId,
      timestamp: Date.now()
    }
  });

  return notificationId;
}

async function focusPokerNowTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch (error) {
    console.warn("[PokerNow Hand Notifier] Could not focus the original tab:", error);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "GOOD_HAND_DETECTED") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    showHandNotification({
      hand: message.hand,
      cards: message.cards,
      tabId,
      windowId
    })
      .then((notificationId) => sendResponse({ ok: true, notificationId }))
      .catch((error) => {
        console.error("[PokerNow Hand Notifier] Notification failed:", error);
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  if (message.type === "FLOP_REACHED_WITH_LIVE_HAND") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    showFlopNotification({
      hand: message.hand,
      cards: message.cards,
      tabId,
      windowId
    })
      .then((notificationId) => sendResponse({ ok: true, notificationId }))
      .catch((error) => {
        console.error("[PokerNow Hand Notifier] Flop notification failed:", error);
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  if (message.type === "TEST_NOTIFICATION") {
    (async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      const notificationId = await showHandNotification({
        hand: "AA",
        cards: ["A♠", "A♥"],
        tabId: activeTab?.id,
        windowId: activeTab?.windowId,
        isTest: true
      });
      sendResponse({ ok: true, notificationId });
    })().catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.type === "CLEAR_BADGE") {
    const tabId = sender.tab?.id;
    if (Number.isInteger(tabId)) {
      chrome.action.setBadgeText({ tabId, text: "" });
      chrome.action.setTitle({ tabId, title: "PokerNow Hand Notifier" });
    }
    return false;
  }

  return false;
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const [prefix, tabIdText] = notificationId.split("|");
  if (prefix !== NOTIFICATION_PREFIX) {
    return;
  }

  focusPokerNowTab(Number(tabIdText));
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  const [prefix, tabIdText] = notificationId.split("|");
  if (prefix !== NOTIFICATION_PREFIX) {
    return;
  }

  focusPokerNowTab(Number(tabIdText));
  chrome.notifications.clear(notificationId);
});
