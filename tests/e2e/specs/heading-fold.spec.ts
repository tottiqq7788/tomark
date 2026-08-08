describe("heading outline number gutter", () => {
  beforeEach(async () => {
    await browser.url("/");
    await $(".toolbar-title").waitForExist({ timeout: 30_000 });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(
            (window as unknown as { __tomarkE2e?: { replaceContent?: unknown } })
              .__tomarkE2e?.replaceContent,
          );
        }),
      { timeout: 30_000, timeoutMsg: "e2e hook not ready" },
    );
  });

  it("shows outline numbers on headings and toggles fold on click", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent(
        "# Root\n\nbody line\n## Child\nchild body\n# Other\nother body\n",
      );
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(document.querySelector(".cm-heading-number-gutter")),
        ),
      { timeout: 10_000, timeoutMsg: "heading number gutter not ready" },
    );

    const initial = await browser.execute(() => {
      const markers = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".cm-heading-number-marker",
        ),
      ];
      return {
        hasLineNumbers: Boolean(document.querySelector(".cm-lineNumbers")),
        labels: markers.map((marker) => marker.textContent),
        expanded: markers.map((marker) =>
          marker.classList.contains("cm-heading-number-marker--expanded"),
        ),
        content: document.querySelector(".cm-content")?.textContent ?? "",
      };
    });

    expect(initial.hasLineNumbers).toBe(false);
    expect(initial.labels).toEqual(["1", "1.1", "2"]);
    expect(initial.expanded).toEqual([true, true, false]);
    expect(initial.content).toContain("child body");
    expect(initial.content).not.toContain("other body");

    await browser.execute(() => {
      const child = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".cm-heading-number-marker",
        ),
      ].find((marker) => marker.textContent === "1.1");
      child?.click();
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const child = [
            ...document.querySelectorAll<HTMLButtonElement>(
              ".cm-heading-number-marker",
            ),
          ].find((marker) => marker.textContent === "1.1");
          const content = document.querySelector(".cm-content")?.textContent ?? "";
          return (
            Boolean(
              child?.classList.contains("cm-heading-number-marker--collapsed"),
            ) && !content.includes("child body")
          );
        }),
      { timeout: 5_000, timeoutMsg: "clicking 1.1 did not collapse child body" },
    );

    await browser.execute(() => {
      const child = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".cm-heading-number-marker",
        ),
      ].find((marker) => marker.textContent === "1.1");
      child?.click();
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const child = [
            ...document.querySelectorAll<HTMLButtonElement>(
              ".cm-heading-number-marker",
            ),
          ].find((marker) => marker.textContent === "1.1");
          const content = document.querySelector(".cm-content")?.textContent ?? "";
          return (
            Boolean(
              child?.classList.contains("cm-heading-number-marker--expanded"),
            ) && content.includes("child body")
          );
        }),
      { timeout: 5_000, timeoutMsg: "clicking 1.1 did not expand child body" },
    );
  });
});
