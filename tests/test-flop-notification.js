"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const utils = require("../hand-utils.js");

const base = {
  boardRecognized: true,
  visibleBoardCards: 3,
  heroCardCount: 2,
  heroFolded: false,
  alreadyNotified: false
};

assert.equal(utils.shouldNotifyFlop(base), true);
assert.equal(utils.shouldNotifyFlop({ ...base, visibleBoardCards: 0 }), false);
assert.equal(utils.shouldNotifyFlop({ ...base, visibleBoardCards: 4 }), false);
assert.equal(utils.shouldNotifyFlop({ ...base, visibleBoardCards: 5 }), false);
assert.equal(utils.shouldNotifyFlop({ ...base, heroCardCount: 0 }), false);
assert.equal(utils.shouldNotifyFlop({ ...base, heroCardCount: 1 }), false);
assert.equal(utils.shouldNotifyFlop({ ...base, heroFolded: true }), false);
assert.equal(utils.shouldNotifyFlop({ ...base, alreadyNotified: true }), false);
assert.equal(utils.shouldNotifyFlop({ ...base, boardRecognized: false }), false);

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
assert.match(content, /FLOP_REACHED_WITH_LIVE_HAND/);
assert.match(content, /maybeNotifyOnFlop\(hand, cards, boardState\)/);
assert.ok(
  content.indexOf("maybeNotifyOnFlop(hand, cards, boardState)") < content.indexOf("if (!hand)"),
  "flop notification must not depend on successful hand classification"
);
assert.match(content, /never inspects or clicks any postflop action button/);
assert.match(background, /Flop dealt — your hand is still live/);

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
assert.equal(manifest.version, "1.2.0");

console.log("All flop notification tests passed.");
