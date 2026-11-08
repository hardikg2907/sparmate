import net from "node:net";

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/**
 * Returns a port in [from, to] that nothing listens on, skipping the ports in `skip`.
 * The search starts at a random offset, so two scripts that start together rarely pick the same port
 * (a port is free again as soon as the probe closes, until the caller binds it).
 */
export async function pickFreePort({ from = 4750, to = 4799, skip = [4780] } = {}) {
  const ports = [];
  for (let p = from; p <= to; p++) if (!skip.includes(p)) ports.push(p);
  const start = Math.floor(Math.random() * ports.length);
  for (let i = 0; i < ports.length; i++) {
    const port = ports[(start + i) % ports.length];
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port from ${from} to ${to}`);
}
