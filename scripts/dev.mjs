import { spawn } from "node:child_process";

const shell = process.platform === "win32";

const children = [
  spawn("pnpm", ["--filter", "@mandate/proxy", "dev"], {
    stdio: "inherit",
    shell,
    env: { ...process.env, PORT: "18787" },
  }),
  spawn("pnpm", ["--filter", "@mandate/resource-server", "dev"], {
    stdio: "inherit",
    shell,
    env: { ...process.env, RESOURCE_PORT: "18788", PROXY_URL: "http://127.0.0.1:18787" },
  }),
  spawn("pnpm", ["--filter", "@mandate/web", "dev"], {
    stdio: "inherit",
    shell,
    env: { ...process.env, NEXT_PUBLIC_PROXY_URL: "http://127.0.0.1:18787" },
  }),
];

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
}

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
