import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeEntriesRead,
  authorizeEntriesWrite,
} from "../lib/meeting-access.mjs";

const secretaryIds = "secretary-user-id";
const participant = { userId: "participant-user-id" };
const secretary = { userId: "secretary-user-id" };

test("an unauthenticated request is rejected with 401 for read and write", () => {
  assert.equal(authorizeEntriesRead(null, secretaryIds).status, 401);
  assert.equal(authorizeEntriesWrite(undefined, { proposal: "feedback" }, secretaryIds).status, 401);
});

test("a participant cannot write a meeting decision or assign follow-up", () => {
  for (const payload of [
    { decision: "approved" },
    { conclusion: "adopted" },
    { owner: "work group" },
    { dueDate: "2026-11-01" },
    { status: "มีมติแล้ว" },
  ]) {
    assert.equal(authorizeEntriesWrite(participant, payload, secretaryIds).status, 403);
  }
});

test("a participant may submit feedback but cannot read the private register", () => {
  assert.equal(authorizeEntriesWrite(participant, { proposal: "make labels clearer" }, secretaryIds).status, 200);
  assert.equal(authorizeEntriesRead(participant, secretaryIds).status, 403);
});

test("only the configured secretary can read and write minutes", () => {
  assert.equal(authorizeEntriesRead(secretary, secretaryIds).status, 200);
  assert.equal(authorizeEntriesWrite(secretary, { decision: "approved" }, secretaryIds).status, 200);
  assert.equal(authorizeEntriesRead(secretary, "").status, 403);
});
