import { describe, expect, it } from "vitest";
import { createTagMatcher, DEFAULT_TAGS } from "./tags";

//----------------------
// Tests
//----------------------

describe(createTagMatcher, () => {
	const isTag = createTagMatcher(DEFAULT_TAGS);

	describe("[PASS]", () => {
		it.each([
			"* @internal ",
			"* @dontexport ",
			"*\n * Description\n * @internal\n ",
			"* @internal @dontexport ",
			"@internal",
			"* @internal - used by tests"
		])("matches %j", comment => {
			expect(isTag(comment)).toBe(true);
		});

		it.each(["* internal ", "* @internalApi ", "* foo@internal.dev ", "* @internal-ish ", "* {@link internal} "])(
			"does not match %j",
			comment => {
				expect(isTag(comment)).toBe(false);
			}
		);

		it("accepts custom tags with or without `@`, escaping regex characters", () => {
			const matcher = createTagMatcher(["@private", "x.y"]);
			expect(matcher("* @private ")).toBe(true);
			expect(matcher("* @x.y ")).toBe(true);
			expect(matcher("* @xzy ")).toBe(false);
			expect(matcher("* @internal ")).toBe(false);
		});

		it("matches nothing without tags", () => {
			expect(createTagMatcher([])("* @internal ")).toBe(false);
		});
	});
});
