import { useHref, useNavigate } from "react-router-dom";

/** Anything inside a card that already does something when clicked. */
const HAS_OWN_BEHAVIOUR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='menuitem']",
  "[contenteditable='true']",
].join(",");

/**
 * Make a whole dashboard card open the screen it summarises.
 *
 * A card used to navigate only from its small "Open" / "View all" link and
 * from whichever figures carried a link of their own — a click anywhere else
 * did nothing, though the whole card is plainly about one screen.
 *
 * A click handler on the card, not a link around it, because cards hold their
 * own links (a figure, a list row) and controls (Retry, a chart's range), and
 * links cannot nest. Those keep doing what they did: a click that lands on one
 * is theirs. The card is deliberately not a tab stop — its header link is the
 * keyboard route to the same place.
 *
 * @param {string|null|undefined} to  where the card leads; inert when absent
 * @returns {{ onClick: Function|undefined, className: string }}
 */
export function useCardLink(to) {
  const navigate = useNavigate();
  // Hooks run unconditionally; "." stands in when there is nowhere to go.
  const href = useHref(to || ".");

  if (!to) return { onClick: undefined, className: "" };

  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const own = event.target.closest?.(HAS_OWN_BEHAVIOUR);
    if (own && event.currentTarget.contains(own)) return;
    // Selecting a figure to copy it is not a request to leave the page.
    if (window.getSelection?.()?.toString()) return;
    // What a modified click on a real link would do.
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      window.open(href, "_blank", "noopener");
      return;
    }
    navigate(to);
  };

  return { onClick, className: "cursor-pointer transition-colors hover:border-primary-300" };
}

export default useCardLink;
