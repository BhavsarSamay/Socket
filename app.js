const express = require("express");
const app = express();
const morgan = require("morgan");
require("dotenv").config();
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const dbConfig = require("./api/config/db");
const helper = require("./api/helper/helper");
// const swaggerUi = require("swagger-ui-express");
const basicAuth = require("express-basic-auth");
// const { swaggerSpec } = require("./swagger");
// require("./cron");
var cors = require("cors");

// Front
const FrontUserRoutes = require("./api/routes/front/userRoutes")
const FrontChatRoutes = require("./api/routes/front/chatRoutes");
const FrontBookingRoutes = require("./api/routes/front/bookingRoutes");

// Guest
const GuestUserRoutes = require("./api/routes/guest/userRoutes");
const GuestPaymentRoutes = require("./api/routes/guest/paymentRoutes");

mongoose.Promise = global.Promise;

app.use(cors());

app.use(morgan("dev"));
app.use("/api/payment/webhook", 
  express.raw({ type: "application/json" }), 
  require("./api/routes/guest/paymentRoutes")
);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use("/uploads", express.static("uploads"));

// cors middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE");
    return res.status(200).json({});
  }
  next();
});


//Front
app.use("/api/front/user", FrontUserRoutes);
app.use("/api/front/chat", FrontChatRoutes);
app.use("/api/front/booking", FrontBookingRoutes);


//Guest
app.use("/api/user", GuestUserRoutes);
app.use("/api/payment", GuestPaymentRoutes);


// app.use("/cancel", (req, res) => {
//   console.log("cancel");
//   console.log(req);
// });

app.use("/success", (req, res) => {
  console.log("success");
  console.log(req);
});

app.use((req, res, next) => {
  const error = new Error("Not Found");
  error.status = 404;
  next(error);
});

app.use(async (error, req, res, next) => {
  res.status(error.status || 500);
  if (error.status) {
    return res.json({
      message: error.message,
    });
  }
  await helper.writeErrorLog(req, error);
  return res.json({
    message: "Internal Server Error",
    error: error.message,
  });
});

module.exports = app;
