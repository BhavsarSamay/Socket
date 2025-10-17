// const http = require("http");
// const app = require("./app");
// const socketIO = require("./socket");
// require("dotenv").config();

// const server = http.createServer(app);
// socketIO.init(server);

// const port = process.env.PORT || 5000;

// server.listen(port, () => {
//   console.log(`Server is running on port ${port}`);
// });

const http = require("http");
const cluster = require("cluster");
const os = require("os");
require("dotenv").config();
const { createAdapter } = require("@socket.io/redis-adapter");
const app = require("./app");
const socketIO = require("./socket2");
const { client, connectRedis } = require("./api/config/redis");
const totalCPUs = os.cpus().length;
const numCPUs = totalCPUs > 1 ? totalCPUs - 1 : 1;
const port = process.env.PORT || 5000;
if (cluster.isPrimary) {
  console.log(`Master process started with PID: ${process.pid}`);
  console.log(`Forking ${numCPUs} workers...\n`);
  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  // Respawn workers if one dies
  cluster.on("exit", (worker) => {
    console.error(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  // Worker process runs the server
  const server = http.createServer(app);
  // Initialize socket.io on this worker
  const io = socketIO.init(server);
  (async () => {
    try {
      // Connect main Redis client
      console.log("")
      await connectRedis();
      // Create duplicate client for pub/sub
      const subClient = client.duplicate();
      await subClient.connect();
      // Attach Redis adapter 
      io.adapter(createAdapter(client, subClient));
      console.log(`Worker ${process.pid} attached to Redis adapter ✅`);
    } catch (err) {
      console.error("Redis adapter setup failed:", err);
    }
  })();
  server.listen(port, (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(
      `Worker ${process.pid} running on port ${port} in ${process.env.NODE_ENV || "development"} mode`
    );
  });

  server.on("error", onError);
  server.on("listening", onListening);

  function onListening() {
    const addr = server.address();
    const bind =
      typeof addr === "string" ? "pipe " + addr : "port " + addr.port;
    console.log(`Listening on ${bind}`);
  }

  function onError(error) {
    if (error.syscall !== "listen") {
      throw error;
    }

    const bind = typeof port === "string" ? "Pipe " + port : "Port " + port;

    switch (error.code) {
      case "EACCES":
        console.error(bind + " requires elevated privileges");
        process.exit(1);
        break;
      case "EADDRINUSE":
        console.error(bind + " is already in use");
        process.exit(1);
        break;
      default:
        throw error;
    }
  }
}