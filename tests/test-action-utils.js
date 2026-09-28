"use strict";

const assert = require("node:assert/strict");
const { decideBadHandAction, inferHeroTurn, positionFromDealerOrder } = require("../action-utils.js");

const base = {
  isPreflop: true,
  heroTurn: true,
  position: "other",
  canFold: true,
  canCheck: false,
  canCall: true,
  callAmount: 2,
  smallBlind: 1,
  bigBlind: 2
};

assert.equal(decideBadHandAction(base).type, "fold");

assert.equal(
  decideBadHandAction({ ...base, position: "sb", callAmount: 1 }).type,
  "call"
);

assert.equal(
  decideBadHandAction({ ...base, position: "sb", callAmount: 1.01 }).type,
  "fold"
);

assert.equal(
  decideBadHandAction({ ...base, position: "sb", callAmount: 1, smallBlind: null }).type,
  "fold"
);

// Regression: in equal-blind games such as 1/1, the small blind may have a
// genuinely free Check when action reaches it unraised.
assert.equal(
  decideBadHandAction({
    ...base,
    position: "sb",
    canCheck: true,
    canCall: false,
    callAmount: null,
    smallBlind: 1,
    bigBlind: 1
  }).type,
  "check"
);

// A visible Call option wins over a simultaneously rendered Check. Facing a
// raise must therefore fold rather than use a stale Check control.
assert.equal(
  decideBadHandAction({
    ...base,
    position: "sb",
    canCheck: true,
    canCall: true,
    callAmount: 3,
    smallBlind: 1,
    bigBlind: 1
  }).type,
  "fold"
);

// In a normal 1/2 game, Check + a valid one-chip completion still completes.
assert.equal(
  decideBadHandAction({
    ...base,
    position: "sb",
    canCheck: true,
    canCall: true,
    callAmount: 1,
    smallBlind: 1,
    bigBlind: 2
  }).type,
  "call"
);

assert.equal(
  decideBadHandAction({
    ...base,
    position: "bb",
    canCheck: true,
    canCall: false,
    callAmount: null
  }).type,
  "check"
);

// Regression: PokerNow may briefly render both Check and Call after a raise.
// Any visible Call option means the big blind is facing a wager and must fold.
assert.equal(
  decideBadHandAction({
    ...base,
    position: "bb",
    canCheck: true,
    canCall: true,
    callAmount: 4
  }).type,
  "fold"
);

assert.equal(
  decideBadHandAction({ ...base, position: "bb", canCheck: false, canCall: true }).type,
  "fold"
);

assert.equal(
  decideBadHandAction({
    ...base,
    position: "bb",
    canCheck: true,
    canCall: true,
    callAmount: null
  }).type,
  "fold"
);

assert.equal(
  decideBadHandAction({ ...base, position: "unknown" }).type,
  "fold"
);

assert.equal(
  decideBadHandAction({ ...base, isPreflop: false }).type,
  "none"
);

assert.equal(
  decideBadHandAction({ ...base, heroTurn: false }).type,
  "none"
);

assert.equal(
  decideBadHandAction({ ...base, canFold: false, canCall: false }).type,
  "none"
);


// Explicit PokerNow turn signal.
assert.equal(
  inferHeroTurn({ hasTurnSignal: true, canFold: true, canCheck: false, canCall: true }),
  true
);

// Regression: PokerNow exposes these same buttons as toggleable pre-actions
// before the hero's turn. Buttons without an explicit turn signal must never
// trigger an automatic click.
assert.equal(
  inferHeroTurn({ hasTurnSignal: false, canFold: true, canCheck: false, canCall: true }),
  false
);
assert.equal(
  inferHeroTurn({ hasTurnSignal: false, canFold: true, canCheck: true, canCall: false }),
  false
);

// A lone stale Fold control must not be treated as the hero's turn.
assert.equal(
  inferHeroTurn({ hasTurnSignal: false, canFold: true, canCheck: false, canCall: false }),
  false
);
assert.equal(
  inferHeroTurn({ hasTurnSignal: false, canFold: false, canCheck: false, canCall: false }),
  false
);

assert.equal(positionFromDealerOrder(0, 2), "sb");
assert.equal(positionFromDealerOrder(1, 2), "bb");
assert.equal(positionFromDealerOrder(0, 6), "other");
assert.equal(positionFromDealerOrder(1, 6), "sb");
assert.equal(positionFromDealerOrder(2, 6), "bb");
assert.equal(positionFromDealerOrder(7, 6), "unknown");

console.log("All action utility tests passed.");
