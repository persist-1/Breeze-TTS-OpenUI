import { createHost } from "./server.ts";
const host = await createHost(process.cwd(), 14321);
console.log("Breeze local host: " + host.address);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    host.close();
    process.exit();
  });
