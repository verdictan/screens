export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export function shortcutLabel(shortcut) {
  return shortcut.replace(/(^|\+)([a-z])$/g, (_, prefix, letter) => prefix + letter.toUpperCase())
    .replaceAll("Mod", isMac ? "⌘" : "Ctrl")
    .replaceAll("Alt", isMac ? "⌥" : "Alt")
    .replaceAll("ArrowLeft", "←").replaceAll("ArrowRight", "→");
}
export function typing(event) {
  return event.isComposing || event.target instanceof Element && Boolean(
    event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'),
  );
}
export function matchesShortcut(event, shortcut) {
  const parts = shortcut.toLowerCase().split("+");
  return event.key.toLowerCase() === parts.at(-1)
    && event.altKey === parts.includes("alt")
    && event.shiftKey === parts.includes("shift")
    && (isMac ? event.metaKey : event.ctrlKey) === parts.includes("mod")
    && !(isMac ? event.ctrlKey : event.metaKey);
}

export function submitOnShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || event.repeat || event.currentTarget.getAttribute("aria-busy") === "true" || !matchesShortcut(event, "Mod+Enter")) return;
  event.preventDefault();
  event.currentTarget.requestSubmit();
}
