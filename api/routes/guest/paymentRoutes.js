const express = require("express");
const commonRouter = express.Router();
const PaymentController = require("../../controllers/guest/paymentController");

commonRouter.post("/webhook",
    express.raw({ type: "application/json" }),
    PaymentController.handleStripeWebhook);

commonRouter.post("/check_payment/:id", PaymentController.check_payment);

module.exports = commonRouter;
