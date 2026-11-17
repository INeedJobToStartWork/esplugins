import type { TagMatcher } from "./types";

//----------------------
// Constants
//----------------------

/** @internal */
export const DEFAULT_TAGS = ["internal", "dontexport"] as const;

//----------------------
// Functions
//----------------------

const escapeRegExp = (text: string): string => text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);

/**
 * Creates a matcher for block comment text containing a tag (`@internal`), not just the word (`internal`)
 * or a longer tag (`@internalApi`).
 * @internal
 */
export const createTagMatcher = (tags: readonly string[]): TagMatcher => {
	const names = tags.map(tag => escapeRegExp(tag.replace(/^@/u, ""))).filter(Boolean);
	if (names.length === 0) return () => false;

	// eslint-disable-next-line @EslintSecurity/detect-non-literal-regexp
	const pattern = new RegExp(String.raw`(?:^|[\s*])@(?:${names.join("|")})(?![\w$-])`, "u");
	return (commentValue: string) => pattern.test(commentValue);
};

export default createTagMatcher;
