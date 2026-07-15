import { test } from "node:test";
import assert from "node:assert/strict";

import { tableName, modelStub, migrationStub } from "../src/core/cli/stubs.js";

test("tableName snake-cases and pluralizes the model class", () => {
  assert.equal(tableName("Post"), "posts");
  assert.equal(tableName("UserProfile"), "user_profiles");
  assert.equal(tableName("Address"), "address"); // already ends in s — left alone
});

test("modelStub wires the class to its table", () => {
  const code = modelStub("Post", "posts");
  assert.match(code, /export class Post extends Model/);
  assert.match(code, /static override table = "posts"/);
  assert.match(code, /from "@shaferllc\/keel\/core"/);
});

test("migrationStub: a create migration builds and drops the table", () => {
  const code = migrationStub("0004_create_posts", "posts");
  assert.match(code, /name: "0004_create_posts"/);
  assert.match(code, /createTable\("posts"/);
  assert.match(code, /dropTable\("posts"\)/);
});

test("migrationStub: an alter migration alters both ways", () => {
  const code = migrationStub("0005_add_slug_to_posts", undefined, "posts");
  assert.match(code, /alterTable\("posts"/);
  assert.doesNotMatch(code, /createTable/);
});

test("migrationStub: a bare migration leaves up/down open", () => {
  const code = migrationStub("0006_backfill_data");
  assert.match(code, /async up\(schema\)/);
  assert.match(code, /Undo what up\(\) did/);
  assert.doesNotMatch(code, /createTable\("/);
});
