import { describe, expect, it } from "vitest";
import { LeaderChannel } from "../src/db/leader-channel.js";

describe("LeaderChannel", () => {
  it("forwards a follower's call to the serving leader and returns its result", async () => {
    const leader = new LeaderChannel("v1");
    const follower = new LeaderChannel("v1");
    leader.serve(async (method, args) => {
      expect(method).toBe("stats");
      expect(args).toEqual(["a", 1]);
      return { rows: 3 };
    });

    await expect(follower.call("stats", ["a", 1])).resolves.toEqual({ rows: 3 });

    leader.close();
    follower.close();
  });

  it("propagates a handler error back to the caller", async () => {
    const leader = new LeaderChannel("v2");
    const follower = new LeaderChannel("v2");
    leader.serve(async () => {
      throw new Error("no vault is open");
    });

    await expect(follower.call("stats", [])).rejects.toThrow("no vault is open");

    leader.close();
    follower.close();
  });

  it("times out if nothing is serving the channel", async () => {
    const follower = new LeaderChannel("v3");
    await expect(follower.call("stats", [], 20)).rejects.toThrow(/did not respond/);
    follower.close();
  });

  it("ignores requests once a leader stops serving", async () => {
    const leader = new LeaderChannel("v4");
    const follower = new LeaderChannel("v4");
    leader.serve(async () => "ok");
    leader.stopServing();

    await expect(follower.call("stats", [], 20)).rejects.toThrow(/did not respond/);

    leader.close();
    follower.close();
  });

  it("rejects in-flight calls when the follower's own channel is closed", async () => {
    const follower = new LeaderChannel("v5");
    const pending = follower.call("stats", [], 5_000);
    follower.close();
    await expect(pending).rejects.toThrow("leader channel closed");
  });
});
