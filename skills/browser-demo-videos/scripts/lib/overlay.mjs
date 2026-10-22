const HOST_ID = "__browser_demo_overlay__";
const CLEANUP_KEY = "__browserDemoOverlayCleanup";
const PLACEMENTS = new Set([
  "auto",
  "above",
  "below",
  "left",
  "right",
  "bottom",
]);

/** Return page-contained JavaScript; no browser or application state is accessed here. */
export function sceneScript(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Scene options must be an object.");
  }
  const {
    text,
    title,
    target,
    placement = "auto",
    spotlight = false,
    holdMs,
  } = options;
  if (typeof text !== "string" || !text.trim() || [...text].length > 600) {
    throw new Error("Scene text must contain 1–600 characters.");
  }
  if (
    title !== undefined &&
    (typeof title !== "string" || !title.trim() || [...title].length > 200)
  ) {
    throw new Error("Scene title must contain 1–200 characters when supplied.");
  }
  if (
    target !== undefined &&
    (typeof target !== "string" || !target.trim() || [...target].length > 2048)
  ) {
    throw new Error(
      "Scene target must be a nonempty CSS selector of at most 2048 characters.",
    );
  }
  if (!PLACEMENTS.has(placement))
    throw new Error("Unsupported scene placement.");
  if (typeof spotlight !== "boolean")
    throw new Error("Scene spotlight must be a boolean.");
  if (
    holdMs !== undefined &&
    (!Number.isInteger(holdMs) || holdMs < 1 || holdMs > 25000)
  ) {
    throw new Error(
      "Scene holdMs must be an integer from 1 to 25000 milliseconds. Use the plan runner for longer holds.",
    );
  }
  return `(${installScene.toString()})(${JSON.stringify({ text, title, target, placement, spotlight, holdMs })},${JSON.stringify(HOST_ID)},${JSON.stringify(CLEANUP_KEY)})`;
}

export function clearScript() {
  return `(() => { const host = document.getElementById(${JSON.stringify(HOST_ID)}); if (!host) return {cleared: false}; const cleanup = host[${JSON.stringify(CLEANUP_KEY)}]; if (typeof cleanup !== 'function') throw new Error('Overlay host ID is occupied by an application element.'); cleanup('cleared'); return {cleared: true}; })()`;
}

