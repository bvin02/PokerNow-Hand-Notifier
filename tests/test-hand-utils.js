"use strict";

const assert = require("node:assert/strict");
const utils = require("../hand-utils.js");

assert.equal(
  utils.classifyHand([
    { rank: "A", suit: "s" },
    { rank: "K", suit: "s" }
  ]),
  "AKs"
);

assert.equal(
  utils.classifyHand([
    { rank: "K", suit: "h" },
    { rank: "A", suit: "s" }
  ]),
  "AKo"
);

assert.equal(
  utils.classifyHand([
    { rank: "10", suit: "c" },
    { rank: "T", suit: "d" }
  ]),
  "TT"
);

assert.deepEqual(utils.expandRangeInput("AA, AKs, AQ, 1010"), [
  "AA",
  "AKs",
  "AQs",
  "AQo",
  "TT"
]);

assert.deepEqual(utils.expandRangeInput("KAo, QAs"), ["AKo", "AQs"]);
assert.deepEqual(utils.expandRangeInput("bad, ZZ, AAs"), []);

assert.equal(
  utils.DEFAULT_RANGE_TEXT,
  "AA, KK, QQ, JJ, TT, 99, 88, 77, 66, AK, AQ, AJs, ATs, KQ, KJs, QJs, JTs"
);
assert.deepEqual(utils.DEFAULT_GOOD_HANDS, [
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66",
  "AKs", "AKo", "AQs", "AQo", "AJs", "ATs", "KQs", "KQo",
  "KJs", "QJs", "JTs"
]);
assert.deepEqual(utils.expandRangeInput(utils.DEFAULT_RANGE_TEXT), utils.DEFAULT_GOOD_HANDS);
assert.equal(
  utils.shouldMigrateLegacyDefaults(
    "AA, KK, QQ, JJ, TT, AKs, AKo, AQ, AJ",
    ["AA", "KK", "QQ", "JJ", "TT", "AKs", "AKo", "AQs", "AQo", "AJs", "AJo"]
  ),
  true
);
assert.equal(
  utils.shouldMigrateLegacyDefaults("AA, KK, 22", ["AA", "KK", "22"]),
  false
);

console.log("All hand utility tests passed.");
