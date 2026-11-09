import { describe, expect, it } from "vitest";
import { splitQuotedText, unquote } from "../src/shared/quote";

describe("quoted text", () => {
  it("splits a reply from its attribution and quote", () => {
    const text = "Sounds good!\n\nOn Mon, Nov 9, 2026 at 3:27 PM <info@example.com> wrote:\n> Lunch on Friday?\n>\n> Ana";
    expect(splitQuotedText(text)).toEqual({
      main: "Sounds good!",
      attribution: "On Mon, Nov 9, 2026 at 3:27 PM <info@example.com> wrote:",
      quoted: "> Lunch on Friday?\n>\n> Ana",
    });
    expect(unquote("> Lunch on Friday?\n>\n> Ana")).toBe("Lunch on Friday?\n\nAna");
  });

  it("handles an attribution wrapped onto two lines", () => {
    const split = splitQuotedText("Yes\n\nOn Mon, Nov 9, 2026 at 3:27 PM Ana Ruiz <ana@example.org>\nwrote:\n> hi");
    expect(split.main).toBe("Yes");
    expect(split.attribution).toBe("On Mon, Nov 9, 2026 at 3:27 PM Ana Ruiz <ana@example.org>\nwrote:");
  });

  it("recognizes Outlook's original message marker and leaves unquoted mail alone", () => {
    expect(splitQuotedText("Thanks\n\n-----Original Message-----\nFrom: x").main).toBe("Thanks");
    expect(splitQuotedText("No quotes here\nat all")).toEqual({ main: "No quotes here\nat all", attribution: "", quoted: "" });
  });
});

describe("sent replies", () => {
  it("wrap the quoted part so mail clients can collapse it", async () => {
    const { textToHtml } = await import("../src/worker/mime");
    const html = textToHtml("Yes!\n\nOn Mon, Nov 9, 2026 at 3:27 PM Ana <ana@example.org> wrote:\n> Lunch?");
    expect(html).toContain('<div style="white-space:pre-wrap">Yes!</div>');
    expect(html).toContain('<div class="gmail_quote"><div class="gmail_attr">On Mon, Nov 9, 2026 at 3:27 PM Ana &#60;ana@example.org&#62; wrote:</div>');
    expect(html).toContain('<blockquote type="cite"');
    expect(html).toContain("Lunch?</div></blockquote>");
    expect(textToHtml("Just text")).toBe('<div style="white-space:pre-wrap">Just text</div>');
  });
});
