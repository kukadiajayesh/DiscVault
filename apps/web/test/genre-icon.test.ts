import { describe, expect, it } from "vitest";
import { isValidIconPath, normalizeIconName, staticIconPath } from "../src/ui/genre-icon.js";

describe("staticIconPath", () => {
  it("matches title category labels and genres regardless of case or punctuation", () => {
    expect(staticIconPath("Games")).toBeDefined();
    expect(staticIconPath("Sci-Fi")).toBe(staticIconPath("science fiction"));
    expect(staticIconPath("ROLE-PLAYING")).toBe(staticIconPath("rpg"));
  });

  it("falls back to the last recognisable word of a compound genre", () => {
    expect(staticIconPath("Action RPG")).toBe(staticIconPath("rpg"));
    expect(staticIconPath("Survival Horror")).toBe(staticIconPath("horror"));
  });

  it("returns undefined when nothing matches, leaving it to Gemini", () => {
    expect(staticIconPath("Bossa Nova")).toBeUndefined();
  });
});

describe("isValidIconPath", () => {
  it("accepts plain path data", () => {
    expect(isValidIconPath("M12 2L2 22h20z")).toBe(true);
    expect(isValidIconPath("m4 4 1.5-1e-1a2 2 0 0 1 2 2Z")).toBe(true);
  });

  it("rejects markup, prose and empty replies", () => {
    expect(isValidIconPath("")).toBe(false);
    expect(isValidIconPath('<path d="M1 1h2"/>')).toBe(false);
    expect(isValidIconPath("Here is your icon: M1 1h2")).toBe(false);
    expect(isValidIconPath("M")).toBe(false);
  });

  it("accepts every built-in path", () => {
    for (const name of ["Games", "Movies", "Software", "Songs", "Mixed", "Other", "Comedy", "Sports", "Sci-Fi", "Utility"]) {
      expect(isValidIconPath(staticIconPath(name) ?? "")).toBe(true);
    }
  });
});

describe("normalizeIconName", () => {
  it("collapses punctuation and whitespace", () => {
    expect(normalizeIconName("  Hip-Hop & R_B ")).toBe("hip hop and r b");
  });
});
