import assert from "node:assert/strict";
import test from "node:test";
import { escapeCsvCell } from "../lib/csv.mjs";

test("CSV cells beginning with formula trigger characters are neutralized", () => {
  for (const prefix of ["=", "+", "-", "@", "\t", "\r"]) {
    assert.equal(escapeCsvCell(`${prefix}1+1`), `"'${prefix}1+1"`);
  }
});

test("CSV cells remain quoted and embedded quotes are doubled", () => {
  assert.equal(escapeCsvCell('note "quoted"'), '"note ""quoted"""');
  assert.equal(escapeCsvCell(null), '""');
});
