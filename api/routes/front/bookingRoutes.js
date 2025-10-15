const express = require("express");
const frontRouter = express.Router();
const bookingController = require("../../controllers/front/bookingController");
const UserCheckAuth = require("../../middleware/userMiddleware");


frontRouter.post(
    "/add",
    UserCheckAuth,
    bookingController.add_booking
);

module.exports = frontRouter;