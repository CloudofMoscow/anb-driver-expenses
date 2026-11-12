function elementPath(element) {
  if (!element || element === document.body) return null;
  const parts = [];
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
    if (node.dataset.uiKey) {
      parts.unshift(`[data-ui-key="${CSS.escape(node.dataset.uiKey)}"]`);
      break;
    }
    const siblings = [...node.parentElement.children].filter((sibling) => sibling.tagName === node.tagName);
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
  }
  return parts.join(" > ");
}

function fileContext(control) {
  return control.form?.dataset.tripId || control.closest("[data-ui-key]")?.dataset.uiKey || "";
}

export function captureUiState() {
  const focused = document.activeElement;
  const focusPath = elementPath(focused);
  const selection = typeof focused?.selectionStart === "number"
    ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
  const details = [...document.querySelectorAll("details")].map((node) => [elementPath(node), node.open]);
  const files = [...document.querySelectorAll('input[type="file"]')]
    .filter((control) => control.files.length).map((control) => [elementPath(control), [...control.files], fileContext(control)]);
  return () => {
    for (const [path, selectedFiles, context] of files) {
      const control = document.querySelector(path);
      if (control?.type === "file" && fileContext(control) === context) {
        const transfer = new DataTransfer();
        selectedFiles.forEach((file) => transfer.items.add(file));
        control.files = transfer.files;
      }
    }
    for (const [path, open] of details) {
      const node = document.querySelector(path);
      if (node) node.open = open;
    }
    if (focusPath && (!focused.isConnected || document.activeElement === document.body)) {
      const replacement = document.querySelector(focusPath);
      if (replacement?.getClientRects().length) {
        replacement.focus({ preventScroll: true });
        if (selection && replacement.setSelectionRange) replacement.setSelectionRange(...selection);
      }
    }
  };
}

export function updateTabStops(tabs, preferred) {
  const visible = [...tabs].filter((tab) => !tab.hidden && tab.getClientRects().length > 0);
  if (!visible.length) return;
  const target = visible.find((tab) => tab === preferred)
    || visible.find((tab) => tab.getAttribute("aria-selected") === "true") || visible[0];
  tabs.forEach((tab) => { tab.tabIndex = tab === target ? 0 : -1; });
}
