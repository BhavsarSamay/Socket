const express = require("express");
const commonRouter = express.Router();
const UserController = require("../../controllers/guest/userController");

commonRouter.post("/send_otp", UserController.send_otp);

commonRouter.post("/login", UserController.login);

module.exports = commonRouter;