async function installScene(options, hostId, cleanupKey) {
  const previous = document.getElementById(hostId);
  if (previous) {
    if (typeof previous[cleanupKey] !== "function") {
      throw new Error("Overlay host ID is occupied by an application element.");
    }
    previous[cleanupKey]("replaced");
  }

  const host = document.createElement("div");
  host.id = hostId;
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("inert", "");
  for (const [name, value] of Object.entries({
    all: "initial",
    position: "fixed",
    top: "0",
    right: "0",
    bottom: "0",
    left: "0",
    display: "block",
    "pointer-events": "none",
    "z-index": "2147483647",
    isolation: "isolate",
    contain: "layout style paint",
    direction: "ltr",
  }))
    host.style.setProperty(name, value, "important");

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { color-scheme: dark; }
    *, *::before, *::after { box-sizing: border-box; pointer-events: none !important; }
    .shade { position: absolute; background: rgba(5, 9, 17, .60); }
    .focus { position: absolute; border: 2px solid rgba(130, 211, 221, .95);
      border-radius: 11px; box-shadow: 0 0 0 1px rgba(5, 9, 17, .40); }
    .card { position: absolute; margin: 0; padding: 20px 23px 21px;
      border: 1px solid rgba(213, 229, 247, .18); border-radius: 15px;
      background: rgba(15, 23, 37, .97); color: #f4f7fb;
      box-shadow: 0 12px 36px rgba(0, 0, 0, .28);
      font: 400 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: left; overflow-wrap: anywhere; white-space: normal; }
    .accent { width: 29px; height: 3px; margin-bottom: 12px;
      border-radius: 3px; background: #82d3dd; }
    h2 { margin: 0 0 7px; color: #fff;
      font-family: inherit; font-size: 19px; font-weight: 650; line-height: 1.3; }
    p { margin: 0; color: #e0e7f0; white-space: pre-wrap; }
    @media (max-width: 420px) {
      .card { padding: 16px 18px; font-size: 14px; }
      h2 { font-size: 17px; }
    }
    @media (prefers-reduced-transparency: reduce) { .card { background: #0f1725; } }
  `;
  shadow.append(style);
  const shades = Array.from({ length: 4 }, () => {
    const shade = document.createElement("div");
    shade.className = "shade";
    shade.hidden = true;
    shadow.append(shade);
    return shade;
  });
  const focus = document.createElement("div");
  focus.className = "focus";
  focus.hidden = true;
  shadow.append(focus);
  const card = document.createElement("section");
  card.className = "card";
  const accent = document.createElement("div");
  accent.className = "accent";
  card.append(accent);
  if (options.title !== undefined) {
    const title = document.createElement("h2");
    title.textContent = options.title;
    card.append(title);
  }
  const text = document.createElement("p");
  text.textContent = options.text;
  card.append(text);
  shadow.append(card);

  let stopped = false;
  let frame = null;
  let poll = null;
  let hold = null;
  let rejectHold = null;
  let mutationObserver = null;
  let resizeObserver = null;
  let element = null;
  let result = null;
  const viewport = window.visualViewport;
  const rect = (value) => ({
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  });
  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  const intersects = (a, b) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;

  function cleanup(reason = "cleared") {
    if (stopped) return;
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    clearTimeout(poll);
    clearTimeout(hold);
    mutationObserver?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("pagehide", onPageHide);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    host.remove();
    if (rejectHold) {
      const reject = rejectHold;
      rejectHold = null;
      reject(new Error(`Scene ended before its hold completed: ${reason}.`));
    }
  }
  host[cleanupKey] = cleanup;
  function onPageHide() {
    cleanup("page navigation");
  }

  function findTarget() {
    if (!options.target) return null;
    let next;
    try {
      next = document.querySelector(options.target);
    } catch {
      throw new Error(`Invalid target CSS selector: ${options.target}`);
    }
    if (!next)
      throw new Error(
        `Scene target was not found: ${options.target}. Wait for the application before showing this scene.`,
      );
    if (next === host || host.contains(next))
      throw new Error(
        "Scene target must belong to the application, not the overlay.",
      );
    if (next !== element) {
      if (element) resizeObserver?.unobserve(element);
      element = next;
      resizeObserver?.observe(element);
    }
    const bounds = next.getBoundingClientRect();
    if (
      !bounds.width ||
      !bounds.height ||
      !next.getClientRects().length ||
      (typeof next.checkVisibility === "function" &&
        !next.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true,
        }))
    ) {
      throw new Error(
        `Scene target is hidden: ${options.target}. Reveal it before showing this scene.`,
      );
    }
    if (typeof next.checkVisibility !== "function") {
      for (
        let node = next;
        node instanceof Element;
        node = node.parentElement
      ) {
        const computed = getComputedStyle(node);
        if (
          computed.display === "none" ||
          computed.visibility !== "visible" ||
          Number(computed.opacity) === 0
        ) {
          throw new Error(
            `Scene target is hidden: ${options.target}. Reveal it before showing this scene.`,
          );
        }
      }
    }
    return rect(bounds);
  }

  function box(node, bounds) {
    node.style.left = `${bounds.x}px`;
    node.style.top = `${bounds.y}px`;
    node.style.width = `${bounds.width}px`;
    node.style.height = `${bounds.height}px`;
  }

  function layout() {
    if (stopped) return;
    if (!host.isConnected)
      throw new Error("The application removed the scene overlay.");
    const width = window.innerWidth;
    const height = window.innerHeight;
    const margin = width < 400 || height < 300 ? 10 : 20;
    const gap = width < 400 || height < 300 ? 10 : 18;
    const safe = {
      x: margin,
      y: margin,
      width: width - margin * 2,
      height: height - margin * 2,
    };
    if (safe.width < 120 || safe.height < 80) {
      throw new Error(
        "Viewport is too small for a readable scene caption. Enlarge the browser viewport.",
      );
    }
    const target = findTarget();
    if (
      target &&
      (target.x + target.width <= 0 ||
        target.y + target.height <= 0 ||
        target.x >= width ||
        target.y >= height)
    ) {
      throw new Error(
        `Scene target is outside the viewport: ${options.target}. Scroll it into view before showing this scene.`,
      );
    }
    const right = safe.x + safe.width;
    const bottom = safe.y + safe.height;
    const regions = target
      ? [
          {
            placement: "below",
            x: safe.x,
            y: Math.max(safe.y, target.y + target.height + gap),
            width: safe.width,
            height: bottom - Math.max(safe.y, target.y + target.height + gap),
          },
          {
            placement: "right",
            x: Math.max(safe.x, target.x + target.width + gap),
            y: safe.y,
            width: right - Math.max(safe.x, target.x + target.width + gap),
            height: safe.height,
          },
          {
            placement: "above",
            x: safe.x,
            y: safe.y,
            width: safe.width,
            height: Math.min(bottom, target.y - gap) - safe.y,
          },
          {
            placement: "left",
            x: safe.x,
            y: safe.y,
            width: Math.min(right, target.x - gap) - safe.x,
            height: safe.height,
          },
          { placement: "bottom", ...safe },
        ]
      : [{ placement: "bottom", ...safe }];
    const candidates = [];
    for (const [index, region] of regions.entries()) {
      if (region.width < Math.min(220, safe.width) || region.height <= 0)
        continue;
      card.style.width = `${Math.min(460, region.width)}px`;
      card.style.height = "auto";
      const bounds = card.getBoundingClientRect();
      if (bounds.height > region.height || bounds.width > region.width)
        continue;
      let x;
      let y;
      if (region.placement === "left" || region.placement === "right") {
        x =
          region.placement === "left"
            ? region.x + region.width - bounds.width
            : region.x;
        y = clamp(
          target.y + target.height / 2 - bounds.height / 2,
          region.y,
          region.y + region.height - bounds.height,
        );
      } else {
        x = clamp(
          (target ? target.x + target.width / 2 : width / 2) - bounds.width / 2,
          region.x,
          region.x + region.width - bounds.width,
        );
        y =
          region.placement === "below"
            ? region.y
            : region.y + region.height - bounds.height;
      }
      const candidate = {
        x,
        y,
        width: bounds.width,
        height: bounds.height,
        placement: region.placement,
      };
      // Bottom is a requested caption position, not permission to obscure the focus.
      const exclusion = target && {
        x: target.x - gap,
        y: target.y - gap,
        width: target.width + gap * 2,
        height: target.height + gap * 2,
      };
      if (exclusion && intersects(candidate, exclusion)) continue;
      const distance = target
        ? Math.hypot(
            x + bounds.width / 2 - target.x - target.width / 2,
            y + bounds.height / 2 - target.y - target.height / 2,
          )
        : 0;
      candidate.score = (460 - bounds.width) * 2 + distance * 0.12 + index * 8;
      candidates.push(candidate);
    }
    let chosen =
      options.placement !== "auto" &&
      candidates.find((candidate) => candidate.placement === options.placement);
    chosen ||= candidates.sort((a, b) => a.score - b.score)[0];
    if (!chosen) {
      throw new Error(
        "No readable caption fits without covering the scene target. Enlarge the viewport, scroll the target, shorten the caption, or select a smaller target.",
      );
    }
    box(card, chosen);
    if (options.spotlight && target) {
      const pad = 7;
      const left = clamp(target.x - pad, 0, width);
      const top = clamp(target.y - pad, 0, height);
      const rightEdge = clamp(target.x + target.width + pad, 0, width);
      const bottomEdge = clamp(target.y + target.height + pad, 0, height);
      const masks = [
        { x: 0, y: 0, width, height: top },
        { x: 0, y: bottomEdge, width, height: height - bottomEdge },
        { x: 0, y: top, width: left, height: bottomEdge - top },
        {
          x: rightEdge,
          y: top,
          width: width - rightEdge,
          height: bottomEdge - top,
        },
      ];
      shades.forEach((shade, index) => {
        shade.hidden = false;
        box(shade, masks[index]);
      });
      focus.hidden = false;
      box(focus, {
        x: left,
        y: top,
        width: rightEdge - left,
        height: bottomEdge - top,
      });
    } else {
      shades.forEach((shade) => {
        shade.hidden = true;
      });
      focus.hidden = true;
    }
    result = {
      target,
      card: rect(card.getBoundingClientRect()),
      placement: chosen.placement,
    };
  }

  function schedule() {
    if (stopped || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      try {
        layout();
      } catch (error) {
        cleanup(error.message);
      }
    });
  }
  function sample() {
    if (stopped) return;
    // Catch transform/animation shifts without an unbounded per-frame geometry loop.
    schedule();
    poll = setTimeout(sample, 100);
  }

  try {
    document.documentElement.append(host);
    layout();
    resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(schedule)
        : null;
    resizeObserver?.observe(document.documentElement);
    if (element) resizeObserver?.observe(element);
    mutationObserver = new MutationObserver((records) => {
      if (!host.isConnected) {
        cleanup("the application removed the overlay");
        return;
      }
      // Re-query once per mutation batch to follow replacement DOM nodes, never a stale rectangle.
      if (options.target && element && !element.isConnected) {
        try {
          findTarget();
        } catch (error) {
          cleanup(error.message);
          return;
        }
      }
      if (
        records.some(
          (record) => record.target !== host && !host.contains(record.target),
        )
      )
        schedule();
    });
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("pagehide", onPageHide, { once: true });
    viewport?.addEventListener("resize", schedule, { passive: true });
    viewport?.addEventListener("scroll", schedule, { passive: true });
    poll = setTimeout(sample, 100);
    if (options.holdMs !== undefined) {
      await new Promise((resolve, reject) => {
        rejectHold = reject;
        hold = setTimeout(() => {
          rejectHold = null;
          hold = null;
          cleanup("hold completed");
          resolve();
        }, options.holdMs);
      });
    }
    return result;
  } catch (error) {
    cleanup(error.message);
    throw error;
  }
}
