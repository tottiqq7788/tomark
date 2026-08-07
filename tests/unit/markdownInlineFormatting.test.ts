import {
  isSafeLinkHref,
  toggleInlineFormat,
  toggleLink,
} from "@/editor/markdownInlineFormatting";

describe("markdownInlineFormatting", () => {
  it("wraps a plain selection in bold markers", () => {
    const change = toggleInlineFormat("Hello world", 6, 11, "bold");
    expect(change).toEqual({
      from: 6,
      to: 11,
      insert: "**world**",
      selectionFrom: 8,
      selectionTo: 13,
    });
  });

  it("unwraps bold when markers hug the selection", () => {
    const source = "Hello **world**!";
    const change = toggleInlineFormat(source, 8, 13, "bold", { active: true });
    expect(change).toEqual({
      from: 6,
      to: 15,
      insert: "world",
      selectionFrom: 6,
      selectionTo: 11,
    });
  });

  it("partially unwraps bold inside a larger bold span", () => {
    const source = "**hello world**";
    const change = toggleInlineFormat(source, 8, 13, "bold", {
      active: true,
      outerFrom: 0,
      outerTo: 15,
    });
    expect(change?.insert).toBe("**hello** world");
    expect(source.slice(0, change!.from) + change!.insert + source.slice(change!.to)).toBe(
      "**hello** world",
    );
  });

  it("wraps italic and strike", () => {
    expect(toggleInlineFormat("abc", 0, 3, "italic")?.insert).toBe("*abc*");
    expect(toggleInlineFormat("abc", 0, 3, "strike")?.insert).toBe("~~abc~~");
  });

  it("chooses a longer code fence when content has backticks", () => {
    const change = toggleInlineFormat("a `b` c", 2, 5, "code");
    expect(change?.insert).toBe("`` `b` ``");
  });

  it("trims surrounding whitespace when wrapping", () => {
    const change = toggleInlineFormat("xx  hi  yy", 2, 8, "bold");
    expect(change?.insert).toBe("  **hi**  ");
  });

  it("adds a markdown link with escaped text", () => {
    const change = toggleLink("see [docs] here", 4, 10, {
      href: "https://example.com/a b",
    });
    expect(change?.insert).toBe("[\\[docs\\]](https://example.com/a%20b)");
  });

  it("removes a link using outer offsets", () => {
    const source = "go [here](https://example.com) now";
    const change = toggleLink(source, 4, 8, {
      active: true,
      outerFrom: 3,
      outerTo: 30,
    });
    expect(change).toEqual({
      from: 3,
      to: 30,
      insert: "here",
      selectionFrom: 3,
      selectionTo: 7,
    });
  });

  it("rejects unsafe link protocols", () => {
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("data:text/html,hi")).toBe(false);
    expect(isSafeLinkHref("//evil.example/x")).toBe(false);
    expect(isSafeLinkHref("https://ok")).toBe(true);
    expect(isSafeLinkHref("#section")).toBe(true);
    expect(isSafeLinkHref("/abs/path")).toBe(true);
    expect(isSafeLinkHref("../rel.md")).toBe(true);
  });

  it("unwraps underscore italic and bold from outer ranges", () => {
    const italic = toggleInlineFormat("_hello_", 1, 6, "italic", {
      active: true,
      outerFrom: 0,
      outerTo: 7,
    });
    expect(italic?.insert).toBe("hello");

    const bold = toggleInlineFormat("__hello__", 2, 7, "bold", {
      active: true,
      outerFrom: 0,
      outerTo: 9,
    });
    expect(bold?.insert).toBe("hello");
  });
});
