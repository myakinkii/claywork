import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeReason, parseJson } from "@claywork/reason";

test("fake reason cycles a script and records requests", async () => {
  const reason = new FakeReason(["one", "two"]);
  const texts = [];
  for (let i = 0; i < 3; i++) texts.push((await reason.complete({ messages: [{ role: "user", content: `${i}` }] })).text);
  assert.deepEqual(texts, ["one", "two", "one"]);
  assert.equal(reason.requests.length, 3);
});

test("parseJson tolerates fences and prose", () => {
  assert.deepEqual(parseJson('Sure! ```json\n{"a": [1, 2]}\n``` hope that helps'), { a: [1, 2] });
  assert.throws(() => parseJson("no json here"));
});
