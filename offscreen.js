"use strict";

const ALERT_SOUND_URL = chrome.runtime.getURL("sounds/alert.wav");
const alertAudio = new Audio(ALERT_SOUND_URL);
alertAudio.preload = "auto";
alertAudio.volume = 1.0;

async function playAlertSound() {
  try {
    alertAudio.pause();
    alertAudio.currentTime = 0;
    await alertAudio.play();
    return { ok: true };
  } catch (error) {
    console.warn("[PokerNow Hand Notifier] Could not play alert sound:", error);
    return { ok: false, error: String(error) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen" || message.type !== "PLAY_ALERT_SOUND") {
    return false;
  }

  playAlertSound().then(sendResponse);
  return true;
});
