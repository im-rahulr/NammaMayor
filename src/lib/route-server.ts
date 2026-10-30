import { createServerFn } from "@tanstack/react-start";
import { detourAtPoint } from "@/lib/osm-graph";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const exec = promisify(execFile);

export const findDetour = createServerFn({ method: "GET" })
  .validator((input: { blocked?: string; start?: string; end?: string } | undefined) => ({
    blocked: input?.blocked ?? "",
    start: input?.start ?? "SILK",
    end: input?.end ?? "BELL",
  }))
  .handler(async ({ data }) => {
    const script = path.resolve(process.cwd(), "scripts", "dijkstra.py");
    const { stdout } = await exec("python", [
      script,
      "--start",
      data.start,
      "--end",
      data.end,
      "--blocked",
      data.blocked,
    ]);
    return JSON.parse(stdout);
  });

export const findDetourAtPoint = createServerFn({ method: "GET" })
  .validator((input: { lat: number; lng: number }) => ({ lat: input.lat, lng: input.lng }))
  .handler(async ({ data }) => detourAtPoint(data.lat, data.lng));
