#!/usr/bin/env node
import { execSync } from "node:child_process";
import process from "node:process";

const ports = process.argv
  .slice(2)
  .map(Number)
  .filter((p) => Number.isFinite(p) && p > 0);

const list = ports.length > 0 ? ports : [3000, 3001, 4000, 4001, 5000, 5001];
const isWin = process.platform === "win32";

console.log(`Cleaning ports: ${list.join(", ")}...`);

for (const port of list) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano`, { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue;
        if (!/\sLISTEN\s/i.test(line) && !/\sLISTENING\s/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 4) pids.add(pid);
      }
      if (pids.size === 0) {
        console.log(`Port ${port} is free`);
        continue;
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          console.log(`Killed PID ${pid} on port ${port}`);
        } catch {
          console.log(`Failed to kill PID ${pid} on port ${port}`);
        }
      }
    } else {
      try {
        execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
        console.log(`Killed listeners on port ${port}`);
      } catch {
        console.log(`Port ${port} is free`);
      }
    }
  } catch {
    console.log(`Port ${port} is free`);
  }
}

console.log("Done!");
