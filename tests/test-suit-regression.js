"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const utils = require("../hand-utils.js");

// Current live PokerNow DOM confirmed from DevTools:
// card-{suit} carries the suit and card-s-{rank} carries the rank.
assert.deepEqual(
  utils.parsePokerNowCardContainerClassTokens([
    "card-container", "card-d", "card-s-A", "flipped", "card-p1", "med", "sub-suit"
  ]),
  { rank: "A", suit: "d" }
);
assert.deepEqual(
  utils.parsePokerNowCardContainerClassTokens([
    "card-container", "card-h", "card-s-5", "flipped", "card-p2", "med", "sub-suit"
  ]),
  { rank: "5", suit: "h" }
);
assert.deepEqual(
  utils.parsePokerNowCardContainerClassTokens([
    "card-container", "card-c", "card-s-Q", "flipped"
  ]),
  { rank: "Q", suit: "c" }
);
assert.deepEqual(
  utils.parsePokerNowCardContainerClassTokens([
    "card-container", "card-s", "card-s-5", "flipped"
  ]),
  { rank: "5", suit: "s" }
);

// Critical regression: card-s-A by itself is rank A, not ace of spades.
assert.deepEqual(
  utils.parseExactCardIdentityClassTokens(["card-container", "card-s-A"]),
  { rank: "A", suit: null }
);
assert.deepEqual(
  utils.parseExactCardIdentityClassTokens(["card-container", "card-d", "card-s-A"]),
  { rank: "A", suit: "d" }
);

// Conservative legacy shapes still work when they are unambiguous.
assert.deepEqual(utils.parseExactCardIdentityClassTokens(["card-Q-d"]), {
  rank: "Q",
  suit: "d"
});
assert.deepEqual(utils.parseExactCardIdentityClassTokens(["card-clubs-10"]), {
  rank: "T",
  suit: "c"
});

// The exact examples shown by the user classify correctly.
assert.equal(
  utils.classifyHand([
    utils.parsePokerNowCardContainerClassTokens(["card-d", "card-s-7"]),
    utils.parsePokerNowCardContainerClassTokens(["card-c", "card-s-Q"])
  ]),
  "Q7o"
);
assert.equal(
  utils.classifyHand([
    utils.parsePokerNowCardContainerClassTokens(["card-s", "card-s-5"]),
    utils.parsePokerNowCardContainerClassTokens(["card-h", "card-s-5"])
  ]),
  "55"
);
assert.equal(
  utils.classifyHand([
    utils.parsePokerNowCardContainerClassTokens(["card-d", "card-s-A"]),
    utils.parsePokerNowCardContainerClassTokens(["card-d", "card-s-4"])
  ]),
  "A4s"
);

assert.equal(
  utils.classifyHand([
    { rank: "A", suit: "s" },
    { rank: "K", suit: "s" }
  ]),
  "AKs"
);
assert.equal(
  utils.classifyHand([
    { rank: "A", suit: "s" },
    { rank: "K", suit: "h" }
  ]),
  "AKo"
);

assert.deepEqual(utils.expandRangeInput("AK suited, AQ offsuit, AJ off-suit"), [
  "AKs",
  "AQo",
  "AJo"
]);

const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
assert.match(contentSource, /querySelectorAll\("\.suit"\)/);
assert.match(contentSource, /getComputedStyle\(element, "::before"\)\.content/);
assert.match(contentSource, /parsePokerNowCardContainerClassTokens/);
assert.doesNotMatch(contentSource, /card-s-\*.*spade/i);

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);
assert.equal(manifest.version, "1.2.0");

console.log("All live PokerNow suited/offsuit regression tests passed.");
