export function sanitizeFileName(input) {
  const cleaned = String(input)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .trim();

  return cleaned || "web-archive";
}
