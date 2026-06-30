import { describe, it, expect } from "vitest";
import { channelNameForProject, renderTaskMessage } from "./render.js";

describe("channelNameForProject", () => {
  it("slugs a project name into a proj- channel", () => {
    expect(channelNameForProject("Roomies")).toBe("proj-roomies");
    expect(channelNameForProject("Room ez")).toBe("proj-room-ez");
    expect(channelNameForProject("  My_Cool.App  ")).toBe("proj-my-cool-app");
  });
});

describe("renderTaskMessage", () => {
  it("mentions the bridge bot and includes the instruction", () => {
    const text = renderTaskMessage(
      { project: "roomies", instruction: "Add a chores widget" },
      { bridgeBotId: "U123" },
    );
    expect(text).toBe("<@U123> Add a chores widget");
  });

  it("adds /plan and /model directives in the right order", () => {
    const text = renderTaskMessage(
      {
        project: "roomies",
        instruction: "Refactor the matches screen",
        mode: "plan",
        model: "opus 4.8 high thinking",
      },
      { bridgeBotId: "U123" },
    );
    expect(text).toBe("<@U123> /plan /model opus 4.8 high thinking Refactor the matches screen");
  });

  it("appends context when present", () => {
    const text = renderTaskMessage(
      { project: "roomies", instruction: "Do the thing", context: "We just merged auth." },
      { bridgeBotId: "U123" },
    );
    expect(text).toBe("<@U123> Do the thing\n\nContext:\nWe just merged auth.");
  });

  it("omits the mention when no bot id is given", () => {
    const text = renderTaskMessage({ project: "x", instruction: "hi" });
    expect(text).toBe("hi");
  });
});
