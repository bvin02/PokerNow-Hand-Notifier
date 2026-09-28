"use strict";

const assert = require("node:assert/strict");
const { decideBadHandAction, inferHeroTurn } = require("../action-utils.js");

function decide(state) {
  const heroTurn = inferHeroTurn({
    hasTurnSignal: state.hasTurnSignal,
    canFold: state.canFold,
    canCheck: state.canCheck,
    canCall: state.canCall
  });

  return decideBadHandAction({
    isPreflop: true,
    heroTurn,
    position: "bb",
    canFold: state.canFold,
    canCheck: state.canCheck,
    canCall: state.canCall,
    callAmount: state.callAmount,
    smallBlind: 1,
    bigBlind: 1
  }).type;
}

// Exact reported sequence:
// 1. While other players are acting, PokerNow shows a queueable Check control.
//    The extension must do nothing, not queue/toggle Check.
assert.equal(
  decide({
    hasTurnSignal: false,
    canFold: true,
    canCheck: true,
    canCall: false,
    callAmount: null
  }),
  "none"
);

// 2. If action reaches the BB with no raise, the explicit turn signal permits
//    exactly one free Check.
assert.equal(
  decide({
    hasTurnSignal: true,
    canFold: true,
    canCheck: true,
    canCall: false,
    callAmount: null
  }),
  "check"
);

// 3. If somebody raises before action reaches the BB, the real-turn state has
//    a Call option. Even if stale Check is simultaneously visible, Fold wins.
assert.equal(
  decide({
    hasTurnSignal: true,
    canFold: true,
    canCheck: true,
    canCall: true,
    callAmount: 3
  }),
  "fold"
);

console.log("Queued pre-action regression sequence passed.");


// Small-blind free-check regression: in a 1/1 game, an unraised real-turn
// state can expose Check with no Call option. This must check, not fold.
{
  const heroTurn = inferHeroTurn({
    hasTurnSignal: true,
    canFold: true,
    canCheck: true,
    canCall: false
  });
  assert.equal(
    decideBadHandAction({
      isPreflop: true,
      heroTurn,
      position: "sb",
      canFold: true,
      canCheck: true,
      canCall: false,
      callAmount: null,
      smallBlind: 1,
      bigBlind: 1
    }).type,
    "check"
  );
}

// If a raise creates a Call option, a stale simultaneous Check must not be
// used. The small blind folds unless the call is a permitted completion.
{
  const heroTurn = inferHeroTurn({
    hasTurnSignal: true,
    canFold: true,
    canCheck: true,
    canCall: true
  });
  assert.equal(
    decideBadHandAction({
      isPreflop: true,
      heroTurn,
      position: "sb",
      canFold: true,
      canCheck: true,
      canCall: true,
      callAmount: 4,
      smallBlind: 1,
      bigBlind: 1
    }).type,
    "fold"
  );
}
