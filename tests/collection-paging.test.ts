import assert from "node:assert/strict";
import test from "node:test";
import { pageNumbers } from "../apps/desktop/src/collectionPaging.ts";

test("pagination always exposes current and boundary pages without exceeding five numbered choices", () => {
  for (const pages of [1, 2, 5, 6, 10, 100, 100000, 1000000]) {
    for (const page of [
      ...new Set(
        [1, 2, 3, 4, Math.ceil(pages / 2), pages - 2, pages - 1, pages].filter(
          (p) => p > 0 && p <= pages,
        ),
      ),
    ]) {
      const tokens = pageNumbers(page, pages);
      const numbers = tokens.filter((p): p is number => typeof p === "number");
      assert(
        numbers.includes(1) &&
          numbers.includes(pages) &&
          numbers.includes(page),
      );
      assert(numbers.length <= 5);
      assert.equal(new Set(numbers).size, numbers.length);
      assert.deepEqual(
        [...numbers].sort((a, b) => a - b),
        numbers,
      );
      assert(numbers.every((p) => p >= 1 && p <= pages));
      assert.notEqual(tokens[0], "gap");
      assert.notEqual(tokens.at(-1), "gap");
    }
  }
});
