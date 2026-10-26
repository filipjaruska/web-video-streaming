import { describe, expect, it } from "vite-plus/test";

import { csvEscape, rowsToCsv, slugFilename } from "@/lib/csvExport";

describe("csvEscape", () => {
  it("leaves plain values alone and blanks missing ones", () => {
    expect(csvEscape("hybrid")).toBe("hybrid");
    expect(csvEscape(42.5)).toBe("42.5");
    expect(csvEscape(false)).toBe("false");
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("writes non-finite numbers as empty cells rather than as NaN or Infinity", () => {
    expect(csvEscape(Number.NaN)).toBe("");
    expect(csvEscape(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("quotes commas, quotes and line breaks, doubling inner quotes", () => {
    expect(csvEscape("1080p, 720p")).toBe('"1080p, 720p"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
  });
});

describe("rowsToCsv", () => {
  it("prefixes a BOM and ends every line with CRLF", () => {
    const csv = rowsToCsv(
      ["video", "bdRate"],
      [
        ["a,b", -8.1],
        ["c", null],
      ],
    );
    // By code point, so the expected string carries no invisible character.
    expect(csv.codePointAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('video,bdRate\r\n"a,b",-8.1\r\nc,\r\n');
  });
});

describe("slugFilename", () => {
  it("joins the parts into a lowercase slug", () => {
    expect(slugFilename(["Violet Evergarden", "", "BD-rate (%)"])).toBe(
      "violet-evergarden-bd-rate",
    );
    expect(slugFilename(["", "!!"])).toBe("export");
  });
});
