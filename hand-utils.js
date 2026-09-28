(function attachPokerHandUtils(globalObject) {
  "use strict";

  const RANK_ORDER = Object.freeze({
    A: 14,
    K: 13,
    Q: 12,
    J: 11,
    T: 10,
    9: 9,
    8: 8,
    7: 7,
    6: 6,
    5: 5,
    4: 4,
    3: 3,
    2: 2
  });

  const DEFAULT_RANGE_TEXT = "AA, KK, QQ, JJ, TT, 99, 88, 77, 66, AK, AQ, AJs, ATs, KQ, KJs, QJs, JTs";
  const DEFAULT_GOOD_HANDS = Object.freeze([
    "AA",
    "KK",
    "QQ",
    "JJ",
    "TT",
    "99",
    "88",
    "77",
    "66",
    "AKs",
    "AKo",
    "AQs",
    "AQo",
    "AJs",
    "ATs",
    "KQs",
    "KQo",
    "KJs",
    "QJs",
    "JTs"
  ]);

  const LEGACY_DEFAULT_RANGE_TEXTS = Object.freeze([
    "AA, KK, QQ, JJ, TT, AKs, AKo, AQ, AJ"
  ]);

  const LEGACY_DEFAULT_GOOD_HANDS = Object.freeze([
    "AA",
    "KK",
    "QQ",
    "JJ",
    "TT",
    "AKs",
    "AKo",
    "AQs",
    "AQo",
    "AJs",
    "AJo"
  ]);

  function normalizeRank(rank) {
    const value = String(rank ?? "")
      .trim()
      .toUpperCase()
      .replace(/10/g, "T");

    return Object.prototype.hasOwnProperty.call(RANK_ORDER, value) ? value : null;
  }

  function normalizeSuit(suit) {
    const raw = String(suit ?? "").trim().toLowerCase();

    const suitMap = {
      "♠": "s",
      "spade": "s",
      "spades": "s",
      "s": "s",
      "♥": "h",
      "heart": "h",
      "hearts": "h",
      "h": "h",
      "♦": "d",
      "diamond": "d",
      "diamonds": "d",
      "d": "d",
      "♣": "c",
      "club": "c",
      "clubs": "c",
      "c": "c"
    };

    return suitMap[raw] || null;
  }

  function classifyHand(cards) {
    if (!Array.isArray(cards) || cards.length !== 2) {
      return null;
    }

    const normalizedCards = cards.map((card) => ({
      rank: normalizeRank(card?.rank),
      suit: normalizeSuit(card?.suit)
    }));

    if (normalizedCards.some((card) => !card.rank)) {
      return null;
    }

    let [first, second] = normalizedCards;

    if (RANK_ORDER[second.rank] > RANK_ORDER[first.rank]) {
      [first, second] = [second, first];
    }

    if (first.rank === second.rank) {
      return `${first.rank}${second.rank}`;
    }

    if (!first.suit || !second.suit) {
      return null;
    }

    const suffix = first.suit === second.suit ? "s" : "o";
    return `${first.rank}${second.rank}${suffix}`;
  }

  function cleanRangeToken(token) {
    let cleaned = String(token ?? "")
      .trim()
      .replace(/10/gi, "T")
      .toUpperCase()
      .replace(/[\s_-]+/g, "");

    // Accept both standard shorthand and plain-English range entries.
    // Examples: "AK suited", "AK offsuit", "AK off-suit".
    cleaned = cleaned
      .replace(/OFFSUIT(?:ED|E)?$/, "O")
      .replace(/SUITED$/, "S");

    return cleaned;
  }

  function normalizeClassTokens(classTokens) {
    return Array.isArray(classTokens)
      ? classTokens.map((token) => String(token || "").trim()).filter(Boolean)
      : String(classTokens ?? "").split(/\s+/).filter(Boolean);
  }

  function parsePokerNowCardContainerClassTokens(classTokens) {
    const tokens = normalizeClassTokens(classTokens);
    const ranks = [];
    const suits = [];

    for (const token of tokens) {
      // Current PokerNow DOM shape, confirmed from DevTools:
      //   card-d   -> diamonds
      //   card-h   -> hearts
      //   card-c   -> clubs
      //   card-s   -> spades
      //   card-s-A -> rank A (the middle "s" is NOT the spade suit)
      let match = token.match(/^card-([shdc])$/i);
      if (match) {
        const suit = normalizeSuit(match[1]);
        if (suit) suits.push(suit);
        continue;
      }

      match = token.match(/^card-s-(10|[2-9TJQKA])$/i);
      if (match) {
        const rank = normalizeRank(match[1]);
        if (rank) ranks.push(rank);
      }
    }

    const uniqueRanks = [...new Set(ranks)];
    const uniqueSuits = [...new Set(suits)];

    return {
      rank: uniqueRanks.length === 1 ? uniqueRanks[0] : null,
      suit: uniqueSuits.length === 1 ? uniqueSuits[0] : null
    };
  }

  function parseExactCardIdentityClassTokens(classTokens) {
    const tokens = normalizeClassTokens(classTokens);
    const current = parsePokerNowCardContainerClassTokens(tokens);

    // If the current PokerNow shape yielded anything, do not reinterpret
    // card-s-A as "ace of spades". On the live site it means rank A.
    if (current.rank || current.suit) {
      return current;
    }

    const identities = [];

    for (const token of tokens) {
      // Conservative legacy fallbacks only. The ambiguous card-s-RANK form is
      // intentionally excluded because current PokerNow uses it for rank.
      let match = token.match(/^card-(10|[2-9TJQKA])-([shdc])$/i);
      if (match) {
        identities.push({
          rank: normalizeRank(match[1]),
          suit: normalizeSuit(match[2])
        });
        continue;
      }

      match = token.match(/^card-(spades?|hearts?|diamonds?|clubs?)-(10|[2-9TJQKA])$/i);
      if (match) {
        identities.push({
          rank: normalizeRank(match[2]),
          suit: normalizeSuit(match[1])
        });
      }
    }

    const valid = identities.filter((identity) => identity.rank && identity.suit);
    const unique = new Map(valid.map((identity) => [
      `${identity.rank}${identity.suit}`,
      identity
    ]));

    return unique.size === 1
      ? [...unique.values()][0]
      : { rank: null, suit: null };
  }

  function parseSuitClassTokens(classTokens) {
    const tokens = normalizeClassTokens(classTokens);
    const explicitDetected = [];
    const bareDetected = [];

    for (const rawToken of tokens) {
      const token = rawToken.toLowerCase();

      // Named/prefixed classes are strong identity evidence. PokerNow can place
      // a generic single-letter styling class such as `s` on every suit node,
      // alongside the real class (`su-diamonds`, `su-clubs`, etc.). The real
      // named class must win instead of being treated as a conflict.
      let match = token.match(/^(?:su|suit|card-suit)[-_](s|h|d|c|spades?|hearts?|diamonds?|clubs?)$/i);
      if (!match) {
        match = token.match(/^(spades?|hearts?|diamonds?|clubs?)$/i);
      }

      if (match) {
        const suit = normalizeSuit(match[1]);
        if (suit) {
          explicitDetected.push(suit);
        }
        continue;
      }

      // Retain bare-letter support only as a last resort for utility callers.
      // DOM extraction does not use this weak evidence by itself.
      if (/^[shdc]$/i.test(token)) {
        const suit = normalizeSuit(token);
        if (suit) {
          bareDetected.push(suit);
        }
      }
    }

    const explicitUnique = [...new Set(explicitDetected)];
    if (explicitUnique.length > 0) {
      return explicitUnique.length === 1 ? explicitUnique[0] : null;
    }

    const bareUnique = [...new Set(bareDetected)];
    return bareUnique.length === 1 ? bareUnique[0] : null;
  }

  function parseStrongSuitClassTokens(classTokens) {
    const tokens = normalizeClassTokens(classTokens);
    const detected = [];

    for (const rawToken of tokens) {
      const token = rawToken.toLowerCase();
      let match = token.match(/^(?:su|suit|card-suit)[-_](s|h|d|c|spades?|hearts?|diamonds?|clubs?)$/i);
      if (!match) {
        match = token.match(/^(spades?|hearts?|diamonds?|clubs?)$/i);
      }

      if (match) {
        const suit = normalizeSuit(match[1]);
        if (suit) {
          detected.push(suit);
        }
      }
    }

    const unique = [...new Set(detected)];
    return unique.length === 1 ? unique[0] : null;
  }

  function parseCardClassTokens(classTokens) {
    const exactIdentity = parseExactCardIdentityClassTokens(classTokens);
    if (exactIdentity.rank && exactIdentity.suit) {
      return exactIdentity;
    }

    return {
      rank: null,
      suit: parseSuitClassTokens(classTokens)
    };
  }

  function expandRangeToken(token) {
    const cleaned = cleanRangeToken(token);
    if (!cleaned) {
      return [];
    }

    const match = cleaned.match(/^([AKQJT2-9])([AKQJT2-9])([SO])?$/);
    if (!match) {
      return [];
    }

    let [, first, second, suffix] = match;

    if (RANK_ORDER[second] > RANK_ORDER[first]) {
      [first, second] = [second, first];
    }

    if (first === second) {
      return suffix ? [] : [`${first}${second}`];
    }

    if (suffix) {
      return [`${first}${second}${suffix.toLowerCase()}`];
    }

    // AQ means both AQs and AQo.
    return [`${first}${second}s`, `${first}${second}o`];
  }

  function expandRangeInput(input) {
    const tokens = Array.isArray(input)
      ? input
      : String(input ?? "").split(/[,;\n]+/);

    const expanded = [];
    const seen = new Set();

    for (const token of tokens) {
      for (const hand of expandRangeToken(token)) {
        if (!seen.has(hand)) {
          seen.add(hand);
          expanded.push(hand);
        }
      }
    }

    return expanded;
  }

  function normalizedRangeText(value) {
    return String(value ?? "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/10/g, "T");
  }

  function sameHandSet(first, second) {
    const firstSet = new Set(expandRangeInput(first));
    const secondSet = new Set(expandRangeInput(second));

    if (firstSet.size !== secondSet.size) {
      return false;
    }

    for (const hand of firstSet) {
      if (!secondSet.has(hand)) {
        return false;
      }
    }

    return true;
  }

  function shouldNotifyFlop({
    boardRecognized,
    visibleBoardCards,
    heroCardCount,
    heroFolded,
    alreadyNotified
  } = {}) {
    return (
      boardRecognized === true &&
      Number(visibleBoardCards) === 3 &&
      Number(heroCardCount) === 2 &&
      heroFolded !== true &&
      alreadyNotified !== true
    );
  }

  function shouldMigrateLegacyDefaults(rangeText, goodHands) {
    const textMatchesLegacy = LEGACY_DEFAULT_RANGE_TEXTS.some(
      (legacyText) => normalizedRangeText(legacyText) === normalizedRangeText(rangeText)
    );
    const handsMatchLegacy = sameHandSet(goodHands, LEGACY_DEFAULT_GOOD_HANDS);

    return (textMatchesLegacy && handsMatchLegacy) ||
      (!String(rangeText ?? "").trim() && handsMatchLegacy) ||
      (textMatchesLegacy && expandRangeInput(goodHands).length === 0);
  }

  const api = Object.freeze({
    RANK_ORDER,
    DEFAULT_RANGE_TEXT,
    DEFAULT_GOOD_HANDS,
    LEGACY_DEFAULT_RANGE_TEXTS,
    LEGACY_DEFAULT_GOOD_HANDS,
    normalizeRank,
    normalizeSuit,
    classifyHand,
    parseCardClassTokens,
    parsePokerNowCardContainerClassTokens,
    parseExactCardIdentityClassTokens,
    parseSuitClassTokens,
    parseStrongSuitClassTokens,
    expandRangeToken,
    expandRangeInput,
    sameHandSet,
    shouldNotifyFlop,
    shouldMigrateLegacyDefaults
  });

  globalObject.PokerHandUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
