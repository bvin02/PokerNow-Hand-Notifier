(function startPokerNowHandNotifier() {
  "use strict";

  const handUtils = globalThis.PokerHandUtils;
  const actionUtils = globalThis.PokerActionUtils;

  if (!handUtils || !actionUtils) {
    console.error("[PokerNow Hand Notifier] Required utility scripts did not load.");
    return;
  }

  const LOG_PREFIX = "[PokerNow Hand Notifier]";
  const SCAN_DEBOUNCE_MS = 50;
  const ACTION_CONFIRM_MS = 180;
  const UNKNOWN_POSITION_CONFIRM_MS = 650;
  const BLIND_EXCEPTION_CONFIRM_MS = 700;
  const CLICK_VERIFY_MS = 900;
  const MAX_ACTION_CLICK_ATTEMPTS_PER_STATE = 1;

  const HERO_CONTAINER_SELECTORS = [
    ".you-player .table-player-cards:not(.hide):not(.hidden)",
    ".table-player.you-player .table-player-cards:not(.hide):not(.hidden)",
    ".you-player .table-player-cards",
    ".table-player.you-player .table-player-cards",
    "[class~='you-player'] .table-player-cards",
    ".you-player",
    ".table-player.you-player"
  ];

  const ACTION_PANEL_SELECTORS = [
    ".game-decisions-ctn .action-buttons",
    ".game-decisions-ctn",
    ".action-buttons"
  ];

  const BUTTON_SELECTORS = Object.freeze({
    fold: [
      ".game-decisions-ctn .action-buttons button.action-button.fold",
      ".game-decisions-ctn .action-buttons button.fold",
      ".action-buttons button.fold",
      "button.fold"
    ],
    check: [
      ".game-decisions-ctn .action-buttons button.action-button.check",
      ".game-decisions-ctn .action-buttons button.check",
      ".action-buttons button.check",
      "button.check"
    ],
    call: [
      ".game-decisions-ctn .action-buttons button.action-button.call",
      ".game-decisions-ctn .action-buttons button.call",
      ".action-buttons button.call",
      "button.call"
    ]
  });

  let settings = {
    enabled: true,
    autoActionsEnabled: true,
    rangeText: handUtils.DEFAULT_RANGE_TEXT,
    goodHands: [...handUtils.DEFAULT_GOOD_HANDS]
  };

  let currentDealToken = null;
  let notificationHandledForDeal = false;
  let flopNotificationHandledForDeal = false;
  let lastFlopNotificationFingerprint = null;
  let lastFlopNotificationAt = 0;
  let autoActionHandledForDeal = false;
  let dealSawPostflop = false;
  let pendingAction = null;
  let actionClickInFlight = null;
  let actionClickAttemptsForState = 0;
  let actionAttemptSignature = null;
  let exhaustedActionSignature = null;
  let scanScheduled = false;
  let nodeIdCounter = 0;
  let lastStatus = {
    state: "starting",
    message: "Starting detector...",
    timestamp: Date.now()
  };

  const nodeIds = new WeakMap();

  function getNodeId(node) {
    if (!nodeIds.has(node)) {
      nodeIdCounter += 1;
      nodeIds.set(node, nodeIdCounter);
    }
    return nodeIds.get(node);
  }

  function resetDealState() {
    currentDealToken = null;
    notificationHandledForDeal = false;
    flopNotificationHandledForDeal = false;
    autoActionHandledForDeal = false;
    dealSawPostflop = false;
    pendingAction = null;
    actionClickInFlight = null;
    actionClickAttemptsForState = 0;
    actionAttemptSignature = null;
    exhaustedActionSignature = null;
  }

  function resetForNewDeal(dealToken) {
    currentDealToken = dealToken;
    notificationHandledForDeal = false;
    flopNotificationHandledForDeal = false;
    autoActionHandledForDeal = false;
    dealSawPostflop = false;
    pendingAction = null;
    actionClickInFlight = null;
    actionClickAttemptsForState = 0;
    actionAttemptSignature = null;
    exhaustedActionSignature = null;
  }

  function syncActionAttemptBudget(signature) {
    if (actionAttemptSignature === signature) {
      return;
    }

    actionAttemptSignature = signature;
    actionClickAttemptsForState = 0;
    exhaustedActionSignature = null;
  }

  function isHidden(element) {
    if (!(element instanceof Element)) {
      return true;
    }

    const hiddenAncestor = element.closest(
      ".hide, .hidden, [hidden], [aria-hidden='true']"
    );
    if (hiddenAncestor) {
      return true;
    }

    const style = window.getComputedStyle(element);
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    );
  }

  function extractCardClassData(element) {
    const container = element.closest(".card-container") || element;
    const directCard = container.matches(".card")
      ? container
      : container.querySelector(":scope > .card") || container.querySelector(".card");

    const candidates = [];
    const seen = new Set();

    function addCandidate(candidate) {
      if (candidate instanceof Element && !seen.has(candidate)) {
        seen.add(candidate);
        candidates.push(candidate);
      }
    }

    // Only inspect the card's own identity-bearing nodes. Do not flatten every
    // descendant: PokerNow cards contain decorative .sub-suit glyphs that can
    // otherwise be mistaken for the actual suit.
    addCandidate(container);
    addCandidate(directCard);
    addCandidate(element);

    let rank = null;
    let suit = null;
    let conflict = false;

    for (const candidate of candidates) {
      const parsed = handUtils.parseExactCardIdentityClassTokens([...candidate.classList]);

      if (parsed.rank) {
        if (rank && rank !== parsed.rank) {
          conflict = true;
        }
        rank ||= parsed.rank;
      }

      if (parsed.suit) {
        if (suit && suit !== parsed.suit) {
          conflict = true;
        }
        suit ||= parsed.suit;
      }
    }

    if (conflict) {
      return { rank: null, suit: null };
    }

    const descriptorParts = [];
    for (const candidate of candidates) {
      for (const attribute of [
        "data-card",
        "data-value",
        "data-rank",
        "data-suit",
        "aria-label",
        "title"
      ]) {
        const value = candidate.getAttribute(attribute);
        if (value) {
          descriptorParts.push(value);
        }
      }
    }

    const descriptor = descriptorParts.join(" ");
    const compactMatches = [...descriptor.matchAll(/(?:^|[^A-Z0-9])(10|[2-9TJQKA])\s*([SHDC])(?:[^A-Z0-9]|$)/gi)];
    for (const match of compactMatches) {
      const nextRank = handUtils.normalizeRank(match[1]);
      const nextSuit = handUtils.normalizeSuit(match[2]);

      if (rank && nextRank && rank !== nextRank) {
        conflict = true;
      }
      if (suit && nextSuit && suit !== nextSuit) {
        conflict = true;
      }

      rank ||= nextRank;
      suit ||= nextSuit;
    }

    if (!rank) {
      const rankMatch = descriptor.match(/(?:^|[^A-Z0-9])(10|[2-9TJQKA])(?:[^A-Z0-9]|$)/i);
      rank = rankMatch ? handUtils.normalizeRank(rankMatch[1]) : null;
    }

    if (!suit) {
      const suitMatches = [...descriptor.matchAll(/\b(spades?|hearts?|diamonds?|clubs?)\b/gi)]
        .map((match) => handUtils.normalizeSuit(match[1]))
        .filter(Boolean);
      const uniqueSuits = [...new Set(suitMatches)];
      suit = uniqueSuits.length === 1 ? uniqueSuits[0] : null;
    }

    return conflict ? { rank: null, suit: null } : { rank, suit };
  }

  function extractRank(cardElement) {
    const classData = extractCardClassData(cardElement);
    if (classData.rank) {
      return classData.rank;
    }

    const rankCandidates = [
      cardElement.getAttribute("data-value"),
      cardElement.getAttribute("data-rank"),
      cardElement.querySelector(".value")?.textContent,
      cardElement.querySelector("[data-value]")?.getAttribute("data-value"),
      cardElement.querySelector("[data-rank]")?.getAttribute("data-rank")
    ];

    for (const candidate of rankCandidates) {
      const normalized = handUtils.normalizeRank(candidate);
      if (normalized) {
        return normalized;
      }
    }

    const text = String(cardElement.textContent || "").toUpperCase();
    const match = text.match(/(?:^|[^A-Z0-9])(10|[AKQJT2-9])(?:[^A-Z0-9]|$)/);
    return match ? handUtils.normalizeRank(match[1]) : null;
  }

  function readPseudoSuitContent(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    try {
      const content = String(window.getComputedStyle(element, "::before").content || "")
        .trim()
        .replace(/^['"]|['"]$/g, "");
      return /^[shdc]$/i.test(content)
        ? handUtils.normalizeSuit(content)
        : null;
    } catch (_error) {
      return null;
    }
  }

  function extractSuit(cardElement) {
    const container = cardElement.closest(".card-container") || cardElement;
    const visualCard = container.matches(".card")
      ? container
      : container.querySelector(":scope > .card") || container.querySelector(".card") || cardElement;

    const detectedSuits = [];
    const addSuit = (candidate) => {
      const normalized = handUtils.normalizeSuit(candidate);
      if (normalized) {
        detectedSuits.push(normalized);
      }
    };

    // Live PokerNow container classes are authoritative:
    // card-d/card-h/card-c/card-s carry the suit, while card-s-A/card-s-5
    // carry the rank. Never interpret card-s-RANK as spades.
    const containerIdentity = handUtils.parsePokerNowCardContainerClassTokens(
      [...container.classList]
    );
    addSuit(containerIdentity.suit);

    // The two card-local span.suit nodes render their identity through the
    // ::before pseudo-element. DevTools shows content "s", "c", "h", or "d".
    // Read both the normal and sub-suit copies and require them to agree.
    const suitNodes = [...visualCard.querySelectorAll(".suit")];
    for (const suitNode of suitNodes) {
      addSuit(suitNode.getAttribute("data-suit"));

      const directText = String(suitNode.textContent || "").trim();
      if (/^[shdc]$/i.test(directText)) {
        addSuit(directText);
      } else {
        const symbolMatch = directText.match(/[♠♥♦♣]/);
        if (symbolMatch) addSuit(symbolMatch[0]);
      }

      addSuit(readPseudoSuitContent(suitNode));

      const classSuit = handUtils.parseStrongSuitClassTokens([...suitNode.classList]);
      if (classSuit) addSuit(classSuit);
    }

    // Explicit metadata on the container/card remains a safe fallback.
    for (const element of [container, visualCard]) {
      addSuit(element.getAttribute("data-suit"));
      for (const attribute of ["aria-label", "title"]) {
        const value = String(element.getAttribute(attribute) || "").trim();
        const symbolMatch = value.match(/[♠♥♦♣]/);
        if (symbolMatch) addSuit(symbolMatch[0]);
        const namedMatch = value.match(/\b(spades?|hearts?|diamonds?|clubs?)\b/i);
        if (namedMatch) addSuit(namedMatch[1]);
      }
    }

    const uniqueSuits = [...new Set(detectedSuits.filter(Boolean))];
    return uniqueSuits.length === 1 ? uniqueSuits[0] : null;
  }

  function cardSuitDiagnostics(cardElement) {
    const container = cardElement.closest(".card-container") || cardElement;
    const visualCard = container.matches(".card")
      ? container
      : container.querySelector(":scope > .card") || container.querySelector(".card") || cardElement;

    const containerIdentity = handUtils.parsePokerNowCardContainerClassTokens(
      [...container.classList]
    );

    return {
      containerClasses: [...container.classList],
      containerRank: containerIdentity.rank,
      containerSuit: containerIdentity.suit,
      suitNodes: [...visualCard.querySelectorAll(".suit")].map((node) => ({
        classes: [...node.classList],
        text: String(node.textContent || "").trim(),
        beforeContent: (() => {
          try {
            return String(window.getComputedStyle(node, "::before").content || "");
          } catch (_error) {
            return null;
          }
        })(),
        parsedBeforeSuit: readPseudoSuitContent(node),
        dataSuit: node.getAttribute("data-suit")
      }))
    };
  }

  function parseCard(cardElement) {
    if (!(cardElement instanceof Element) || isHidden(cardElement)) {
      return null;
    }

    const rank = extractRank(cardElement);
    const suit = extractSuit(cardElement);

    if (!rank) {
      return null;
    }

    const suitSymbol = { s: "♠", h: "♥", d: "♦", c: "♣" }[suit] || "?";
    return {
      rank,
      suit,
      display: `${rank === "T" ? "10" : rank}${suitSymbol}`,
      element: cardElement,
      suitDiagnostics: cardSuitDiagnostics(cardElement)
    };
  }

  function cardsFromContainer(container) {
    const cardContainers = [...container.querySelectorAll(".card-container")];
    const cardNodes = cardContainers.length > 0
      ? cardContainers
      : [...container.querySelectorAll(".card")];

    const parsedCards = cardNodes.map(parseCard).filter(Boolean);
    return parsedCards.length === 2 ? parsedCards : [];
  }

  function findHeroCards() {
    for (const selector of HERO_CONTAINER_SELECTORS) {
      const containers = [...document.querySelectorAll(selector)];
      for (const container of containers) {
        const cards = cardsFromContainer(container);
        if (cards.length === 2) {
          return { cards, selector };
        }
      }
    }

    return { cards: [], selector: null };
  }

  function createDealToken(cards) {
    return cards
      .map((card) => `${getNodeId(card.element)}:${card.rank}${card.suit || "?"}`)
      .join("|");
  }

  function isFaceUpBoardCard(element) {
    if (!(element instanceof Element) || isHidden(element)) {
      return false;
    }

    if (parseCard(element)) {
      return true;
    }

    const container = element.closest(".card-container") || element;
    const hasFaceClass = [...container.classList].some((className) =>
      /^card-[shdc]-(10|[2-9TJQKA])$/i.test(className)
    );

    if (hasFaceClass) {
      return true;
    }

    if (container.classList.contains("flipped")) {
      const value = container.querySelector(".value")?.textContent?.trim();
      return Boolean(handUtils.normalizeRank(value));
    }

    return false;
  }

  function readBoardSafetyState() {
    const boardContainer = document.querySelector(".table-cards");
    if (!boardContainer) {
      return {
        recognized: false,
        visibleCount: null,
        reason: "PokerNow board container was not found."
      };
    }

    const containerNodes = [...boardContainer.querySelectorAll(".card-container")];
    const candidateNodes = containerNodes.length > 0
      ? containerNodes
      : [...boardContainer.querySelectorAll(".card")];

    const visibleCount = candidateNodes.filter(isFaceUpBoardCard).length;
    return {
      recognized: true,
      visibleCount,
      reason: visibleCount === 0
        ? "Board is recognized and empty."
        : `${visibleCount} community card(s) are visible.`
    };
  }

  function parseAmount(text) {
    const raw = String(text || "").trim();
    if (!raw) {
      return null;
    }

    const match = raw.match(/-?\d[\d,]*(?:\.\d+)?\s*[KkMm]?/);
    if (!match) {
      return null;
    }

    const token = match[0].replace(/\s+/g, "");
    const multiplier = /k$/i.test(token)
      ? 1000
      : /m$/i.test(token)
        ? 1000000
        : 1;
    const number = Number.parseFloat(token.replace(/[KkMm,]/g, ""));
    return Number.isFinite(number) ? number * multiplier : null;
  }

  function readBlinds() {
    const individualSelectors = [
      ".blind-value .chips-value",
      ".blind-value-ctn .normal-value",
      ".blind-value-ctn .fraction-value"
    ];

    const individualValues = [];
    for (const selector of individualSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const amount = parseAmount(element.textContent);
        if (Number.isFinite(amount) && amount > 0) {
          individualValues.push(amount);
        }
      }
    }

    const uniqueValues = [...new Set(individualValues)].sort((a, b) => a - b);
    if (uniqueValues.length >= 2) {
      return {
        smallBlind: uniqueValues[0],
        bigBlind: uniqueValues[uniqueValues.length - 1],
        source: "individual blind values"
      };
    }

    const containerSelectors = [
      ".blind-value",
      ".blind-value-ctn",
      ".blinds-value"
    ];

    for (const selector of containerSelectors) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }

      const matches = String(element.textContent || "").match(/\d[\d,]*(?:\.\d+)?/g) || [];
      const values = matches
        .map(parseAmount)
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);

      if (values.length >= 2) {
        return {
          smallBlind: values[0],
          bigBlind: values[values.length - 1],
          source: selector
        };
      }
    }

    return {
      smallBlind: null,
      bigBlind: null,
      source: null
    };
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected || isHidden(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const intersectsViewport =
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;

    return rect.width > 0 && rect.height > 0 && intersectsViewport;
  }

  function isUsableButton(element) {
    if (
      !element ||
      !isElementVisible(element) ||
      element.disabled ||
      element.getAttribute("aria-disabled") === "true"
    ) {
      return false;
    }

    return window.getComputedStyle(element).pointerEvents !== "none";
  }

  function buttonTextMatches(element, kind) {
    const text = String(element.textContent || "").trim().toLowerCase();
    return new RegExp(`\\b${kind}\\b`, "i").test(text);
  }

  function findVisibleActionPanels() {
    const panels = [];
    const seen = new Set();

    for (const selector of ACTION_PANEL_SELECTORS) {
      for (const panel of document.querySelectorAll(selector)) {
        const hasUsableControl = [...panel.querySelectorAll("button, [role='button']")]
          .some((element) => isUsableButton(element));

        if (!seen.has(panel) && !isHidden(panel) && hasUsableControl) {
          seen.add(panel);
          panels.push(panel);
        }
      }
    }

    return panels;
  }

  function findActionButton(kind) {
    const panels = findVisibleActionPanels();

    // Search only inside the currently visible decision controls first. This
    // avoids clicking a stale button left elsewhere in the DOM by a transition.
    for (const panel of panels) {
      const candidates = panel.querySelectorAll("button, [role='button']");
      for (const element of candidates) {
        const classMatches =
          element.classList.contains(kind) ||
          element.classList.contains("action-button") && element.classList.contains(kind);

        if (isUsableButton(element) && (classMatches || buttonTextMatches(element, kind))) {
          return element;
        }
      }
    }

    // Compatibility fallback: accept a selector match only when it belongs to
    // a visible PokerNow action panel. Never use an unscoped stale control.
    for (const selector of BUTTON_SELECTORS[kind]) {
      for (const element of document.querySelectorAll(selector)) {
        const panel = element.closest(".game-decisions-ctn, .action-buttons");
        if (panel && !isHidden(panel) && isUsableButton(element)) {
          return element;
        }
      }
    }

    return null;
  }

  function readActionButtons() {
    const fold = findActionButton("fold");
    const check = findActionButton("check");
    const call = findActionButton("call");
    const callAmount = call
      ? parseAmount(call.querySelector(".chips-value, .normal-value, .value")?.textContent || call.textContent)
      : null;

    return {
      fold,
      check,
      call,
      callAmount,
      canFold: Boolean(fold),
      canCheck: Boolean(check),
      canCall: Boolean(call)
    };
  }

  function hasVisibleTurnSignal() {
    // Buttons are also rendered as out-of-turn pre-action toggles, so they are
    // deliberately ignored here. Only explicit PokerNow turn indicators count.
    const heroDecisionSelectors = [
      ".table-player.you-player.decision-current",
      ".you-player.decision-current",
      ".table-player.you-player .action-signal",
      ".you-player .action-signal",
      ".game-decisions-ctn .action-signal",
      ".action-buttons .action-signal"
    ];

    if (heroDecisionSelectors.some((selector) =>
      [...document.querySelectorAll(selector)].some((element) => !isHidden(element))
    )) {
      return true;
    }

    // Compatibility path used by current PokerNow builds where action-signal
    // is a standalone hero-only element. Reject one attached to another seat.
    return [...document.querySelectorAll(".action-signal")].some((element) => {
      if (isHidden(element)) {
        return false;
      }

      const seat = element.closest(".table-player");
      return !seat || seat.classList.contains("you-player");
    });
  }

  function isHeroTurn(buttons) {
    return actionUtils.inferHeroTurn({
      hasTurnSignal: hasVisibleTurnSignal(),
      canFold: buttons.canFold,
      canCheck: buttons.canCheck,
      canCall: buttons.canCall
    });
  }

  function readSeatNumber(element) {
    for (const className of element.classList) {
      const match = className.match(/^table-player-(\d+)$/);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    }
    return null;
  }

  function readDealerSeatNumber() {
    const candidates = document.querySelectorAll(
      ".dealer-button-ctn, [class*='dealer-position-']"
    );

    for (const element of candidates) {
      for (const className of element.classList) {
        const match = className.match(/^dealer-position-(\d+)$/);
        if (match) {
          return Number.parseInt(match[1], 10);
        }
      }
    }

    return null;
  }

  function hasSeatName(element) {
    const nameElement = element.querySelector(
      ".table-player-name, .player-name, .name"
    );
    return Boolean(nameElement?.textContent?.trim());
  }

  function isActiveSeat(element) {
    if (element.classList.contains("empty")) {
      return false;
    }

    if (
      element.classList.contains("away") ||
      element.classList.contains("sitting-out") ||
      element.classList.contains("sit-out")
    ) {
      return false;
    }

    return hasSeatName(element) || element.classList.contains("you-player");
  }

  function readHeroPosition() {
    const allSeatElements = [...document.querySelectorAll(".table-player")];
    const dealerSeatNumber = readDealerSeatNumber();

    if (allSeatElements.length < 2 || dealerSeatNumber === null) {
      return { position: "unknown", confidence: false, activePlayers: null };
    }

    const allSeats = allSeatElements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element,
          rect,
          seatNumber: readSeatNumber(element),
          isHero: element.classList.contains("you-player"),
          active: isActiveSeat(element)
        };
      })
      .filter((seat) =>
        seat.seatNumber !== null && seat.rect.width > 0 && seat.rect.height > 0
      );

    const activeSeats = allSeats.filter((seat) => seat.active);
    if (activeSeats.length < 2) {
      return { position: "unknown", confidence: false, activePlayers: activeSeats.length };
    }

    const dealerIsActive = activeSeats.some((seat) => seat.seatNumber === dealerSeatNumber);
    const heroExists = activeSeats.some((seat) => seat.isHero);
    if (!dealerIsActive || !heroExists) {
      return { position: "unknown", confidence: false, activePlayers: activeSeats.length };
    }

    const centerSeats = allSeats.length >= activeSeats.length ? allSeats : activeSeats;
    const center = centerSeats.reduce(
      (accumulator, seat) => ({
        x: accumulator.x + seat.rect.left + seat.rect.width / 2,
        y: accumulator.y + seat.rect.top + seat.rect.height / 2
      }),
      { x: 0, y: 0 }
    );
    center.x /= centerSeats.length;
    center.y /= centerSeats.length;

    const seatsWithAngles = activeSeats.map((seat) => {
      const x = seat.rect.left + seat.rect.width / 2 - center.x;
      const y = seat.rect.top + seat.rect.height / 2 - center.y;
      let angle = Math.atan2(x, -y);
      if (angle < 0) {
        angle += Math.PI * 2;
      }
      return { ...seat, angle };
    });

    const dealer = seatsWithAngles.find((seat) => seat.seatNumber === dealerSeatNumber);
    const ordered = seatsWithAngles
      .map((seat) => ({
        ...seat,
        relativeAngle: (seat.angle - dealer.angle + Math.PI * 2) % (Math.PI * 2)
      }))
      .sort((first, second) => first.relativeAngle - second.relativeAngle);

    const heroIndex = ordered.findIndex((seat) => seat.isHero);
    if (heroIndex < 0) {
      return { position: "unknown", confidence: false, activePlayers: activeSeats.length };
    }

    const position = actionUtils.positionFromDealerOrder(heroIndex, activeSeats.length);
    return {
      position,
      confidence: position !== "unknown",
      activePlayers: activeSeats.length
    };
  }

  async function saveStatus(status) {
    const nextStatus = {
      ...status,
      url: location.href
    };

    const comparableCurrent = JSON.stringify({
      ...lastStatus,
      timestamp: undefined
    });
    const comparableNext = JSON.stringify(nextStatus);

    if (comparableCurrent === comparableNext) {
      return;
    }

    lastStatus = {
      ...nextStatus,
      timestamp: Date.now()
    };

    try {
      await chrome.storage.local.set({ lastDetection: lastStatus });
    } catch (error) {
      console.debug(LOG_PREFIX, "Could not persist detector status:", error);
    }
  }

  function sendGoodHandNotification(hand, cards) {
    chrome.runtime.sendMessage(
      {
        type: "GOOD_HAND_DETECTED",
        hand,
        cards: cards.map((card) => card.display)
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(LOG_PREFIX, "Could not contact background worker:", chrome.runtime.lastError);
          return;
        }

        if (!response?.ok) {
          console.error(LOG_PREFIX, "Notification failed:", response?.error || "Unknown error");
        }
      }
    );
  }

  function sendFlopNotification(hand, cards) {
    chrome.runtime.sendMessage(
      {
        type: "FLOP_REACHED_WITH_LIVE_HAND",
        hand,
        cards: cards.map((card) => card.display)
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(LOG_PREFIX, "Could not contact background worker:", chrome.runtime.lastError);
          return;
        }

        if (!response?.ok) {
          console.error(LOG_PREFIX, "Flop notification failed:", response?.error || "Unknown error");
        }
      }
    );
  }

  function maybeNotifyOnFlop(hand, cards, boardState) {
    const heroFolded = heroSeatShowsFolded();
    const shouldNotify = handUtils.shouldNotifyFlop({
      boardRecognized: boardState.recognized,
      visibleBoardCards: boardState.visibleCount,
      heroCardCount: cards.length,
      heroFolded,
      alreadyNotified: flopNotificationHandledForDeal
    });

    if (!shouldNotify) {
      return false;
    }

    // React can occasionally replace the card DOM nodes during the same deal,
    // which changes currentDealToken. Keep a short cross-token fingerprint so
    // the same flop cannot produce duplicate alerts during that re-render.
    const fingerprint = `${location.pathname}|${hand}|${cards.map((card) => card.display).join("|")}`;
    const now = Date.now();
    if (
      lastFlopNotificationFingerprint === fingerprint &&
      now - lastFlopNotificationAt < 90000
    ) {
      flopNotificationHandledForDeal = true;
      return false;
    }

    flopNotificationHandledForDeal = true;
    lastFlopNotificationFingerprint = fingerprint;
    lastFlopNotificationAt = now;
    console.info(LOG_PREFIX, "Flop reached with live hero cards", hand, cards.map((card) => card.display));
    sendFlopNotification(hand, cards);
    return true;
  }

  function actionStateSnapshot(boardState, positionState, buttons, blinds) {
    return {
      isPreflop: boardState.recognized && boardState.visibleCount === 0 && !dealSawPostflop,
      heroTurn: isHeroTurn(buttons),
      position: positionState.position,
      canFold: buttons.canFold,
      canCheck: buttons.canCheck,
      canCall: buttons.canCall,
      callAmount: buttons.callAmount,
      smallBlind: blinds.smallBlind,
      bigBlind: blinds.bigBlind
    };
  }

  function actionSignature(dealToken, decision, snapshot) {
    return JSON.stringify({
      dealToken,
      action: decision.type,
      position: snapshot.position,
      callAmount: snapshot.callAmount,
      smallBlind: snapshot.smallBlind,
      bigBlind: snapshot.bigBlind,
      canFold: snapshot.canFold,
      canCheck: snapshot.canCheck,
      canCall: snapshot.canCall
    });
  }

  function targetButtonForAction(action, buttons) {
    if (action === "fold") return buttons.fold;
    if (action === "check") return buttons.check;
    if (action === "call") return buttons.call;
    return null;
  }

  function heroSeatShowsFolded() {
    const hero = document.querySelector(".table-player.you-player, .you-player");
    if (!hero) {
      return false;
    }

    if (hero.classList.contains("fold") || hero.classList.contains("folded")) {
      return true;
    }

    const statusText = hero.querySelector(
      ".table-player-status-message, .player-status, .status-message"
    )?.textContent || "";
    return /\bfold(?:ed)?\b/i.test(statusText);
  }

  function markActionAccepted(flight, reason) {
    if (!actionClickInFlight || actionClickInFlight.id !== flight.id) {
      return;
    }

    actionClickInFlight = null;
    autoActionHandledForDeal = true;
    pendingAction = null;

    saveStatus({
      state: "auto-action",
      message: `Automatically ${flight.action === "fold" ? "folded" : flight.action === "check" ? "checked" : "called"} ${flight.hand} preflop.`,
      hand: flight.hand,
      matched: false,
      action: {
        type: flight.action,
        reason: flight.reason,
        verification: reason,
        attempts: flight.attempt,
        timestamp: Date.now()
      }
    });
  }

  function verifyActionClick(flight) {
    if (!actionClickInFlight || actionClickInFlight.id !== flight.id) {
      return;
    }

    const { cards } = findHeroCards();
    if (cards.length !== 2) {
      markActionAccepted(flight, "Hero cards disappeared after the click.");
      return;
    }

    const liveDealToken = createDealToken(cards);
    const liveHand = handUtils.classifyHand(cards);
    if (liveDealToken !== flight.dealToken || liveHand !== flight.hand) {
      markActionAccepted(flight, "The deal advanced after the click.");
      return;
    }

    const boardState = readBoardSafetyState();
    if (boardState.recognized && Number(boardState.visibleCount) > 0) {
      markActionAccepted(flight, "The hand advanced beyond preflop after the click.");
      return;
    }

    const buttons = readActionButtons();
    const positionState = readHeroPosition();
    const blinds = readBlinds();
    const snapshot = actionStateSnapshot(boardState, positionState, buttons, blinds);
    const decision = actionUtils.decideBadHandAction(snapshot);
    const liveSignature = actionSignature(liveDealToken, decision, snapshot);

    if (heroSeatShowsFolded()) {
      markActionAccepted(flight, "PokerNow marked the hero seat folded.");
      return;
    }

    if (!snapshot.heroTurn) {
      markActionAccepted(flight, "PokerNow removed the hero action controls.");
      return;
    }

    if (liveSignature !== flight.signature) {
      // The hero can still act, but the decision state changed. This is common
      // when an opponent raises after PokerNow displayed pre-action controls.
      // Reset the retry budget so a previous Check attempt can never suppress
      // the later required Fold.
      actionClickInFlight = null;
      pendingAction = null;
      autoActionHandledForDeal = false;
      syncActionAttemptBudget(liveSignature);
      saveStatus({
        state: "rechecking-action",
        message: `The live preflop decision changed from ${flight.action} to ${decision.type}; rechecking the new state.`,
        hand: flight.hand,
        matched: false,
        action: {
          type: flight.action,
          reason: flight.reason,
          attempts: flight.attempt,
          timestamp: Date.now()
        }
      });
      scheduleScan();
      return;
    }

    // The exact same decision is still fully actionable after verification.
    // Do not click it again: PokerNow pre-actions are toggles, so repeated clicks
    // can turn a queued action off. One click is allowed per exact decision state.
    actionClickInFlight = null;
    pendingAction = null;

    // Stop clicking only this exact unchanged state. Do NOT retire the deal:
    // a later raise can change Check into Fold and must receive a fresh budget.
    exhaustedActionSignature = flight.signature;
    autoActionHandledForDeal = false;
    saveStatus({
      state: "action-unconfirmed",
      message: `PokerNow still showed ${flight.action} after its single click. Paused this unchanged state; monitoring for a new decision.`,
      hand: flight.hand,
      matched: false,
      action: {
        type: flight.action,
        reason: flight.reason,
        attempts: actionClickAttemptsForState,
        timestamp: Date.now()
      }
    });
  }

  function performConfirmedAction(expectedSignature, expectedAction, expectedHand) {
    if (autoActionHandledForDeal || !currentDealToken) {
      return;
    }

    const { cards } = findHeroCards();
    if (cards.length !== 2) {
      pendingAction = null;
      return;
    }

    const liveDealToken = createDealToken(cards);
    const liveHand = handUtils.classifyHand(cards);
    if (
      liveDealToken !== currentDealToken ||
      liveHand !== expectedHand ||
      settings.goodHands.includes(liveHand)
    ) {
      pendingAction = null;
      return;
    }

    const boardState = readBoardSafetyState();
    if (!boardState.recognized || boardState.visibleCount !== 0 || dealSawPostflop) {
      pendingAction = null;
      return;
    }

    const buttons = readActionButtons();
    const positionState = readHeroPosition();
    const blinds = readBlinds();
    const snapshot = actionStateSnapshot(boardState, positionState, buttons, blinds);
    const decision = actionUtils.decideBadHandAction(snapshot);
    const liveSignature = actionSignature(liveDealToken, decision, snapshot);
    const targetButton = targetButtonForAction(decision.type, buttons);

    if (
      liveSignature !== expectedSignature ||
      decision.type !== expectedAction ||
      !targetButton ||
      !isUsableButton(targetButton)
    ) {
      pendingAction = null;
      scheduleScan();
      return;
    }

    pendingAction = null;
    syncActionAttemptBudget(liveSignature);
    if (
      exhaustedActionSignature === liveSignature ||
      actionClickAttemptsForState >= MAX_ACTION_CLICK_ATTEMPTS_PER_STATE
    ) {
      exhaustedActionSignature = liveSignature;
      return;
    }
    actionClickAttemptsForState += 1;

    const flight = {
      id: `${Date.now()}:${actionClickAttemptsForState}:${decision.type}`,
      signature: liveSignature,
      dealToken: liveDealToken,
      action: decision.type,
      hand: liveHand,
      reason: decision.reason,
      attempt: actionClickAttemptsForState,
      clickedAt: Date.now()
    };
    actionClickInFlight = flight;

    try {
      targetButton.click();
      console.info(
        LOG_PREFIX,
        "Auto action click",
        decision.type,
        "for",
        liveHand,
        `attempt ${actionClickAttemptsForState}`,
        decision.reason
      );
      saveStatus({
        state: "verifying-action",
        message: `Clicked ${decision.type} for ${liveHand}; verifying PokerNow accepted it.`,
        cards: cards.map((card) => card.display),
        hand: liveHand,
        matched: false,
        board: boardState,
        position: positionState,
        blinds,
        callAmount: buttons.callAmount,
        action: {
          type: decision.type,
          reason: decision.reason,
          attempts: actionClickAttemptsForState,
          timestamp: Date.now()
        }
      });
      window.setTimeout(() => verifyActionClick(flight), CLICK_VERIFY_MS);
    } catch (error) {
      actionClickInFlight = null;
      console.error(LOG_PREFIX, "Action click failed:", error);

      exhaustedActionSignature = liveSignature;
      autoActionHandledForDeal = false;

      saveStatus({
        state: "action-error",
        message: `Could not click ${decision.type}: ${String(error)}`,
        hand: liveHand,
        matched: false,
        action: {
          type: decision.type,
          error: String(error),
          attempts: actionClickAttemptsForState
        }
      });
    }
  }

  function considerAutomaticAction(hand, cards, selector, boardState) {
    if (!settings.autoActionsEnabled || autoActionHandledForDeal) {
      return;
    }

    if (actionClickInFlight) {
      saveStatus({
        state: "verifying-action",
        message: `Waiting for PokerNow to acknowledge ${actionClickInFlight.action}.`,
        hand,
        matched: false,
        action: {
          type: actionClickInFlight.action,
          attempts: actionClickInFlight.attempt
        }
      });
      return;
    }

    if (!boardState.recognized || boardState.visibleCount !== 0 || dealSawPostflop) {
      pendingAction = null;
      return;
    }

    const buttons = readActionButtons();
    const positionState = readHeroPosition();
    const blinds = readBlinds();
    const snapshot = actionStateSnapshot(boardState, positionState, buttons, blinds);
    const decision = actionUtils.decideBadHandAction(snapshot);

    saveStatus({
      state: decision.type === "none" ? "waiting-action" : "confirming-action",
      message: decision.type === "none"
        ? `${hand} is outside your range. Waiting for a safely confirmed preflop action.`
        : `${hand} is outside your range. Confirming ${decision.type} before acting.`,
      selector,
      cards: cards.map((card) => card.display),
      hand,
      matched: false,
      board: boardState,
      position: positionState,
      blinds,
      callAmount: buttons.callAmount,
      heroTurn: snapshot.heroTurn,
      candidateAction: decision
    });

    if (decision.type === "none") {
      pendingAction = null;
      return;
    }

    const signature = actionSignature(currentDealToken, decision, snapshot);
    syncActionAttemptBudget(signature);

    if (exhaustedActionSignature === signature) {
      pendingAction = null;
      saveStatus({
        state: "monitoring-action-change",
        message: `${hand} is outside your range. The unchanged ${decision.type} state exhausted its click budget; still monitoring for a raise or other decision change.`,
        selector,
        cards: cards.map((card) => card.display),
        hand,
        matched: false,
        board: boardState,
        position: positionState,
        blinds,
        callAmount: buttons.callAmount,
        heroTurn: snapshot.heroTurn,
        candidateAction: decision
      });
      return;
    }

    const now = Date.now();
    const isBlindException =
      snapshot.position === "bb" && decision.type === "check" ||
      snapshot.position === "sb" && (decision.type === "call" || decision.type === "check");
    const requiredConfirmMs = snapshot.position === "unknown"
      ? UNKNOWN_POSITION_CONFIRM_MS
      : isBlindException
        ? BLIND_EXCEPTION_CONFIRM_MS
        : ACTION_CONFIRM_MS;

    if (!pendingAction || pendingAction.signature !== signature) {
      pendingAction = {
        signature,
        action: decision.type,
        hand,
        firstSeenAt: now,
        confirmations: 1
      };
      window.setTimeout(scheduleScan, requiredConfirmMs + 25);
      return;
    }

    pendingAction.confirmations += 1;
    if (
      pendingAction.confirmations < 2 ||
      now - pendingAction.firstSeenAt < requiredConfirmMs
    ) {
      window.setTimeout(scheduleScan, requiredConfirmMs + 25);
      return;
    }

    performConfirmedAction(signature, decision.type, hand);
  }

  function scanForHand() {
    scanScheduled = false;

    if (!settings.enabled) {
      pendingAction = null;
      saveStatus({ state: "disabled", message: "Detector is disabled." });
      return;
    }

    const { cards, selector } = findHeroCards();

    if (cards.length !== 2) {
      if (currentDealToken !== null) {
        resetDealState();
        chrome.runtime.sendMessage({ type: "CLEAR_BADGE" });
      }

      saveStatus({
        state: "waiting",
        message: "Waiting for two visible hero cards.",
        selector: null,
        cards: [],
        hand: null,
        matched: false
      });
      return;
    }

    const dealToken = createDealToken(cards);
    if (dealToken !== currentDealToken) {
      resetForNewDeal(dealToken);
    }

    const hand = handUtils.classifyHand(cards);
    const cardLabels = cards.map((card) => card.display);
    const boardState = readBoardSafetyState();

    if (boardState.recognized && Number(boardState.visibleCount) > 0) {
      dealSawPostflop = true;
      pendingAction = null;
    }

    // Postflop is notification-only. Exactly when the flop is visible, alert
    // once if the hero still has two visible cards and is not marked folded.
    // This does not depend on successful suited/offsuit classification and
    // never inspects or clicks any postflop action button.
    maybeNotifyOnFlop(hand, cards, boardState);

    if (!hand) {
      pendingAction = null;
      saveStatus({
        state: "unparsed",
        message: "Found two cards but could not determine the full starting hand.",
        selector,
        cards: cardLabels,
        hand: null,
        matched: false,
        board: boardState
      });
      return;
    }

    const matched = settings.goodHands.includes(hand);

    if (matched) {
      // Critical invariant: good hands are notification-only and never auto-click.
      pendingAction = null;
      autoActionHandledForDeal = true;

      saveStatus({
        state: "matched",
        message: `${hand} matches your saved range. Notification only; no action taken.`,
        selector,
        cards: cardLabels,
        hand,
        matched: true,
        board: boardState,
        action: null
      });

      if (!notificationHandledForDeal) {
        notificationHandledForDeal = true;
        console.info(LOG_PREFIX, "Detected", hand, cardLabels, "MATCH");
        sendGoodHandNotification(hand, cards);
      }
      return;
    }

    console.debug(LOG_PREFIX, "Detected", hand, cardLabels, "outside range");
    considerAutomaticAction(hand, cards, selector, boardState);
  }

  function scheduleScan() {
    if (scanScheduled) {
      return;
    }

    scanScheduled = true;
    window.setTimeout(scanForHand, SCAN_DEBOUNCE_MS);
  }

  async function loadSettings() {
    const stored = await chrome.storage.sync.get({
      enabled: true,
      autoActionsEnabled: true,
      rangeText: handUtils.DEFAULT_RANGE_TEXT,
      goodHands: [...handUtils.DEFAULT_GOOD_HANDS]
    });

    const migrateDefaults = handUtils.shouldMigrateLegacyDefaults(
      stored.rangeText,
      stored.goodHands
    );
    const effectiveRangeText = migrateDefaults
      ? handUtils.DEFAULT_RANGE_TEXT
      : stored.rangeText || handUtils.DEFAULT_RANGE_TEXT;
    const effectiveGoodHands = migrateDefaults
      ? [...handUtils.DEFAULT_GOOD_HANDS]
      : handUtils.expandRangeInput(stored.goodHands);

    settings = {
      enabled: stored.enabled !== false,
      autoActionsEnabled: stored.autoActionsEnabled !== false,
      rangeText: effectiveRangeText,
      goodHands: effectiveGoodHands.length > 0
        ? effectiveGoodHands
        : [...handUtils.DEFAULT_GOOD_HANDS]
    };

    if (migrateDefaults) {
      await chrome.storage.sync.set({
        rangeText: handUtils.DEFAULT_RANGE_TEXT,
        goodHands: [...handUtils.DEFAULT_GOOD_HANDS]
      });
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (changes.enabled) {
      settings.enabled = changes.enabled.newValue !== false;
    }

    if (changes.autoActionsEnabled) {
      settings.autoActionsEnabled = changes.autoActionsEnabled.newValue !== false;
    }

    if (changes.rangeText) {
      settings.rangeText = changes.rangeText.newValue || handUtils.DEFAULT_RANGE_TEXT;
    }

    if (changes.goodHands) {
      const parsedHands = handUtils.expandRangeInput(changes.goodHands.newValue);
      settings.goodHands = parsedHands.length > 0
        ? parsedHands
        : [...handUtils.DEFAULT_GOOD_HANDS];
    }

    // Never begin auto-playing an already-dealt hand after a settings change.
    autoActionHandledForDeal = true;
    pendingAction = null;
    actionClickInFlight = null;
    actionClickAttemptsForState = 0;
    actionAttemptSignature = null;
    exhaustedActionSignature = null;
    scheduleScan();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_STATUS") {
      const { cards, selector } = findHeroCards();
      const hand = cards.length === 2 ? handUtils.classifyHand(cards) : null;
      const board = readBoardSafetyState();
      const buttons = readActionButtons();
      const position = readHeroPosition();
      const blinds = readBlinds();

      sendResponse({
        ok: true,
        settings,
        status: lastStatus,
        liveScan: {
          selector,
          cards: cards.map((card) => card.display),
          cardSuitDiagnostics: cards.map((card) => card.suitDiagnostics),
          hand,
          matched: hand ? settings.goodHands.includes(hand) : false,
          board,
          position,
          blinds,
          callAmount: buttons.callAmount,
          heroTurn: isHeroTurn(buttons),
          buttons: {
            fold: buttons.canFold,
            check: buttons.canCheck,
            call: buttons.canCall
          },
          autoActionHandledForDeal,
          actionClickInFlight: actionClickInFlight
            ? { action: actionClickInFlight.action, attempt: actionClickInFlight.attempt }
            : null,
          actionClickAttemptsForState,
          actionAttemptSignature,
          exhaustedActionSignature,
          dealSawPostflop,
          flopNotificationHandledForDeal
        }
      });
      return false;
    }

    if (message?.type === "FORCE_SCAN") {
      pendingAction = null;
      scanForHand();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  const observer = new MutationObserver(scheduleScan);

  loadSettings()
    .then(() => {
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "class",
          "style",
          "hidden",
          "disabled",
          "aria-hidden",
          "aria-disabled",
          "data-value",
          "data-rank",
          "data-suit"
        ]
      });

      scanForHand();
      window.setInterval(scheduleScan, 1000);
      console.info(
        LOG_PREFIX,
        "Loaded. Watching for",
        settings.goodHands.join(", "),
        "Auto-actions:",
        settings.autoActionsEnabled
      );
    })
    .catch((error) => {
      console.error(LOG_PREFIX, "Initialization failed:", error);
      saveStatus({ state: "error", message: String(error) });
    });
})();
