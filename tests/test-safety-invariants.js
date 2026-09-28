"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

assert.match(source, /Critical invariant: good hands are notification-only and never auto-click/);
assert.match(source, /boardState\.visibleCount !== 0 \|\| dealSawPostflop/);
assert.match(source, /settings\.goodHands\.includes\(liveHand\)/);
assert.match(source, /targetButton\.click\(\)/);
assert.doesNotMatch(source, /button\.raise/);
assert.doesNotMatch(source, /button\.bet/);
assert.doesNotMatch(source, /all-?in/i);
assert.match(source, /BLIND_EXCEPTION_CONFIRM_MS = 700/);
assert.match(source, /snapshot\.position === "sb" && \(decision\.type === "call" \|\| decision\.type === "check"\)/);
assert.match(source, /MAX_ACTION_CLICK_ATTEMPTS_PER_STATE = 1/);
assert.match(source, /verifyActionClick\(flight\)/);
assert.match(source, /actionClickInFlight/);
assert.match(source, /findVisibleActionPanels/);
assert.match(source, /inferHeroTurn/);
assert.match(source, /out-of-turn pre-action toggles/);
assert.match(source, /exhaustedActionSignature = flight\.signature/);
assert.match(source, /syncActionAttemptBudget\(liveSignature\)/);
assert.match(source, /after its single click/);
assert.doesNotMatch(source, /state: "retrying-action"/);


console.log("All static safety invariants passed.");
