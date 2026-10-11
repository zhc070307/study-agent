// Adapted from DeepSeek Harness packages/client/ui-primitives/src/clipboard.ts
// Upstream 5badb15009ae1756c3afe0ae0cef1faafc290ccc; Copyright (c) 2026 DeepSeek.
// MIT License: ../packages/runtime/LICENSE (also documented in THIRD_PARTY_NOTICES.md).
async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  const exec = typeof document.execCommand === "function" ? document.execCommand.bind(document) : void 0;
  if (exec === void 0) return false;
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  try {
    return exec("copy");
  } catch {
    return false;
  } finally {
    el.remove();
  }
}
export {
  writeClipboard
};
