// const redis = require("redis");

// const client = redis.createClient({
//     url: "redis://127.0.0.1:6379"
// });

// client.on("error", (err) => console.error("Redis Client Error", err));

// await client.connect();

// export { client };
// api/config/redis.js
const redis = require("redis");

const client = redis.createClient({
    url: "redis://127.0.0.1:6379"
});

client.on("error", (err) => console.error("Redis Client Error", err));

async function connectRedis() {
    if (!client.isOpen) {
        await client.connect();
        console.log("Redis connected");
    }
}

module.exports = { client, connectRedis };
