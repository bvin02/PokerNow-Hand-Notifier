"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const offscreen = fs.readFileSync(path.join(root, "offscreen.js"), "utf8");
const sound = fs.readFileSync(path.join(root, "sounds", "alert.wav"));

assert.equal(manifest.version, "1.2.0");
assert.ok(manifest.permissions.includes("offscreen"));
assert.match(background, /reasons: \["AUDIO_PLAYBACK"\]/);
assert.match(background, /void playNotificationSound\(\);/g);
assert.equal((background.match(/void playNotificationSound\(\);/g) || []).length, 2);
assert.match(offscreen, /new Audio\(ALERT_SOUND_URL\)/);
assert.match(offscreen, /alertAudio\.play\(\)/);
assert.equal(sound.subarray(0, 4).toString("ascii"), "RIFF");
assert.equal(sound.subarray(8, 12).toString("ascii"), "WAVE");
assert.ok(sound.length > 10000);

console.log("Notification sound regression checks passed.");
