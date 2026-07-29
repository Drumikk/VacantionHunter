const RELOCATION_POSITIVE = /(?:relocation\s+(?:support|assistance|package|bonus|benefit)|relocat(?:e|ing|ion)\s+(?:support|assistance|package|provided|available|covered)|(?:cover|covered|covers|pay|paid|provide|provided|offer|offered|offering)\s+(?:for\s+|your\s+|the\s+)?relocation|visa\s+sponsorship|sponsor(?:ing|ed|s)?\s+(?:a\s+)?(?:work|employment|immigration)\s+(?:visa|authorization|permit)|work\s+(?:visa|permit)\s+sponsorship|housing\s+assistance)/iu;
const RELOCATION_NEGATIVE = /(?:no|not|cannot|can't|unable\s+to|without|do(?:es)?\s+not)\s+(?:provide|offer|support|sponsor|include|cover)?\s*(?:visa\s+sponsorship|relocation|work\s+(?:visa|permit))/iu;
const REMOTE_POSITIVE = /(?:\bremote(?:[- ]first|[- ]only)?\b|\bwork\s+from\s+home\b|\bwork\s+from\s+anywhere\b|\bhome[- ]based\b|\bworldwide\b)/iu;
const REMOTE_NEGATIVE = /(?:not|no)\s+(?:a\s+)?remote|remote\s+(?:work\s+)?(?:is\s+)?not\s+(?:available|offered|supported)|on[- ]site\s+only/iu;

function combined(values) {
  return values.flat(Infinity).filter(Boolean).join(" ");
}

export function inferRelocation(...values) {
  const text = combined(values);
  return !RELOCATION_NEGATIVE.test(text) && RELOCATION_POSITIVE.test(text);
}

export function inferRemote(...values) {
  const text = combined(values);
  return !REMOTE_NEGATIVE.test(text) && REMOTE_POSITIVE.test(text);
}
