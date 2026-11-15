import { describe, expect, test } from "bun:test";

import { stillName } from "./still";

const JPG = "https://media.kitsu.app/episodes/1/original.jpg";

describe("stillName", () => {
  test("names a picture after its address and its kind", () => {
    const name = stillName(JPG);
    expect(name).toMatch(/^[a-f0-9]{32}\.jpg$/);
    // The same address is always filed under the same name.
    expect(stillName(JPG)).toBe(name);
  });

  test("gives two addresses two names", () => {
    expect(stillName(JPG)).not.toBe(
      stillName("https://media.kitsu.app/episodes/2/original.jpg"),
    );
  });

  test("refuses an address that is not an https picture", () => {
    expect(stillName("http://media.kitsu.app/1.jpg")).toBeNull();
    expect(stillName("https://media.kitsu.app/1.webp?size=large")).toBe(
      stillName("https://media.kitsu.app/1.webp?size=large") ?? "",
    );
    expect(stillName("https://example.com/no-extension")).toBeNull();
    expect(stillName("not a url")).toBeNull();
  });
});
