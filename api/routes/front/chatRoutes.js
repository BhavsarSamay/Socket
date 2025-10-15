const express = require("express");
const frontRouter = express.Router();
const chatController = require("../../controllers/front/chatController");
const UserCheckAuth = require("../../middleware/userMiddleware");


frontRouter.post(
    "/create_group",
    UserCheckAuth,
    chatController.createGroup
);


frontRouter.post(
    "/add_members",
    UserCheckAuth,
    chatController.addMembers
);

module.exports = frontRouter;