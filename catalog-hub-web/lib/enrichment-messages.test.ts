import assert from "node:assert/strict";
import test from "node:test";
import { enrichmentErrorMessage } from "./enrichment-messages";

test("failed searches display actionable Russian messages for both stored errors and exceptions", () => {
  for (const code of [
    "openai_timeout",
    "source_timeout",
    "openai_search_incomplete",
    "openai_search_not_run",
    "openai_incomplete_output",
  ]) {
    const message = enrichmentErrorMessage(code);
    assert.equal(message, enrichmentErrorMessage(new Error(code)));
    assert.match(message, /Повторите/);
    assert.ok(!message.includes(code));
  }
  assert.equal(enrichmentErrorMessage("custom_error"), "custom_error");
});
