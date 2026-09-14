const net = require("node:net");

const listenHost = process.argv[2] || process.env.CDP_FORWARD_HOST || "127.0.0.1";
const listenPort = Number(process.argv[3] || process.env.CDP_FORWARD_PORT || 9224);
const targetHost = process.env.CDP_TARGET_HOST || "127.0.0.1";
const targetPort = Number(process.env.CDP_TARGET_PORT || 9223);

const server = net.createServer((client) => {
  const upstream = net.connect({ host: targetHost, port: targetPort });
  client.pipe(upstream).pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  upstream.on("error", close);
});

server.on("error", (error) => {
  console.error(`CDP forward failed: ${error.message}`);
  process.exitCode = 1;
});

server.listen(listenPort, listenHost, () => {
  console.log(`CDP forward listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}`);
});
