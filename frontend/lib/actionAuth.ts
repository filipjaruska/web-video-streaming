"use server";

import { timingSafeEqual } from "node:crypto";

/** Server-only password that gates mutating UI actions (uploads, etc.). */
function getExpectedPassword(): string | undefined {
  const value = process.env.ACTION_PASSWORD?.trim();
  return value ? value : undefined;
}

export async function isActionAuthRequired(): Promise<boolean> {
  return getExpectedPassword() !== undefined;
}

export async function verifyActionPassword(
  password: string,
): Promise<{ ok: boolean }> {
  const expected = getExpectedPassword();
  if (!expected) {
    return { ok: true };
  }

  const provided = password ?? "";
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");

  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false };
  }

  return { ok: timingSafeEqual(expectedBuf, providedBuf) };
}
