// Chrome's downloads API rejects a filename whose component exceeds
// kMaxFileNameLength (255) UTF-8 bytes, so keep the base name well under it to
// leave room for the extension (e.g. ".webarchive.zip") and uniquify suffixes.
const MAX_FILENAME_BYTES = 200;

function utf8ByteLength(input) {
  return new TextEncoder().encode(input).length;
}

// Truncate by UTF-8 byte budget while iterating per code point (for...of), so a
// multi-byte char or surrogate-pair emoji is never split into an invalid
// sequence or a lone surrogate.
function truncateToBytes(input, maxBytes) {
  if (utf8ByteLength(input) <= maxBytes) {
    return input;
  }

  let result = "";
  let bytes = 0;
  for (const char of input) {
    const charBytes = utf8ByteLength(char);
    if (bytes + charBytes > maxBytes) {
      break;
    }
    result += char;
    bytes += charBytes;
  }
  return result;
}

export function sanitizeFileName(input) {
  const cleaned = String(input)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\p{Cc}]+/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/^[-\s.]+|[-\s.]+$/g, "")
    .trim();

  // Truncate after cleaning, then strip any trailing dot/space/dash the cut may
  // expose — Chrome treats a component ending in "." or " " as unsafe.
  const truncated = truncateToBytes(cleaned, MAX_FILENAME_BYTES)
    .replace(/[-\s.]+$/g, "")
    .trim();

  return truncated || "web-archive";
}
