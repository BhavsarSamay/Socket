const http = require("http");
const app = require("./app");
const socketIO = require("./socket");
require("dotenv").config();

const server = http.createServer(app);
socketIO.init(server);

const port = process.env.PORT || 5000;

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
