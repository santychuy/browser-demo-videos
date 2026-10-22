function words(value) {
  return (
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  );
}

// Compare the complete delivered transcript, not a matching prefix or a set of
// words. Punctuation, spacing and case can differ; words and numbers cannot.
export function assertTranscriptMatches(script, transcript, providerLabel) {
  const expected = typeof script === "string" ? words(script) : [];
  const observed = typeof transcript === "string" ? words(transcript) : [];
  if (
    !expected.length ||
    expected.length !== observed.length ||
    expected.some((word, index) => word !== observed[index])
  )
    throw new Error(
      `${providerLabel} narration transcript does not match the supplied script; check words and spelled-out numbers (no fallback was used)`,
    );
}
