import { useEffect } from "react";

export function useBodyPointerEventsGuard() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const overlaySelector = [
      '[role="dialog"][data-state="open"]',
      '[role="alertdialog"][data-state="open"]',
      '[role="menu"][data-state="open"]',
      '[role="listbox"][data-state="open"]',
      "[data-radix-popper-content-wrapper]",
    ].join(",");

    let scheduled = false;
    const clearIfStuck = () => {
      scheduled = false;
      if (document.body.style.pointerEvents !== "none") return;
      if (document.querySelector(overlaySelector)) return;
      document.body.style.pointerEvents = "";
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(clearIfStuck);
    };

    const styleObserver = new MutationObserver(schedule);
    styleObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["style"],
    });

    const treeObserver = new MutationObserver((records) => {
      for (const r of records) {
        if (r.removedNodes.length > 0) {
          schedule();
          return;
        }
      }
    });
    treeObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    clearIfStuck();

    return () => {
      styleObserver.disconnect();
      treeObserver.disconnect();
    };
  }, []);
}
