import type { D1Migration } from "cloudflare:test";
import type { Env } from "../../src/env.js";

declare global {
  namespace Cloudflare {
    interface Env extends import("../../src/env.js").Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export type { Env };
