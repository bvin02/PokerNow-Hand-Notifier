(function attachPokerActionUtils(globalObject) {
  "use strict";

  const EPSILON = 0.000001;

  function finitePositive(value) {
    return Number.isFinite(value) && value > 0;
  }

  function noAction(reason) {
    return { type: "none", reason };
  }

  /**
   * Decide the only permitted automatic action for a NON-GOOD starting hand.
   * This function is intentionally fail-closed: uncertainty never produces a
   * call or check. The caller must separately guarantee that the hand is bad.
   */
  function decideBadHandAction(input) {
    const state = input || {};

    if (!state.isPreflop) {
      return noAction("Not confirmed preflop.");
    }

    if (!state.heroTurn) {
      return noAction("It is not the hero's turn.");
    }

    if (state.position === "bb") {
      // A visible Call button means chips are owed. Check this before the
      // Check button because PokerNow can briefly leave both buttons mounted
      // during a UI transition after a raise. Big blind must never call.
      if (state.canCall) {
        if (state.canFold) {
          return {
            type: "fold",
            reason: "Bad hand in the big blind facing a wager; never call."
          };
        }

        return noAction("Big blind is facing a wager, but no safe fold button is available.");
      }

      if (state.canCheck) {
        return {
          type: "check",
          reason: "Bad hand in the big blind with a free check available."
        };
      }

      if (state.canFold) {
        return {
          type: "fold",
          reason: "Bad hand in the big blind without a confirmed free check."
        };
      }

      return noAction("No safe big-blind action button is available.");
    }

    if (state.position === "sb") {
      // A visible Call button means chips may be owed. Evaluate it before a
      // simultaneously rendered Check button so a stale Check can never win
      // after a raise. When no Call option exists, a real enabled Check is a
      // genuinely free action (notably in equal-blind games such as 1/1).
      if (state.canCall) {
        const callIsExactlyACompletion =
          finitePositive(state.callAmount) &&
          finitePositive(state.smallBlind) &&
          finitePositive(state.bigBlind) &&
          state.smallBlind < state.bigBlind &&
          state.callAmount <= state.smallBlind + EPSILON;

        if (callIsExactlyACompletion) {
          return {
            type: "call",
            reason: "Bad hand in the small blind; completing by no more than the small blind."
          };
        }

        if (state.canFold) {
          return {
            type: "fold",
            reason: "Bad hand in the small blind facing a wager or an ambiguous call amount."
          };
        }

        return noAction("Small blind may owe chips, but no safe fold button is available.");
      }

      if (state.canCheck) {
        return {
          type: "check",
          reason: "Bad hand in the small blind with a genuinely free check available."
        };
      }

      if (state.canFold) {
        return {
          type: "fold",
          reason: "Bad hand in the small blind without a confirmed free check or safe completion."
        };
      }

      return noAction("No safe small-blind action button is available.");
    }

    if (state.canFold) {
      return {
        type: "fold",
        reason: state.position === "unknown"
          ? "Bad hand with unknown position; fail closed by folding."
          : "Bad hand outside the blinds."
      };
    }

    return noAction("Fold button is not safely available.");
  }



  /**
   * PokerNow exposes the same Fold/Check/Call controls before the hero's turn
   * as toggleable pre-actions. Therefore enabled buttons alone are NEVER proof
   * that the hero may act. Require an explicit hero-turn signal plus at least
   * one usable action button. This prevents queued actions from being toggled
   * on/off while other players are still deciding.
   */
  function inferHeroTurn(input) {
    const state = input || {};
    const hasAnyAction = Boolean(state.canFold || state.canCheck || state.canCall);
    return Boolean(state.hasTurnSignal && hasAnyAction);
  }

  function positionFromDealerOrder(heroIndex, activePlayers) {
    if (!Number.isInteger(heroIndex) || !Number.isInteger(activePlayers) || activePlayers < 2) {
      return "unknown";
    }

    if (heroIndex < 0 || heroIndex >= activePlayers) {
      return "unknown";
    }

    // Heads-up: the dealer/button posts the small blind.
    if (activePlayers === 2) {
      return heroIndex === 0 ? "sb" : "bb";
    }

    if (heroIndex === 1) return "sb";
    if (heroIndex === 2) return "bb";
    return "other";
  }

  const api = Object.freeze({
    decideBadHandAction,
    inferHeroTurn,
    positionFromDealerOrder
  });

  globalObject.PokerActionUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
